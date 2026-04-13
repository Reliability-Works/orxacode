import { Effect } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'

import { ServerAuth } from '../auth/service'
import { respondToAuthError } from '../auth/http'
import { ServerConfig } from '../config'
import { corsHeaders } from '../http.shared'
import { loadMobileSyncBootstrap } from './bootstrap'

type MobileSyncLogEntry = {
  readonly level: 'info' | 'warn' | 'error'
  readonly text: string
  readonly timestamp: string
}

function parseMobileSyncLogEntries(body: unknown): ReadonlyArray<MobileSyncLogEntry> {
  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray((body as { entries?: unknown }).entries)
  ) {
    return []
  }

  return (body as { entries: unknown[] }).entries.flatMap(entry => {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const level = (entry as { level?: unknown }).level
    const text = (entry as { text?: unknown }).text
    const timestamp = (entry as { timestamp?: unknown }).timestamp
    if (
      (level !== 'info' && level !== 'warn' && level !== 'error') ||
      typeof text !== 'string' ||
      typeof timestamp !== 'string'
    ) {
      return []
    }

    return [
      {
        level,
        text: text.slice(0, 4000),
        timestamp,
      } satisfies MobileSyncLogEntry,
    ]
  })
}

function isMobileSyncRelayLoggingEnabled(config: typeof ServerConfig.Service) {
  return config.devUrl !== undefined || process.env.ORXA_ENABLE_MOBILE_SYNC_LOG_RELAY === '1'
}

export const mobileSyncBootstrapRouteLayer = HttpRouter.add(
  'GET',
  '/api/mobile-sync/bootstrap',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return yield* Effect.gen(function* () {
      const serverAuth = yield* ServerAuth
      yield* serverAuth.authenticateHttpRequest(request)
      const bootstrap = yield* loadMobileSyncBootstrap()
      return HttpServerResponse.text(JSON.stringify(bootstrap), {
        status: 200,
        contentType: 'application/json; charset=utf-8',
        headers: corsHeaders(request),
      })
    }).pipe(Effect.catchTag('AuthError', error => respondToAuthError(request, error)))
  })
)

export const mobileSyncLogRouteLayer = HttpRouter.add(
  'POST',
  '/api/mobile-sync/log',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return yield* Effect.gen(function* () {
      const config = yield* ServerConfig
      const serverAuth = yield* ServerAuth
      const session = yield* serverAuth.authenticateHttpRequest(request)
      const body = yield* request.json.pipe(Effect.catch(() => Effect.succeed({} as unknown)))
      const entries = parseMobileSyncLogEntries(body)

      if (isMobileSyncRelayLoggingEnabled(config)) {
        for (const entry of entries) {
          const log =
            entry.level === 'error'
              ? console.error
              : entry.level === 'warn'
                ? console.warn
                : console.info
          log('[mobile-sync][relay]', {
            sessionId: session.sessionId,
            role: session.role,
            timestamp: entry.timestamp,
            text: entry.text,
          })
        }
      }

      return HttpServerResponse.jsonUnsafe(
        { accepted: entries.length },
        { status: 200, headers: corsHeaders(request) }
      )
    }).pipe(Effect.catchTag('AuthError', error => respondToAuthError(request, error)))
  })
)

export const mobileSyncPreflightRouteLayer = HttpRouter.add(
  'OPTIONS',
  '/api/mobile-sync/*',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return HttpServerResponse.text('', {
      status: 204,
      headers: corsHeaders(request),
    })
  })
)
