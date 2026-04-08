/**
 * Keybindings operations - Internal helpers that assemble the keybindings
 * service operations (start, sync, upsert) from the runtime primitives.
 *
 * @module KeybindingsOperations
 */
import {
  KeybindingRule,
  KeybindingsConfigError,
  type ServerConfigIssue,
} from '@orxa-code/contracts'
import {
  Array,
  Cache,
  Cause,
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Path,
  Predicate,
  Ref,
  Schema,
  Scope,
  Stream,
} from 'effect'
import * as Semaphore from 'effect/Semaphore'

import {
  DEFAULT_KEYBINDINGS,
  type KeybindingsConfigState,
  RawKeybindingsEntries,
  ResolvedKeybindingFromConfig,
  compileResolvedKeybindingsConfig,
  invalidEntryIssue,
  malformedConfigIssue,
  mergeWithDefaultKeybindings,
} from './keybindings.logic'
import {
  buildCappedKeybindingsConfig,
  collectDefaultKeybindingSyncPlan,
  createReadConfigExists,
  createReadRawConfig,
  createWriteConfigAtomically,
  logDefaultShortcutConflicts,
} from './keybindings.runtime'

const resolvedConfigCacheKey = 'resolved' as const
export type ResolvedConfigCacheKey = typeof resolvedConfigCacheKey
export type ResolvedConfigCache = Cache.Cache<
  ResolvedConfigCacheKey,
  KeybindingsConfigState,
  KeybindingsConfigError,
  never
>

export const KEYBINDINGS_RESOLVED_CONFIG_CACHE_KEY = resolvedConfigCacheKey

type LoadCustomKeybindingsConfigInput = {
  readonly readConfigExists: Effect.Effect<boolean, KeybindingsConfigError>
  readonly readRawConfig: Effect.Effect<string, KeybindingsConfigError>
  readonly keybindingsConfigPath: string
}

function createLoadWritableCustomKeybindingsConfig(input: LoadCustomKeybindingsConfigInput) {
  return Effect.fn(function* (): Effect.fn.Return<
    readonly KeybindingRule[],
    KeybindingsConfigError
  > {
    if (!(yield* input.readConfigExists)) {
      return []
    }

    const rawConfig = yield* input.readRawConfig.pipe(
      Effect.flatMap(Schema.decodeEffect(RawKeybindingsEntries)),
      Effect.mapError(
        cause =>
          new KeybindingsConfigError({
            configPath: input.keybindingsConfigPath,
            detail: 'expected JSON array',
            cause,
          })
      )
    )

    return yield* Effect.forEach(rawConfig, entry =>
      Effect.gen(function* () {
        const decodedRule = Schema.decodeUnknownExit(KeybindingRule)(entry)
        if (decodedRule._tag === 'Failure') {
          yield* Effect.logWarning('ignoring invalid keybinding entry', {
            path: input.keybindingsConfigPath,
            entry,
            error: Cause.pretty(decodedRule.cause),
          })
          return null
        }
        const resolved = Schema.decodeExit(ResolvedKeybindingFromConfig)(decodedRule.value)
        if (resolved._tag === 'Failure') {
          yield* Effect.logWarning('ignoring invalid keybinding entry', {
            path: input.keybindingsConfigPath,
            entry,
            error: Cause.pretty(resolved.cause),
          })
          return null
        }
        return decodedRule.value
      })
    ).pipe(Effect.map(Array.filter(Predicate.isNotNull)))
  })
}

