/**
 * ServerSettings - Server-authoritative settings service.
 *
 * Owns persistence, validation, and change notification of settings that affect
 * server-side behavior (binary paths, streaming mode, env mode, custom models,
 * text generation model selection).
 *
 * Follows the same pattern as `keybindings.ts`: JSON file + Cache + PubSub +
 * Semaphore + FileSystem.watch for concurrency and external edit detection.
 *
 * @module ServerSettings
 */
import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ProviderKind,
  ServerSettings,
  ServerSettingsError,
  type ServerSettingsPatch,
} from '@orxa-code/contracts'
import {
  Cache,
  Deferred,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Path,
  Equal,
  PubSub,
  Ref,
  Schema,
  SchemaIssue,
  Scope,
  ServiceMap,
  Stream,
  Cause,
} from 'effect'
import * as Semaphore from 'effect/Semaphore'
import { ServerConfig } from './config'
import { type DeepPartial, deepMerge } from '@orxa-code/shared/Struct'
import { fromLenientJson } from '@orxa-code/shared/schemaJson'

export interface ServerSettingsShape {
  /** Start the settings runtime and attach file watching. */
  readonly start: Effect.Effect<void, ServerSettingsError>

  /** Await settings runtime readiness. */
  readonly ready: Effect.Effect<void, ServerSettingsError>

  /** Read the current settings. */
  readonly getSettings: Effect.Effect<ServerSettings, ServerSettingsError>

  /** Patch settings and persist. Returns the new full settings object. */
  readonly updateSettings: (
    patch: ServerSettingsPatch
  ) => Effect.Effect<ServerSettings, ServerSettingsError>

  /** Stream of settings change events. */
  readonly streamChanges: Stream.Stream<ServerSettings>
}

export class ServerSettingsService extends ServiceMap.Service<
  ServerSettingsService,
  ServerSettingsShape
>()('orxacode/serverSettings/ServerSettingsService') {
  static readonly layerTest = (overrides: DeepPartial<ServerSettings> = {}) =>
    Layer.effect(
      ServerSettingsService,
      Effect.gen(function* () {
        const currentSettingsRef = yield* Ref.make<ServerSettings>(
          deepMerge(DEFAULT_SERVER_SETTINGS, overrides)
        )

        return {
          start: Effect.void,
          ready: Effect.void,
          getSettings: Ref.get(currentSettingsRef),
          updateSettings: patch =>
            Ref.get(currentSettingsRef).pipe(
              Effect.map(currentSettings => deepMerge(currentSettings, patch)),
              Effect.tap(nextSettings => Ref.set(currentSettingsRef, nextSettings))
            ),
          streamChanges: Stream.empty,
        } satisfies ServerSettingsShape
      })
    )
}

const ServerSettingsJson = fromLenientJson(ServerSettings)
const SETTINGS_CACHE_KEY = 'settings' as const

const PROVIDER_ORDER: readonly ProviderKind[] = ['codex', 'claudeAgent', 'opencode']
type SettingsCache = Cache.Cache<typeof SETTINGS_CACHE_KEY, ServerSettings, ServerSettingsError>

interface ServerSettingsRuntimeDeps {
  readonly settingsPath: string
  readonly fs: FileSystem.FileSystem
  readonly pathService: Path.Path
  readonly writeSemaphore: Semaphore.Semaphore
  readonly changesPubSub: PubSub.PubSub<ServerSettings>
  readonly settingsCache: SettingsCache
  readonly getSettingsFromCache: Effect.Effect<ServerSettings, ServerSettingsError>
  readonly startedRef: Ref.Ref<boolean>
  readonly startedDeferred: Deferred.Deferred<void, ServerSettingsError>
  readonly watcherScope: Scope.Closeable
}

/**
 * Ensure the `textGenerationModelSelection` points to an enabled provider.
 * If the selected provider is disabled, fall back to the first enabled
 * provider with its default model.  This is applied at read-time so the
 * persisted preference is preserved for when a provider is re-enabled.
 */
function resolveTextGenerationProvider(settings: ServerSettings): ServerSettings {
  const selection = settings.textGenerationModelSelection
  if (settings.providers[selection.provider].enabled) {
    return settings
  }

  const fallback = PROVIDER_ORDER.find(p => settings.providers[p].enabled)
  if (!fallback) {
    // No providers enabled — return as-is; callers will report the error.
    return settings
  }

  return {
    ...settings,
    textGenerationModelSelection: {
      provider: fallback,
      model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER[fallback],
    } as ModelSelection,
  }
}

// Values under these keys are compared as a whole — never stripped field-by-field.
const ATOMIC_SETTINGS_KEYS: ReadonlySet<string> = new Set(['textGenerationModelSelection'])

