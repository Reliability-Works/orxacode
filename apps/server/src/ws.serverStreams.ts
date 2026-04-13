import {
  type KeybindingsConfigError,
  type ServerConfig as ContractServerConfig,
  type ServerSettingsError,
} from '@orxa-code/contracts'
import { Effect, Stream } from 'effect'

import type { KeybindingsShape } from './keybindings'
import type { ServerLifecycleEventsShape } from './serverLifecycleEvents'
import type { ServerSettingsShape } from './serverSettings'
import type { ProviderRegistryShape } from './provider/Services/ProviderRegistry'
import { logWsRpcError, logWsRpcInfo } from './ws.rpc.mobileSyncLog'

export function createServerConfigStream(input: {
  readonly keybindings: KeybindingsShape
  readonly loadServerConfig: Effect.Effect<
    ContractServerConfig,
    KeybindingsConfigError | ServerSettingsError,
    never
  >
  readonly providerRegistry: ProviderRegistryShape
  readonly serverSettings: ServerSettingsShape
}) {
  return Stream.unwrap(
    Effect.gen(function* () {
      logWsRpcInfo('subscribeServerConfig:start', {})
      const keybindingsUpdates = input.keybindings.streamChanges.pipe(
        Stream.map(event => ({
          version: 1 as const,
          type: 'keybindingsUpdated' as const,
          payload: {
            issues: event.issues,
          },
        }))
      )
      const providerStatuses = input.providerRegistry.streamChanges.pipe(
        Stream.map(providers => ({
          version: 1 as const,
          type: 'providerStatuses' as const,
          payload: { providers },
        }))
      )
      const settingsUpdates = input.serverSettings.streamChanges.pipe(
        Stream.map(settings => ({
          version: 1 as const,
          type: 'settingsUpdated' as const,
          payload: { settings },
        }))
      )
      const snapshotConfig = yield* input.loadServerConfig.pipe(
        Effect.tap(config =>
          Effect.sync(() => {
            logWsRpcInfo('subscribeServerConfig:snapshot-ready', {
              issues: config.issues.length,
              keybindings: config.keybindings.length,
              providers: config.providers.length,
            })
          })
        ),
        Effect.tapError(cause =>
          Effect.sync(() => {
            logWsRpcError('subscribeServerConfig:snapshot-error', {
              cause,
            })
          })
        )
      )

      return Stream.concat(
        Stream.make({
          version: 1 as const,
          type: 'snapshot' as const,
          config: snapshotConfig,
        }),
        Stream.merge(keybindingsUpdates, Stream.merge(providerStatuses, settingsUpdates))
      )
    })
  )
}

export function createServerLifecycleStream(lifecycleEvents: ServerLifecycleEventsShape) {
  return Stream.unwrap(
    Effect.gen(function* () {
      logWsRpcInfo('subscribeServerLifecycle:start', {})
      const snapshot = yield* lifecycleEvents.snapshot.pipe(
        Effect.tap(snapshotState =>
          Effect.sync(() => {
            logWsRpcInfo('subscribeServerLifecycle:snapshot-ready', {
              events: snapshotState.events.length,
              sequence: snapshotState.sequence,
              eventTypes: snapshotState.events.map(event => event.type),
            })
          })
        ),
        Effect.tapError(cause =>
          Effect.sync(() => {
            logWsRpcError('subscribeServerLifecycle:snapshot-error', {
              cause,
            })
          })
        )
      )
      const snapshotEvents = Array.from(snapshot.events).toSorted(
        (left, right) => left.sequence - right.sequence
      )
      const liveEvents = lifecycleEvents.stream.pipe(
        Stream.filter(event => event.sequence > snapshot.sequence)
      )
      return Stream.concat(Stream.fromIterable(snapshotEvents), liveEvents)
    })
  )
}
