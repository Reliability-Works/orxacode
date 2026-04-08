/**
 * ProviderServiceLive - Cross-provider orchestration layer.
 *
 * Routes validated transport/API calls to provider adapters through
 * `ProviderAdapterRegistry` and `ProviderSessionDirectory`, and exposes a
 * unified provider event stream for subscribers.
 *
 * It does not implement provider protocol details (adapter concern).
 *
 * @module ProviderServiceLive
 */
import { Effect, Layer } from 'effect'

import { ProviderAdapterRegistry } from '../Services/ProviderAdapterRegistry.ts'
import { ProviderService, type ProviderServiceShape } from '../Services/ProviderService.ts'
import { ProviderSessionDirectory } from '../Services/ProviderSessionDirectory.ts'
import { type EventNdjsonLogger, makeEventNdjsonLogger } from './EventNdjsonLogger.ts'
import { AnalyticsService } from '../../telemetry/Services/AnalyticsService.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { makeProviderServiceRuntime } from './ProviderService.runtime.ts'

export interface ProviderServiceLiveOptions {
  readonly canonicalEventLogPath?: string
  readonly canonicalEventLogger?: EventNdjsonLogger
}

const makeProviderService = Effect.fn('makeProviderService')(function* (
  options?: ProviderServiceLiveOptions
) {
  const analytics = yield* Effect.service(AnalyticsService)
  const serverSettings = yield* ServerSettingsService
  const canonicalEventLogger =
    options?.canonicalEventLogger ??
    (options?.canonicalEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.canonicalEventLogPath, {
          stream: 'canonical',
        })
      : undefined)

  const registry = yield* ProviderAdapterRegistry
  const directory = yield* ProviderSessionDirectory
  const runtime = yield* makeProviderServiceRuntime({
    analytics,
    serverSettings,
    registry,
    directory,
    ...(canonicalEventLogger ? { canonicalEventLogger } : {}),
  })

  yield* Effect.addFinalizer(() =>
    Effect.catch(runtime.runStopAll(), cause =>
      Effect.logWarning('failed to stop provider service', { cause })
    )
  )

  return runtime.service satisfies ProviderServiceShape
})

export const ProviderServiceLive = Layer.effect(ProviderService, makeProviderService())

export function makeProviderServiceLive(options?: ProviderServiceLiveOptions) {
  return Layer.effect(ProviderService, makeProviderService(options))
}
