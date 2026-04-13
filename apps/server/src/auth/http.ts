import type {
  AuthBearerBootstrapResult,
  AuthBootstrapResult,
  AuthClientSession,
} from '@orxa-code/contracts'
import { AuthBootstrapInput } from '@orxa-code/contracts'
import { Effect } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/unstable/http'

import { corsHeaders } from '../http.shared'
import { AuthError, ServerAuth } from './service'

function deriveAuthClientMetadata(request: HttpServerRequest.HttpServerRequest) {
  const forwardedFor = request.headers['x-forwarded-for']
  const ipAddress =
    typeof forwardedFor === 'string' ? (forwardedFor.split(',')[0]?.trim() ?? undefined) : undefined
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

function readBootstrapPayload() {
  return HttpServerRequest.schemaBodyJson(AuthBootstrapInput).pipe(
    Effect.mapError(
      cause =>
        new AuthError({
          message: 'Invalid bootstrap payload.',
          status: 400,
          cause,
        })
    )
  )
}

function requireOwnerSession(
  serverAuth: typeof ServerAuth.Service,
  request: HttpServerRequest.HttpServerRequest,
  message: string
) {
  return serverAuth.authenticateHttpRequest(request).pipe(
    Effect.flatMap(session =>
      session.role === 'owner'
        ? Effect.succeed(session)
        : Effect.fail(
            new AuthError({
              message,
              status: 403,
            })
          )
    )
  )
}

function createBootstrapRoute(
  path: '/api/auth/bootstrap' | '/api/auth/bootstrap/bearer',
  buildResponse: (
    serverAuth: typeof ServerAuth.Service,
    credential: string,
    request: HttpServerRequest.HttpServerRequest
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse, AuthError, never>
) {
  return HttpRouter.add(
    'POST',
    path,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      return yield* Effect.gen(function* () {
        const payload = yield* readBootstrapPayload()
        const serverAuth = yield* ServerAuth
        return yield* buildResponse(serverAuth, payload.credential, request)
      }).pipe(Effect.catchTag('AuthError', error => respondToAuthError(request, error)))
    })
  )
}

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

export const authBootstrapRouteLayer = createBootstrapRoute(
  '/api/auth/bootstrap',
  (serverAuth, credential, request) =>
    serverAuth.exchangeBootstrapCredential(credential, deriveAuthClientMetadata(request)).pipe(
      Effect.flatMap(result =>
        HttpServerResponse.jsonUnsafe(result.response satisfies AuthBootstrapResult, {
          status: 200,
          headers: corsHeaders(request),
        }).pipe(
          HttpServerResponse.setCookie(serverAuth.cookieName, result.sessionToken, {
            expires: new Date(result.response.expiresAt),
            httpOnly: true,
            path: '/',
            sameSite: 'lax',
          }),
          Effect.mapError(
            cause =>
              new AuthError({
                message: 'Failed to create bootstrap response.',
                status: 500,
                cause,
              })
          )
        )
      )
    )
)

export const authBearerBootstrapRouteLayer = createBootstrapRoute(
  '/api/auth/bootstrap/bearer',
  (serverAuth, credential, request) =>
    serverAuth
      .exchangeBootstrapCredentialForBearerSession(credential, deriveAuthClientMetadata(request))
      .pipe(
        Effect.map(result =>
          HttpServerResponse.jsonUnsafe(result satisfies AuthBearerBootstrapResult, {
            status: 200,
            headers: corsHeaders(request),
          })
        )
      )
)

export const authClientsRouteLayer = HttpRouter.add(
  'GET',
  '/api/auth/clients',
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    return yield* Effect.gen(function* () {
      const serverAuth = yield* ServerAuth
      const session = yield* requireOwnerSession(
        serverAuth,
        request,
        'Only owner sessions can manage paired clients.'
      )
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
        body &&
        typeof body === 'object' &&
        typeof (body as { sessionId?: unknown }).sessionId === 'string'
          ? (body as { sessionId: string }).sessionId
          : null
      if (!sessionId) {
        return yield* new AuthError({
          message: 'Invalid revoke payload.',
          status: 400,
        })
      }
      const serverAuth = yield* ServerAuth
      yield* requireOwnerSession(serverAuth, request, 'Only owner sessions can revoke clients.')
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
      const session = yield* requireOwnerSession(
        serverAuth,
        request,
        'Only owner sessions can revoke clients.'
      )
      const revokedCount = yield* serverAuth.revokeOtherClientSessions(session.sessionId)
      return HttpServerResponse.jsonUnsafe(
        { revokedCount },
        { status: 200, headers: corsHeaders(request) }
      )
    }).pipe(Effect.catchTag('AuthError', error => respondToAuthError(request, error)))
  })
)