function createLoadRuntimeCustomKeybindingsConfig(input: LoadCustomKeybindingsConfigInput) {
  return Effect.fn(function* (): Effect.fn.Return<
    {
      readonly keybindings: readonly KeybindingRule[]
      readonly issues: readonly ServerConfigIssue[]
    },
    KeybindingsConfigError
  > {
    if (!(yield* input.readConfigExists)) {
      return { keybindings: [], issues: [] }
    }

    const rawConfig = yield* input.readRawConfig
    const decodedEntries = Schema.decodeUnknownExit(RawKeybindingsEntries)(rawConfig)
    if (decodedEntries._tag === 'Failure') {
      const detail = `expected JSON array (${Cause.pretty(decodedEntries.cause)})`
      return {
        keybindings: [],
        issues: [malformedConfigIssue(detail)],
      }
    }

    const keybindings: KeybindingRule[] = []
    const issues: ServerConfigIssue[] = []
    for (const [index, entry] of decodedEntries.value.entries()) {
      const decodedRule = Schema.decodeUnknownExit(KeybindingRule)(entry)
      if (decodedRule._tag === 'Failure') {
        const detail = Cause.pretty(decodedRule.cause)
        issues.push(invalidEntryIssue(index, detail))
        yield* Effect.logWarning('ignoring invalid keybinding entry', {
          path: input.keybindingsConfigPath,
          index,
          entry,
          error: detail,
        })
        continue
      }

      const resolvedRule = Schema.decodeExit(ResolvedKeybindingFromConfig)(decodedRule.value)
      if (resolvedRule._tag === 'Failure') {
        const detail = Cause.pretty(resolvedRule.cause)
        issues.push(invalidEntryIssue(index, detail))
        yield* Effect.logWarning('ignoring invalid keybinding entry', {
          path: input.keybindingsConfigPath,
          index,
          entry,
          error: detail,
        })
        continue
      }
      keybindings.push(decodedRule.value)
    }

    return { keybindings, issues }
  })
}

function createStartWatcher(input: {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly keybindingsConfigPath: string
  readonly revalidateAndEmit: Effect.Effect<void, never>
  readonly watcherScope: Scope.Scope
}) {
  return Effect.gen(function* () {
    const keybindingsConfigDir = input.path.dirname(input.keybindingsConfigPath)
    const keybindingsConfigFile = input.path.basename(input.keybindingsConfigPath)
    const keybindingsConfigPathResolved = input.path.resolve(input.keybindingsConfigPath)

    yield* input.fs.makeDirectory(keybindingsConfigDir, { recursive: true }).pipe(
      Effect.mapError(
        cause =>
          new KeybindingsConfigError({
            configPath: input.keybindingsConfigPath,
            detail: 'failed to prepare keybindings config directory',
            cause,
          })
      )
    )

    const debouncedKeybindingsEvents = input.fs.watch(keybindingsConfigDir).pipe(
      Stream.filter(
        event =>
          event.path === keybindingsConfigFile ||
          event.path === input.keybindingsConfigPath ||
          input.path.resolve(keybindingsConfigDir, event.path) === keybindingsConfigPathResolved
      ),
      Stream.debounce(Duration.millis(100))
    )

    yield* Stream.runForEach(debouncedKeybindingsEvents, () => input.revalidateAndEmit).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(input.watcherScope),
      Effect.asVoid
    )
  })
}

function createStart(input: {
  readonly startedRef: Ref.Ref<boolean>
  readonly startedDeferred: Deferred.Deferred<void, KeybindingsConfigError>
  readonly startWatcher: Effect.Effect<void, KeybindingsConfigError>
  readonly syncDefaultKeybindingsOnStartup: Effect.Effect<void, KeybindingsConfigError>
  readonly resolvedConfigCache: ResolvedConfigCache
  readonly loadConfigStateFromCacheOrDisk: Effect.Effect<
    KeybindingsConfigState,
    KeybindingsConfigError
  >
}) {
  return Effect.gen(function* () {
    const alreadyStarted = yield* Ref.get(input.startedRef)
    if (alreadyStarted) {
      return yield* Deferred.await(input.startedDeferred)
    }

    yield* Ref.set(input.startedRef, true)
    const startup = Effect.gen(function* () {
      yield* input.startWatcher
      yield* input.syncDefaultKeybindingsOnStartup
      yield* Cache.invalidate(input.resolvedConfigCache, resolvedConfigCacheKey)
      yield* input.loadConfigStateFromCacheOrDisk
    })

    const startupExit = yield* Effect.exit(startup)
    if (startupExit._tag === 'Failure') {
      yield* Deferred.failCause(input.startedDeferred, startupExit.cause).pipe(Effect.orDie)
      return yield* Effect.failCause(startupExit.cause)
    }

    yield* Deferred.succeed(input.startedDeferred, undefined).pipe(Effect.orDie)
  })
}

