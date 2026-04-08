/**
 * AnalyticsServiceLive - Anonymous PostHog telemetry layer.
 *
 * Persists a random installation-scoped anonymous id to state dir, buffers
 * events in memory, and flushes batches to PostHog over Effect HttpClient.
 *
 * @module AnalyticsServiceLive
 */

import { Config, DateTime, Effect, Layer, Ref } from 'effect'
import { HttpClient, HttpClientRequest, HttpClientResponse } from 'effect/unstable/http'

import { ServerConfig } from '../../config.ts'
import { AnalyticsService, type AnalyticsServiceShape } from '../Services/AnalyticsService.ts'
import { getTelemetryIdentifier } from '../Identify.ts'
import { version } from '../../../package.json' with { type: 'json' }

interface BufferedAnalyticsEvent {
  readonly event: string
  readonly properties?: Readonly<Record<string, unknown>>
  readonly capturedAt: string
}

interface TelemetryRuntimeConfig {
  readonly telemetryConfig: {
    readonly posthogKey: string
    readonly posthogHost: string
    readonly enabled: boolean
    readonly flushBatchSize: number
    readonly maxBufferedEvents: number
  }
  readonly identifier: string | null
  readonly clientType: 'desktop-app' | 'cli-web-client'
}

const TelemetryEnvConfig = Config.all({
  posthogKey: Config.string('ORXA_POSTHOG_KEY').pipe(
    Config.withDefault('phc_XOWci4oZP4VvLiEyrFqkFjP4CZn55mjYYBMREK5Wd6m')
  ),
  posthogHost: Config.string('ORXA_POSTHOG_HOST').pipe(
    Config.withDefault('https://us.i.posthog.com')
  ),
  enabled: Config.boolean('ORXA_TELEMETRY_ENABLED').pipe(Config.withDefault(true)),
  flushBatchSize: Config.number('ORXA_TELEMETRY_FLUSH_BATCH_SIZE').pipe(Config.withDefault(20)),
  maxBufferedEvents: Config.number('ORXA_TELEMETRY_MAX_BUFFERED_EVENTS').pipe(
    Config.withDefault(1_000)
  ),
})

const enqueueBufferedEvent = (
  bufferRef: Ref.Ref<ReadonlyArray<BufferedAnalyticsEvent>>,
  maxBufferedEvents: number,
  event: string,
  properties?: Readonly<Record<string, unknown>>
) =>
  Effect.flatMap(DateTime.now, now =>
    Ref.modify(bufferRef, current => {
      const appended = [
        ...current,
        {
          event,
          ...(properties ? { properties } : {}),
          capturedAt: DateTime.formatIso(now),
        } satisfies BufferedAnalyticsEvent,
      ]

      const next =
        appended.length > maxBufferedEvents
          ? appended.slice(appended.length - maxBufferedEvents)
          : appended

      return [
        {
          size: next.length,
          dropped: next.length !== appended.length,
        } as const,
        next,
      ] as const
    })
  )

const buildBatchPayload = (
  runtimeConfig: TelemetryRuntimeConfig,
  events: ReadonlyArray<BufferedAnalyticsEvent>
) => ({
  api_key: runtimeConfig.telemetryConfig.posthogKey,
  batch: events.map(event => ({
    event: event.event,
    distinct_id: runtimeConfig.identifier,
    properties: {
      ...event.properties,
      $process_person_profile: false,
      platform: process.platform,
      wsl: process.env.WSL_DISTRO_NAME,
      arch: process.arch,
      orxaCodeVersion: version,
      clientType: runtimeConfig.clientType,
    },
    timestamp: event.capturedAt,
  })),
})

const sendBatch = (
  runtimeConfig: TelemetryRuntimeConfig,
  httpClient: HttpClient.HttpClient,
  events: ReadonlyArray<BufferedAnalyticsEvent>
) =>
  Effect.gen(function* () {
    if (!runtimeConfig.telemetryConfig.enabled || !runtimeConfig.identifier) return

    const payload = buildBatchPayload(runtimeConfig, events)
    yield* HttpClientRequest.post(`${runtimeConfig.telemetryConfig.posthogHost}/batch/`).pipe(
      HttpClientRequest.bodyJson(payload),
      Effect.flatMap(httpClient.execute),
      Effect.flatMap(HttpClientResponse.filterStatusOk)
    )
  })

const takeNextBatch = (
  bufferRef: Ref.Ref<ReadonlyArray<BufferedAnalyticsEvent>>,
  flushBatchSize: number
) =>
  Ref.modify(bufferRef, current => {
    if (current.length === 0) {
      return [[] as ReadonlyArray<BufferedAnalyticsEvent>, current] as const
    }
    const nextBatch = current.slice(0, flushBatchSize)
    const remaining = current.slice(nextBatch.length)
    return [nextBatch, remaining] as const
  })

const flushBufferedEvents = (
  bufferRef: Ref.Ref<ReadonlyArray<BufferedAnalyticsEvent>>,
  runtimeConfig: TelemetryRuntimeConfig,
  httpClient: HttpClient.HttpClient
): AnalyticsServiceShape['flush'] =>
  Effect.gen(function* () {
    while (true) {
      const batch = yield* takeNextBatch(bufferRef, runtimeConfig.telemetryConfig.flushBatchSize)
      if (batch.length === 0) {
        return
      }

      yield* sendBatch(runtimeConfig, httpClient, batch).pipe(
        Effect.catch(error =>
          Ref.update(bufferRef, current => [...batch, ...current]).pipe(
            Effect.flatMap(() => Effect.fail(error))
          )
        )
      )
    }
  }).pipe(Effect.catch(cause => Effect.logError('Failed to flush telemetry', { cause })))

const makeAnalyticsRecord = (
  bufferRef: Ref.Ref<ReadonlyArray<BufferedAnalyticsEvent>>,
  runtimeConfig: TelemetryRuntimeConfig
): AnalyticsServiceShape['record'] =>
  Effect.fnUntraced(function* (event, properties) {
    if (!runtimeConfig.telemetryConfig.enabled || !runtimeConfig.identifier) return

    const enqueueResult = yield* enqueueBufferedEvent(
      bufferRef,
      runtimeConfig.telemetryConfig.maxBufferedEvents,
      event,
      properties
    )
    if (enqueueResult.dropped) {
      yield* Effect.logDebug('analytics buffer full; dropping oldest event', {
        size: enqueueResult.size,
        event,
      })
    }
  })

const makeAnalyticsService = Effect.gen(function* () {
  const telemetryConfig = yield* TelemetryEnvConfig.asEffect()
  const httpClient = yield* HttpClient.HttpClient
  const serverConfig = yield* ServerConfig
  const identifier = yield* getTelemetryIdentifier
  const bufferRef = yield* Ref.make<ReadonlyArray<BufferedAnalyticsEvent>>([])
  const runtimeConfig = {
    telemetryConfig,
    identifier,
    clientType: serverConfig.mode === 'desktop' ? 'desktop-app' : 'cli-web-client',
  } satisfies TelemetryRuntimeConfig
  const flush = flushBufferedEvents(bufferRef, runtimeConfig, httpClient)
  const record = makeAnalyticsRecord(bufferRef, runtimeConfig)

  yield* Effect.forever(Effect.sleep(1000).pipe(Effect.flatMap(() => flush)), {
    disableYield: true,
  }).pipe(Effect.forkScoped)

  yield* Effect.addFinalizer(() => flush)

  return {
    record,
    flush,
  } satisfies AnalyticsServiceShape
})

export const AnalyticsServiceLayerLive = Layer.effect(AnalyticsService, makeAnalyticsService)
