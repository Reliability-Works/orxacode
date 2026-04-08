/**
 * Keybindings - Keybinding configuration service definitions.
 *
 * Owns parsing, validation, merge, and persistence of user keybinding
 * configuration consumed by the server runtime.
 *
 * @module Keybindings
 */
import {
  KeybindingRule,
  KeybindingsConfigError,
  ResolvedKeybindingsConfig,
} from '@orxa-code/contracts'
import {
  Cache,
  Deferred,
  Effect,
  Exit,
  FileSystem,
  Path,
  Layer,
  PubSub,
  Ref,
  ServiceMap,
  Scope,
  Stream,
} from 'effect'
import * as Semaphore from 'effect/Semaphore'
import { ServerConfig } from './config'
import { type KeybindingsChangeEvent, type KeybindingsConfigState } from './keybindings.logic'
import {
  buildKeybindingsOperations,
  createKeybindingsConfigAccessors,
  type ResolvedConfigCacheKey,
  KEYBINDINGS_RESOLVED_CONFIG_CACHE_KEY,
} from './keybindings.operations'
import { createKeybindingsShape, createLoadConfigStateFromDisk } from './keybindings.runtime'

/**
 * KeybindingsShape - Service API for keybinding configuration operations.
 */
export interface KeybindingsShape {
  /**
   * Start the keybindings runtime and attach file watching.
   *
   * Safe to call multiple times. The first successful call establishes the
   * runtime; later calls await the same startup.
   */
  readonly start: Effect.Effect<void, KeybindingsConfigError>

  /**
   * Await keybindings runtime readiness.
   *
   * Readiness means the config directory exists, the watcher is attached, the
   * startup sync has completed, and the current snapshot has been loaded.
   */
  readonly ready: Effect.Effect<void, KeybindingsConfigError>

  /**
   * Ensure the on-disk keybindings file exists and includes all default
   * commands so newly-added defaults are backfilled on startup.
   */
  readonly syncDefaultKeybindingsOnStartup: Effect.Effect<void, KeybindingsConfigError>

  /**
   * Load runtime keybindings state along with non-fatal configuration issues.
   */
  readonly loadConfigState: Effect.Effect<KeybindingsConfigState, KeybindingsConfigError>

  /**
   * Read the latest keybindings snapshot from cache/disk.
   */
  readonly getSnapshot: Effect.Effect<KeybindingsConfigState, KeybindingsConfigError>

  /**
   * Stream of keybindings config change events.
   */
  readonly streamChanges: Stream.Stream<KeybindingsChangeEvent>

  /**
   * Upsert a keybinding rule and persist the resulting configuration.
   *
   * Writes config atomically and enforces the max rule count by truncating
   * oldest entries when needed.
   */
  readonly upsertKeybindingRule: (
    rule: KeybindingRule
  ) => Effect.Effect<ResolvedKeybindingsConfig, KeybindingsConfigError>
}

/**
 * Keybindings - Service tag for keybinding configuration operations.
 */
export class Keybindings extends ServiceMap.Service<Keybindings, KeybindingsShape>()(
  'orxacode/keybindings'
) {}

const makeKeybindings = Effect.gen(function* () {
  const { keybindingsConfigPath } = yield* ServerConfig
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const upsertSemaphore = yield* Semaphore.make(1)
  const changesPubSub = yield* PubSub.unbounded<KeybindingsChangeEvent>()
  const startedRef = yield* Ref.make(false)
  const startedDeferred = yield* Deferred.make<void, KeybindingsConfigError>()
  const watcherScope = yield* Scope.make('sequential')
  yield* Effect.addFinalizer(() => Scope.close(watcherScope, Exit.void))
  const emitChange = (configState: KeybindingsConfigState) =>
    PubSub.publish(changesPubSub, configState).pipe(Effect.asVoid)

  const accessors = createKeybindingsConfigAccessors({ fs, path, keybindingsConfigPath })
  const loadConfigStateFromDisk = createLoadConfigStateFromDisk(
    accessors.loadRuntimeCustomKeybindingsConfig()
  )

  const resolvedConfigCache = yield* Cache.make<
    ResolvedConfigCacheKey,
    KeybindingsConfigState,
    KeybindingsConfigError
  >({
    capacity: 1,
    lookup: () => loadConfigStateFromDisk,
  })

  const loadConfigStateFromCacheOrDisk = Cache.get(
    resolvedConfigCache,
    KEYBINDINGS_RESOLVED_CONFIG_CACHE_KEY
  )

  const { start, syncDefaultKeybindingsOnStartup, upsertKeybindingRule } =
    buildKeybindingsOperations({
      accessors,
      resolvedConfigCache,
      loadConfigStateFromCacheOrDisk,
      upsertSemaphore,
      keybindingsConfigPath,
      fs,
      path,
      watcherScope,
      startedRef,
      startedDeferred,
      emitChange,
    })

  return createKeybindingsShape({
    start,
    startedDeferred,
    syncDefaultKeybindingsOnStartup,
    loadConfigStateFromCacheOrDisk,
    changesPubSub,
    upsertKeybindingRule,
  })
})

export const KeybindingsLive = Layer.effect(Keybindings, makeKeybindings)

export {
  DEFAULT_KEYBINDINGS,
  KeybindingsConfigPrettyJson,
  RawKeybindingsEntries,
  ResolvedKeybindingFromConfig,
  ResolvedKeybindingsFromConfig,
  compileResolvedKeybindingRule,
  compileResolvedKeybindingsConfig,
  parseKeybindingShortcut,
} from './keybindings.logic'