function stripDefaultServerSettings(current: unknown, defaults: unknown): unknown | undefined {
  if (Array.isArray(current) || Array.isArray(defaults)) {
    return Equal.equals(current, defaults) ? undefined : current
  }

  if (
    current !== null &&
    defaults !== null &&
    typeof current === 'object' &&
    typeof defaults === 'object'
  ) {
    const currentRecord = current as Record<string, unknown>
    const defaultsRecord = defaults as Record<string, unknown>
    const next: Record<string, unknown> = {}

    for (const key of Object.keys(currentRecord)) {
      if (ATOMIC_SETTINGS_KEYS.has(key)) {
        if (!Equal.equals(currentRecord[key], defaultsRecord[key])) {
          next[key] = currentRecord[key]
        }
      } else {
        const stripped = stripDefaultServerSettings(currentRecord[key], defaultsRecord[key])
        if (stripped !== undefined) {
          next[key] = stripped
        }
      }
    }

    return Object.keys(next).length > 0 ? next : undefined
  }

  return Object.is(current, defaults) ? undefined : current
}

function makeServerSettingsError(
  settingsPath: string,
  detail: string,
  cause: unknown
): ServerSettingsError {
  return new ServerSettingsError({ settingsPath, detail, cause })
}

function emitSettingsChange(
  changesPubSub: PubSub.PubSub<ServerSettings>,
  settings: ServerSettings
): Effect.Effect<void> {
  return PubSub.publish(changesPubSub, settings).pipe(Effect.asVoid)
}

function readSettingsFileExists(
  fs: FileSystem.FileSystem,
  settingsPath: string
): Effect.Effect<boolean, ServerSettingsError> {
  return fs
    .exists(settingsPath)
    .pipe(
      Effect.mapError(cause =>
        makeServerSettingsError(settingsPath, 'failed to check settings file existence', cause)
      )
    )
}

function readRawSettingsFile(
  fs: FileSystem.FileSystem,
  settingsPath: string
): Effect.Effect<string, ServerSettingsError> {
  return fs
    .readFileString(settingsPath)
    .pipe(
      Effect.mapError(cause =>
        makeServerSettingsError(settingsPath, 'failed to read settings file', cause)
      )
    )
}

function loadServerSettingsFromDisk(
  fs: FileSystem.FileSystem,
  settingsPath: string
): Effect.Effect<ServerSettings, ServerSettingsError> {
  return Effect.gen(function* () {
    if (!(yield* readSettingsFileExists(fs, settingsPath))) {
      return DEFAULT_SERVER_SETTINGS
    }

    const raw = yield* readRawSettingsFile(fs, settingsPath)
    const decoded = Schema.decodeUnknownExit(ServerSettingsJson)(raw)
    if (decoded._tag === 'Failure') {
      yield* Effect.logWarning('failed to parse settings.json, using defaults', {
        path: settingsPath,
        issues: Cause.pretty(decoded.cause),
      })
      return DEFAULT_SERVER_SETTINGS
    }
    return decoded.value
  })
}

