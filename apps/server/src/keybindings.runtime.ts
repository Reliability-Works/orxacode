import {
  KeybindingRule,
  KeybindingsConfigError,
  MAX_KEYBINDINGS_COUNT,
  ResolvedKeybindingsConfig,
  type ServerConfigIssue,
} from '@orxa-code/contracts'
import { Deferred, Effect, FileSystem, Path, PubSub, Schema, Stream } from 'effect'

import {
  DEFAULT_KEYBINDINGS,
  compileResolvedKeybindingsConfig,
  KeybindingsConfigPrettyJson,
  type KeybindingsChangeEvent,
  type KeybindingsConfigState,
  hasSameShortcutContext,
  isSameKeybindingRule,
  mergeWithDefaultKeybindings,
} from './keybindings.logic'

interface DefaultShortcutConflictWarning {
  readonly defaultCommand: KeybindingRule['command']
  readonly conflictingCommand: KeybindingRule['command']
  readonly key: string
  readonly when: string | null
}

export function createReadConfigExists(fs: FileSystem.FileSystem, keybindingsConfigPath: string) {
  return fs.exists(keybindingsConfigPath).pipe(
    Effect.mapError(
      cause =>
        new KeybindingsConfigError({
          configPath: keybindingsConfigPath,
          detail: 'failed to access keybindings config',
          cause,
        })
    )
  )
}

export function createReadRawConfig(fs: FileSystem.FileSystem, keybindingsConfigPath: string) {
  return fs.readFileString(keybindingsConfigPath).pipe(
    Effect.mapError(
      cause =>
        new KeybindingsConfigError({
          configPath: keybindingsConfigPath,
          detail: 'failed to read keybindings config',
          cause,
        })
    )
  )
}

export function createWriteConfigAtomically(input: {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly keybindingsConfigPath: string
}) {
  return (rules: readonly KeybindingRule[]) => {
    const tempPath = `${input.keybindingsConfigPath}.${process.pid}.${Date.now()}.tmp`

    return Schema.encodeEffect(KeybindingsConfigPrettyJson)(rules).pipe(
      Effect.map(encoded => `${encoded}\n`),
      Effect.tap(() =>
        input.fs.makeDirectory(input.path.dirname(input.keybindingsConfigPath), {
          recursive: true,
        })
      ),
      Effect.tap(encoded => input.fs.writeFileString(tempPath, encoded)),
      Effect.flatMap(() => input.fs.rename(tempPath, input.keybindingsConfigPath)),
      Effect.ensuring(
        input.fs.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true }))
      ),
      Effect.mapError(
        cause =>
          new KeybindingsConfigError({
            configPath: input.keybindingsConfigPath,
            detail: 'failed to write keybindings config',
            cause,
          })
      )
    )
  }
}

export function collectDefaultKeybindingSyncPlan(customConfig: readonly KeybindingRule[]) {
  const existingCommands = new Set(customConfig.map(entry => entry.command))
  const missingDefaults: KeybindingRule[] = []
  const shortcutConflictWarnings: DefaultShortcutConflictWarning[] = []

  for (const defaultRule of DEFAULT_KEYBINDINGS) {
    if (existingCommands.has(defaultRule.command)) {
      continue
    }
    const conflictingEntry = customConfig.find(entry => hasSameShortcutContext(entry, defaultRule))
    if (conflictingEntry) {
      shortcutConflictWarnings.push({
        defaultCommand: defaultRule.command,
        conflictingCommand: conflictingEntry.command,
        key: defaultRule.key,
        when: defaultRule.when ?? null,
      })
      continue
    }
    missingDefaults.push(defaultRule)
  }

  const matchingDefaults = DEFAULT_KEYBINDINGS.filter(defaultRule =>
    customConfig.some(entry => isSameKeybindingRule(entry, defaultRule))
  ).map(rule => rule.command)

  return {
    missingDefaults,
    shortcutConflictWarnings,
    matchingDefaults,
  }
}

export function logDefaultShortcutConflicts(
  keybindingsConfigPath: string,
  shortcutConflictWarnings: ReadonlyArray<DefaultShortcutConflictWarning>
) {
  return Effect.forEach(
    shortcutConflictWarnings,
    conflict =>
      Effect.logWarning('skipping default keybinding due to shortcut conflict', {
        path: keybindingsConfigPath,
        defaultCommand: conflict.defaultCommand,
        conflictingCommand: conflict.conflictingCommand,
        key: conflict.key,
        when: conflict.when,
        reason: 'shortcut context already used by existing rule',
      }),
    { discard: true }
  )
}

export function buildCappedKeybindingsConfig(
  keybindingsConfigPath: string,
  nextConfig: readonly KeybindingRule[]
) {
  return Effect.gen(function* () {
    if (nextConfig.length > MAX_KEYBINDINGS_COUNT) {
      yield* Effect.logWarning('truncating keybindings config to max entries', {
        path: keybindingsConfigPath,
        maxEntries: MAX_KEYBINDINGS_COUNT,
      })
      return nextConfig.slice(-MAX_KEYBINDINGS_COUNT)
    }

    return nextConfig
  })
}

export function createLoadConfigStateFromDisk(
  loadRuntimeCustomKeybindingsConfig: Effect.Effect<
    {
      readonly keybindings: readonly KeybindingRule[]
      readonly issues: readonly ServerConfigIssue[]
    },
    KeybindingsConfigError
  >
) {
  return loadRuntimeCustomKeybindingsConfig.pipe(
    Effect.map(({ keybindings, issues }) => ({
      keybindings: mergeWithDefaultKeybindings(compileResolvedKeybindingsConfig(keybindings)),
      issues,
    }))
  )
}

export function createKeybindingsShape(input: {
  readonly start: Effect.Effect<void, KeybindingsConfigError>
  readonly startedDeferred: Deferred.Deferred<void, KeybindingsConfigError>
  readonly syncDefaultKeybindingsOnStartup: Effect.Effect<void, KeybindingsConfigError>
  readonly loadConfigStateFromCacheOrDisk: Effect.Effect<
    KeybindingsConfigState,
    KeybindingsConfigError
  >
  readonly changesPubSub: PubSub.PubSub<KeybindingsChangeEvent>
  readonly upsertKeybindingRule: (
    rule: KeybindingRule
  ) => Effect.Effect<ResolvedKeybindingsConfig, KeybindingsConfigError>
}) {
  return {
    start: input.start,
    ready: Deferred.await(input.startedDeferred),
    syncDefaultKeybindingsOnStartup: input.syncDefaultKeybindingsOnStartup,
    loadConfigState: input.loadConfigStateFromCacheOrDisk,
    getSnapshot: input.loadConfigStateFromCacheOrDisk,
    get streamChanges() {
      return Stream.fromPubSub(input.changesPubSub)
    },
    upsertKeybindingRule: input.upsertKeybindingRule,
  }
}