function createUpsertKeybindingRule(input: {
  readonly upsertSemaphore: Semaphore.Semaphore
  readonly loadWritableCustomKeybindingsConfig: Effect.Effect<
    readonly KeybindingRule[],
    KeybindingsConfigError
  >
  readonly keybindingsConfigPath: string
  readonly writeConfigAtomically: (
    rules: readonly KeybindingRule[]
  ) => Effect.Effect<void, KeybindingsConfigError>
  readonly resolvedConfigCache: ResolvedConfigCache
  readonly emitChange: (configState: KeybindingsConfigState) => Effect.Effect<void, never>
}) {
  return (rule: KeybindingRule) =>
    input.upsertSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const customConfig = yield* input.loadWritableCustomKeybindingsConfig
        const nextConfig = [...customConfig.filter(entry => entry.command !== rule.command), rule]
        const cappedConfig = yield* buildCappedKeybindingsConfig(
          input.keybindingsConfigPath,
          nextConfig
        )
        yield* input.writeConfigAtomically(cappedConfig)
        const nextResolved = mergeWithDefaultKeybindings(
          compileResolvedKeybindingsConfig(cappedConfig)
        )
        yield* Cache.set(input.resolvedConfigCache, resolvedConfigCacheKey, {
          keybindings: nextResolved,
          issues: [],
        })
        yield* input.emitChange({
          keybindings: nextResolved,
          issues: [],
        })
        return nextResolved
      })
    )
}

function createSyncDefaultKeybindingsOnStartup(input: {
  readonly upsertSemaphore: Semaphore.Semaphore
  readonly readConfigExists: Effect.Effect<boolean, KeybindingsConfigError>
  readonly writeConfigAtomically: (
    rules: readonly KeybindingRule[]
  ) => Effect.Effect<void, KeybindingsConfigError>
  readonly resolvedConfigCache: ResolvedConfigCache
  readonly loadRuntimeCustomKeybindingsConfig: Effect.Effect<
    {
      readonly keybindings: readonly KeybindingRule[]
      readonly issues: readonly ServerConfigIssue[]
    },
    KeybindingsConfigError
  >
  readonly keybindingsConfigPath: string
}) {
  return input.upsertSemaphore.withPermits(1)(
    Effect.gen(function* () {
      const configExists = yield* input.readConfigExists
      if (!configExists) {
        yield* input.writeConfigAtomically(DEFAULT_KEYBINDINGS)
        yield* Cache.invalidate(input.resolvedConfigCache, resolvedConfigCacheKey)
        return
      }

      const runtimeConfig = yield* input.loadRuntimeCustomKeybindingsConfig
      if (runtimeConfig.issues.length > 0) {
        yield* Effect.logWarning(
          'skipping startup keybindings default sync because config has issues',
          {
            path: input.keybindingsConfigPath,
            issues: runtimeConfig.issues,
          }
        )
        yield* Cache.invalidate(input.resolvedConfigCache, resolvedConfigCacheKey)
        return
      }

      const customConfig = runtimeConfig.keybindings
      const { missingDefaults, shortcutConflictWarnings, matchingDefaults } =
        collectDefaultKeybindingSyncPlan(customConfig)

      yield* logDefaultShortcutConflicts(input.keybindingsConfigPath, shortcutConflictWarnings)
      if (missingDefaults.length === 0) {
        yield* Cache.invalidate(input.resolvedConfigCache, resolvedConfigCacheKey)
        return
      }

      if (matchingDefaults.length > 0) {
        yield* Effect.logWarning('default keybinding rule already defined in user config', {
          path: input.keybindingsConfigPath,
          commands: matchingDefaults,
        })
      }

      const nextConfig = [...customConfig, ...missingDefaults]
      const cappedConfig = yield* buildCappedKeybindingsConfig(
        input.keybindingsConfigPath,
        nextConfig
      )
      yield* input.writeConfigAtomically(cappedConfig)
      yield* Cache.invalidate(input.resolvedConfigCache, resolvedConfigCacheKey)
    })
  )
}