function writeSettingsAtomically(
  fs: FileSystem.FileSystem,
  pathService: Path.Path,
  settingsPath: string,
  settings: ServerSettings
): Effect.Effect<void, ServerSettingsError> {
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`
  const sparseSettings = stripDefaultServerSettings(settings, DEFAULT_SERVER_SETTINGS) ?? {}

  return Effect.succeed(`${JSON.stringify(sparseSettings, null, 2)}\n`).pipe(
    Effect.tap(() => fs.makeDirectory(pathService.dirname(settingsPath), { recursive: true })),
    Effect.tap(encoded => fs.writeFileString(tempPath, encoded)),
    Effect.flatMap(() => fs.rename(tempPath, settingsPath)),
    Effect.ensuring(fs.remove(tempPath, { force: true }).pipe(Effect.ignore({ log: true }))),
    Effect.mapError(cause =>
      makeServerSettingsError(settingsPath, 'failed to write settings file', cause)
    )
  )
}

function makeRevalidateAndEmit(
  deps: Pick<
    ServerSettingsRuntimeDeps,
    'writeSemaphore' | 'settingsCache' | 'getSettingsFromCache' | 'changesPubSub'
  >
): Effect.Effect<void, ServerSettingsError> {
  return deps.writeSemaphore.withPermits(1)(
    Effect.gen(function* () {
      yield* Cache.invalidate(deps.settingsCache, SETTINGS_CACHE_KEY)
      const settings = yield* deps.getSettingsFromCache
      yield* emitSettingsChange(deps.changesPubSub, settings)
    })
  )
}

function startSettingsWatcher(
  deps: Pick<ServerSettingsRuntimeDeps, 'settingsPath' | 'fs' | 'pathService' | 'watcherScope'>,
  revalidateAndEmit: Effect.Effect<void, ServerSettingsError>
): Effect.Effect<void, ServerSettingsError> {
  return Effect.gen(function* () {
    const settingsDir = deps.pathService.dirname(deps.settingsPath)
    const settingsFile = deps.pathService.basename(deps.settingsPath)
    const settingsPathResolved = deps.pathService.resolve(deps.settingsPath)

    yield* deps.fs
      .makeDirectory(settingsDir, { recursive: true })
      .pipe(
        Effect.mapError(cause =>
          makeServerSettingsError(deps.settingsPath, 'failed to prepare settings directory', cause)
        )
      )

    const revalidateAndEmitSafely = revalidateAndEmit.pipe(Effect.ignoreCause({ log: true }))
    const debouncedSettingsEvents = deps.fs.watch(settingsDir).pipe(
      Stream.filter(event => {
        return (
          event.path === settingsFile ||
          event.path === deps.settingsPath ||
          deps.pathService.resolve(settingsDir, event.path) === settingsPathResolved
        )
      }),
      Stream.debounce(Duration.millis(100))
    )

    yield* Stream.runForEach(debouncedSettingsEvents, () => revalidateAndEmitSafely).pipe(
      Effect.ignoreCause({ log: true }),
      Effect.forkIn(deps.watcherScope),
      Effect.asVoid
    )
  })
}

function startServerSettingsRuntime(
  deps: ServerSettingsRuntimeDeps
): Effect.Effect<void, ServerSettingsError> {
  return Effect.gen(function* () {
    const shouldStart = yield* Ref.modify(deps.startedRef, started => [!started, true])
    if (!shouldStart) {
      return yield* Deferred.await(deps.startedDeferred)
    }

    const startup = Effect.gen(function* () {
      yield* startSettingsWatcher(deps, makeRevalidateAndEmit(deps))
      yield* Cache.invalidate(deps.settingsCache, SETTINGS_CACHE_KEY)
      yield* deps.getSettingsFromCache
    })

    const startupExit = yield* Effect.exit(startup)
    if (startupExit._tag === 'Failure') {
      yield* Deferred.failCause(deps.startedDeferred, startupExit.cause).pipe(Effect.orDie)
      return yield* Effect.failCause(startupExit.cause)
    }

    yield* Deferred.succeed(deps.startedDeferred, undefined).pipe(Effect.orDie)
  })
}

function normalizeServerSettings(
  current: ServerSettings,
  patch: ServerSettingsPatch
): Effect.Effect<ServerSettings, ServerSettingsError> {
  return Schema.decodeEffect(ServerSettings)(deepMerge(current, patch)).pipe(
    Effect.mapError(cause =>
      makeServerSettingsError(
        '<memory>',
        `failed to normalize server settings: ${SchemaIssue.makeFormatterDefault()(cause.issue)}`,
        cause
      )
    )
  )
}

function updateServerSettings(
  deps: Pick<
    ServerSettingsRuntimeDeps,
    | 'settingsPath'
    | 'fs'
    | 'pathService'
    | 'writeSemaphore'
    | 'changesPubSub'
    | 'settingsCache'
    | 'getSettingsFromCache'
  >,
  patch: ServerSettingsPatch
): Effect.Effect<ServerSettings, ServerSettingsError> {
  return deps.writeSemaphore.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* deps.getSettingsFromCache
      const next = yield* normalizeServerSettings(current, patch)
      yield* writeSettingsAtomically(deps.fs, deps.pathService, deps.settingsPath, next)
      yield* Cache.set(deps.settingsCache, SETTINGS_CACHE_KEY, next)
      yield* emitSettingsChange(deps.changesPubSub, next)
      return resolveTextGenerationProvider(next)
    })
  )
}

const makeServerSettings = Effect.gen(function* () {
  const { settingsPath } = yield* ServerConfig
  const fs = yield* FileSystem.FileSystem
  const pathService = yield* Path.Path
  const writeSemaphore = yield* Semaphore.make(1)
  const changesPubSub = yield* PubSub.unbounded<ServerSettings>()
  const startedRef = yield* Ref.make(false)
  const startedDeferred = yield* Deferred.make<void, ServerSettingsError>()
  const watcherScope = yield* Scope.make('sequential')
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void))

  const settingsCache = yield* Cache.make<
    typeof SETTINGS_CACHE_KEY,
    ServerSettings,
    ServerSettingsError
  >({
    capacity: 1,
    lookup: () => loadServerSettingsFromDisk(fs, settingsPath),
  })
  const getSettingsFromCache = Cache.get(settingsCache, SETTINGS_CACHE_KEY)
  const runtimeDeps = {
    settingsPath,
    fs,
    pathService,
    writeSemaphore,
    changesPubSub,
    settingsCache,
    getSettingsFromCache,
    startedRef,
    startedDeferred,
    watcherScope,
  } satisfies ServerSettingsRuntimeDeps

  return {
    start: startServerSettingsRuntime(runtimeDeps),
    ready: Deferred.await(startedDeferred),
    getSettings: getSettingsFromCache.pipe(Effect.map(resolveTextGenerationProvider)),
    updateSettings: patch => updateServerSettings(runtimeDeps, patch),
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub).pipe(Stream.map(resolveTextGenerationProvider))
    },
  } satisfies ServerSettingsShape
})

export const ServerSettingsLive = Layer.effect(ServerSettingsService, makeServerSettings)
