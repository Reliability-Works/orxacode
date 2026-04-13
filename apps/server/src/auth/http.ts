import type {
  AuthBearerBootstrapResult,
  AuthBootstrapResult,
  AuthClientSession,
} from '@orxa-code/contracts'
import {
  AuthBootstrapInput,
} from '@orxa-code/contracts'
import { Effect } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'

import { AuthError, ServerAuth } from './service'

function corsHeaders(request: HttpServerRequest.HttpServerRequest) {
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : null
  return {
    Vary: 'Origin',
    ...(origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Headers': 'authorization, content-type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        }
      : {}),
  } as const
}

function deriveAuthClientMetadata(request: HttpServerRequest.HttpServerRequest) {
  const forwardedFor = request.headers['x-forwarded-for']
  const ipAddress =
    typeof forwardedFor === 'string'
      ? forwardedFor.split(',')[0]?.trim() ?? undefined
      : undefined
  return {
    ...(typeof request.headers['user-agent'] === 'string'
      ? { userAgent: request.headers['user-agent'] }
      : {}),
    ...(ipAddress && ipAddress.length > 0 ? { ipAddress } : {}),
  }
}

export const respondToAuthError = (
  request: HttpServerRequest.HttpServerRequest,
  error: AuthError
) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      {
        error: error.message,
      },
      { status: error.status ?? 500, headers: corsHeaders(request) }
    )
  )

export const authPreflightRouteLayer = HttpRouter.add(
  'OPTIONS',
  '/api/auth/*',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return HttpServerResponse.text('', {
      status: 204,
      headers: corsHeaders(request),
    })
  })
)

export const authSessionRouteLayer = HttpRouter.add(
  'GET',
  '/api/auth/session',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const serverAuth = yield* ServerAuth
    const session = yield* serverAuth.getSessionState(request)
    return HttpServerResponse.jsonUnsafe(session, { status: 200, headers: corsHeaders(request) })
  })
)

export const authBootstrapRouteLayer = HttpRouter.add(
  'POST',
  '/api/auth/bootstrap',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return yield* Effect.gen(function* () {
      const payload = yield* HttpServerRequest.schemaBodyJson(AuthBootstrapInput).pipe(
        Effect.mapError(
          cause =>
            new AuthError({
              message: 'Invalid bootstrap payload.',
              status: 400,
              cause,
            })
        )
      )
      const serverAuth = yield* ServerAuth
      const result = yield* serverAuth.exchangeBootstrapCredential(
        payload.credential,
        deriveAuthClientMetadata(request)
      )

      return yield* HttpServerResponse.jsonUnsafe(result.response satisfies AuthBootstrapResult, {
        status: 200,
        headers: corsHeaders(request),
      }).pipe(
        HttpServerResponse.setCookie(serverAuth.cookieName, result.sessionToken, {
          expires: new Date(result.response.expiresAt),
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
        })
      )
    }).pipe(Effect.catchTag('AuthError', error => respondToAuthError(request, error)))
  })
)

export const authBearerBootstrapRouteLayer = HttpRouter.add(
  'POST',
  '/api/auth/bootstrap/bearer',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return yield* Effect.gen(function* () {
      const payload = yield* HttpServerRequest.schemaBodyJson(AuthBootstrapInput).pipe(
        Effect.mapError(
          cause =>
            new AuthError({
              message: 'Invalid bootstrap payload.',
              status: 400,
              cause,
            })
        )
      )
      const serverAuth = yield* ServerAuth
      const result = yield* serverAuth.exchangeBootstrapCredentialForBearerSession(
        payload.credential,
        deriveAuthClientMetadata(request)
      )
      return HttpServerResponse.jsonUnsafe(result satisfies AuthBearerBootstrapResult, {
        status: 200,
        headers: corsHeaders(request),
      })
    }).pipe(Effect.catchTag('AuthError', error => respondToAuthError(request, error)))
  })
)

export const authClientsRouteLayer = HttpRouter.add(
  'GET',
  '/api/auth/clients',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return yield* Effect.gen(function* () {
      const serverAuth = yield* ServerAuth
      const session = yield* serverAuth.authenticateHttpRequest(request)
      if (session.role !== 'owner') {
        return yield* new AuthError({
          message: 'Only owner sessions can manage paired clients.',
          status: 403,
        })
      }
      const sessions = yield* serverAuth.listClientSessions(session.sessionId)
      return HttpServerResponse.jsonUnsafe(sessions satisfies ReadonlyArray<AuthClientSession>, {
        status: 200,
        headers: corsHeaders(request),
      })
    }).pipe(Effect.catchTag('AuthError', error => respondToAuthError(request, error)))
  })
)

export const authClientsRevokeRouteLayer = HttpRouter.add(
  'POST',
  '/api/auth/clients/revoke',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return yield* Effect.gen(function* () {
      const body = yield* request.json.pipe(Effect.catch(() => Effect.succeed({} as unknown)))
      const sessionId =
        body && typeof body === 'object' && typeof (body as { sessionId?: unknown }).sessionId === 'string'
          ? (body as { sessionId: string }).sessionId
          : null
      if (!sessionId) {
        return yield* new AuthError({
          message: 'Invalid revoke payload.',
          status: 400,
        })
      }
      const serverAuth = yield* ServerAuth
      const ownerSession = yield* serverAuth.authenticateHttpRequest(request)
      if (ownerSession.role !== 'owner') {
        return yield* new AuthError({
          message: 'Only owner sessions can revoke clients.',
          status: 403,
        })
      }
      const revoked = yield* serverAuth.revokeClientSession(sessionId)
      return HttpServerResponse.jsonUnsafe(
        { revoked },
        { status: 200, headers: corsHeaders(request) }
      )
    }).pipe(Effect.catchTag('AuthError', error => respondToAuthError(request, error)))
  })
)

export const authClientsRevokeOthersRouteLayer = HttpRouter.add(
  'POST',
  '/api/auth/clients/revoke-others',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return yield* Effect.gen(function* () {
      const serverAuth = yield* ServerAuth
      const session = yield* serverAuth.authenticateHttpRequest(request)
      if (session.role !== 'owner') {
        return yield* new AuthError({
          message: 'Only owner sessions can revoke clients.',
          status: 403,
        })
      }
      const revokedCount = yield* serverAuth.revokeOtherClientSessions(session.sessionId)
      return HttpServerResponse.jsonUnsafe(
        { revokedCount },
        { status: 200, headers: corsHeaders(request) }
      )
    }).pipe(Effect.catchTag('AuthError', error => respondToAuthError(request, error)))
  })
)