export function createKeybindingsConfigAccessors(input: {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly keybindingsConfigPath: string
}) {
  const readConfigExists = createReadConfigExists(input.fs, input.keybindingsConfigPath)
  const readRawConfig = createReadRawConfig(input.fs, input.keybindingsConfigPath)
  const loadWritableCustomKeybindingsConfig = createLoadWritableCustomKeybindingsConfig({
    readConfigExists,
    readRawConfig,
    keybindingsConfigPath: input.keybindingsConfigPath,
  })
  const loadRuntimeCustomKeybindingsConfig = createLoadRuntimeCustomKeybindingsConfig({
    readConfigExists,
    readRawConfig,
    keybindingsConfigPath: input.keybindingsConfigPath,
  })
  const writeConfigAtomically = createWriteConfigAtomically({
    fs: input.fs,
    path: input.path,
    keybindingsConfigPath: input.keybindingsConfigPath,
  })

  return {
    readConfigExists,
    loadWritableCustomKeybindingsConfig,
    loadRuntimeCustomKeybindingsConfig,
    writeConfigAtomically,
  }
}

function createRevalidateAndEmit(input: {
  readonly upsertSemaphore: Semaphore.Semaphore
  readonly resolvedConfigCache: ResolvedConfigCache
  readonly loadConfigStateFromCacheOrDisk: Effect.Effect<
    KeybindingsConfigState,
    KeybindingsConfigError
  >
  readonly emitChange: (configState: KeybindingsConfigState) => Effect.Effect<void, never>
}) {
  return input.upsertSemaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(input.resolvedConfigCache, resolvedConfigCacheKey)
      const configState = yield* input.loadConfigStateFromCacheOrDisk
      yield* input.emitChange(configState)
    })
  )
}

export function buildKeybindingsOperations(input: {
  readonly accessors: ReturnType<typeof createKeybindingsConfigAccessors>
  readonly resolvedConfigCache: ResolvedConfigCache
  readonly loadConfigStateFromCacheOrDisk: Effect.Effect<
    KeybindingsConfigState,
    KeybindingsConfigError
  >
  readonly upsertSemaphore: Semaphore.Semaphore
  readonly keybindingsConfigPath: string
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly watcherScope: Scope.Scope
  readonly startedRef: Ref.Ref<boolean>
  readonly startedDeferred: Deferred.Deferred<void, KeybindingsConfigError>
  readonly emitChange: (configState: KeybindingsConfigState) => Effect.Effect<void, never>
}) {
  const {
    readConfigExists,
    loadWritableCustomKeybindingsConfig,
    loadRuntimeCustomKeybindingsConfig,
    writeConfigAtomically,
  } = input.accessors

  const revalidateAndEmit = createRevalidateAndEmit({
    upsertSemaphore: input.upsertSemaphore,
    resolvedConfigCache: input.resolvedConfigCache,
    loadConfigStateFromCacheOrDisk: input.loadConfigStateFromCacheOrDisk,
    emitChange: input.emitChange,
  })

  const syncDefaultKeybindingsOnStartup = createSyncDefaultKeybindingsOnStartup({
    upsertSemaphore: input.upsertSemaphore,
    readConfigExists,
    writeConfigAtomically,
    resolvedConfigCache: input.resolvedConfigCache,
    loadRuntimeCustomKeybindingsConfig: loadRuntimeCustomKeybindingsConfig(),
    keybindingsConfigPath: input.keybindingsConfigPath,
  })

  const startWatcher = createStartWatcher({
    fs: input.fs,
    path: input.path,
    keybindingsConfigPath: input.keybindingsConfigPath,
    revalidateAndEmit: revalidateAndEmit.pipe(Effect.ignoreCause({ log: true })),
    watcherScope: input.watcherScope,
  })

  const start = createStart({
    startedRef: input.startedRef,
    startedDeferred: input.startedDeferred,
    startWatcher,
    syncDefaultKeybindingsOnStartup,
    resolvedConfigCache: input.resolvedConfigCache,
    loadConfigStateFromCacheOrDisk: input.loadConfigStateFromCacheOrDisk,
  })

  const upsertKeybindingRule = createUpsertKeybindingRule({
    upsertSemaphore: input.upsertSemaphore,
    loadWritableCustomKeybindingsConfig: loadWritableCustomKeybindingsConfig(),
    keybindingsConfigPath: input.keybindingsConfigPath,
    writeConfigAtomically,
    resolvedConfigCache: input.resolvedConfigCache,
    emitChange: input.emitChange,
  })

  return { start, syncDefaultKeybindingsOnStartup, upsertKeybindingRule }
}
