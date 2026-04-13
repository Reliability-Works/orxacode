import type { AuthSessionRole, AuthSessionState } from '@orxa-code/contracts'
import { Effect, Option, Ref } from 'effect'
import * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest'
import * as Socket from 'effect/unstable/socket/Socket'

import { ServerConfig } from '../config'
import { createBootstrapExchangeStateMutation } from './service.bootstrap'
import {
  createCloseLiveSession,
  createCloseOtherLiveSessionsForRole,
  createRegisterLiveSocket,
  createUnregisterLiveSocket,
  type LiveSocketState,
} from './service.liveSockets'
import {
  AuthError,
  type AuthenticatedSession,
  type AuthState,
  type BootstrapClientMetadata,
  createInitialBootstrapCredentials,
  defaultAuthDescriptor,
  expiresAtIso,
  isExpired,
  parseBearerToken,
  SESSION_COOKIE_NAME,
  SESSION_TOKEN_QUERY_PARAM,
  SESSION_TTL_MS,
  type ServerAuthShape,
  type StateMutationResult,
  toAuthenticatedSession,
  toClientSession,
} from './service.types'

function logWebSocketAuthInfo(event: string, data: Record<string, unknown>) {
  console.info('[mobile-sync] ws auth', {
    revision: 'mobile-reopen-probe-1',
    event,
    ...data,
  })
}

function logWebSocketAuthError(event: string, data: Record<string, unknown>) {
  console.error('[mobile-sync] ws auth', {
    revision: 'mobile-reopen-probe-1',
    event,
    ...data,
  })
}

function readAuthStateResult<T>(
  effect: Effect.Effect<StateMutationResult<T>, never, never>
): Effect.Effect<T, AuthError, never> {
  return Effect.gen(function* () {
    const result = yield* effect
    if (!result.ok) {
      return yield* result.error
    }
    return result.value
  })
}

function createAnonymousSession(): AuthenticatedSession {
  return {
    sessionId: 'anonymous',
    subject: 'anonymous',
    role: 'owner',
    method: 'browser-session-cookie',
    expiresAt: expiresAtIso(SESSION_TTL_MS),
  }
}

function createFindSessionByToken(
  stateRef: Ref.Ref<AuthState>
): (token: string) => Effect.Effect<AuthenticatedSession, AuthError, never> {
  return token =>
    Ref.get(stateRef).pipe(
      Effect.flatMap(state => {
        const sessionId = state.sessionsByToken.get(token)
        if (!sessionId) {
          logWebSocketAuthError('session-token-not-found', {
            hasToken: true,
          })
          return Effect.fail(
            new AuthError({
              message: 'Unauthorized request.',
              status: 401,
            })
          )
        }
        const session = state.sessionsById.get(sessionId)
        if (!session || session.revokedAt !== null || isExpired(session.expiresAt)) {
          logWebSocketAuthError('session-token-invalid', {
            sessionId,
            hasSession: Boolean(session),
            revoked: session?.revokedAt !== null,
            expired: session ? isExpired(session.expiresAt) : null,
          })
          return Effect.fail(
            new AuthError({
              message: 'Unauthorized request.',
              status: 401,
            })
          )
        }
        logWebSocketAuthInfo('session-token-authenticated', {
          sessionId,
          role: session.role,
          method: session.method,
        })
        return Effect.succeed(toAuthenticatedSession(session))
      })
    )
}

function createAuthenticateHttpRequest(input: {
  readonly requireAuth: boolean
  readonly anonymousSession: AuthenticatedSession
  readonly findSessionByToken: (token: string) => Effect.Effect<AuthenticatedSession, AuthError, never>
}) {
  return (request: HttpServerRequest.HttpServerRequest) => {
    if (!input.requireAuth) {
      return Effect.succeed(input.anonymousSession)
    }
    const token = parseBearerToken(request) ?? request.cookies[SESSION_COOKIE_NAME]
    if (!token) {
      return Effect.fail(
        new AuthError({
          message: 'Authentication required.',
          status: 401,
        })
      )
    }
    return input.findSessionByToken(token)
  }
}

function createExchangeBootstrapCredential(
  stateRef: Ref.Ref<AuthState>,
  method: 'browser-session-cookie' | 'bearer-session-token',
  closeLiveSession: (
    sessionId: string,
    closeEvent?: Socket.CloseEvent
  ) => Effect.Effect<number, never, never>
) {
  return (credential: string, clientMetadata: BootstrapClientMetadata) =>
    readAuthStateResult(
      Ref.modify(
        stateRef,
        createBootstrapExchangeStateMutation({
          credential,
          clientMetadata,
          method,
        })
      )
    ).pipe(
      Effect.tap(({ revokedSessionIds }) =>
        Effect.sync(() => {
          logWebSocketAuthInfo('bootstrap-revoked-prior-client-sessions', {
            method,
            revokedSessionIds,
          })
        })
      ),
      Effect.flatMap(({ response, revokedSessionIds }) =>
        Effect.forEach(
          revokedSessionIds,
          sessionId =>
            closeLiveSession(
              sessionId,
              new Socket.CloseEvent(4001, 'Superseded by new mobile session')
            ).pipe(Effect.forkDetach, Effect.asVoid),
          { concurrency: 'unbounded', discard: true }
        ).pipe(Effect.as(response))
      )
    )
}

function createAuthenticateWebSocketUpgrade(input: {
  readonly requireAuth: boolean
  readonly anonymousSession: AuthenticatedSession
  readonly authenticateHttpRequest: (
    request: HttpServerRequest.HttpServerRequest
  ) => Effect.Effect<AuthenticatedSession, AuthError, never>
  readonly findSessionByToken: (
    token: string
  ) => Effect.Effect<AuthenticatedSession, AuthError, never>
}) {
  return (request: HttpServerRequest.HttpServerRequest) => {
    if (!input.requireAuth) {
      return Effect.succeed(input.anonymousSession)
    }

    return Effect.gen(function* () {
      const requestUrl = HttpServerRequest.toURL(request)
      if (Option.isSome(requestUrl)) {
        const sessionToken = requestUrl.value.searchParams.get(SESSION_TOKEN_QUERY_PARAM)
        if (sessionToken && sessionToken.trim().length > 0) {
          logWebSocketAuthInfo('upgrade-using-query-session-token', {
            hasSessionTokenQuery: true,
          })
          return yield* input.findSessionByToken(sessionToken)
        }
      }
      logWebSocketAuthInfo('upgrade-using-http-auth', {
        hasAuthorizationHeader: typeof request.headers.authorization === 'string',
        hasCookieSession: typeof request.cookies[SESSION_COOKIE_NAME] === 'string',
      })
      return yield* input.authenticateHttpRequest(request)
    })
  }
}

function createGetSessionState(
  authenticateHttpRequest: (
    request: HttpServerRequest.HttpServerRequest
  ) => Effect.Effect<AuthenticatedSession, AuthError, never>
) {
  return (request: HttpServerRequest.HttpServerRequest) =>
    authenticateHttpRequest(request).pipe(
      Effect.map(
        session =>
          ({
            authenticated: true,
            auth: defaultAuthDescriptor,
            role: session.role,
            sessionMethod: session.method,
            expiresAt: session.expiresAt,
          }) satisfies AuthSessionState
      ),
      Effect.catchTag('AuthError', () =>
        Effect.succeed({
          authenticated: false,
          auth: defaultAuthDescriptor,
        } satisfies AuthSessionState)
      )
    )
}

function createMarkConnected(stateRef: Ref.Ref<AuthState>) {
  return (sessionId: string) =>
    Ref.update(stateRef, state => {
      const existing = state.sessionsById.get(sessionId)
      if (!existing) {
        return state
      }
      const nextSessionsById = new Map(state.sessionsById)
      nextSessionsById.set(sessionId, {
        ...existing,
        connected: true,
        lastConnectedAt: new Date().toISOString(),
      })
      return {
        ...state,
        sessionsById: nextSessionsById,
      }
    })
}

function createMarkDisconnected(stateRef: Ref.Ref<AuthState>) {
  return (sessionId: string) =>
    Ref.update(stateRef, state => {
      const existing = state.sessionsById.get(sessionId)
      if (!existing) {
        return state
      }
      const nextSessionsById = new Map(state.sessionsById)
      nextSessionsById.set(sessionId, {
        ...existing,
        connected: false,
      })
      return {
        ...state,
        sessionsById: nextSessionsById,
      }
    })
}

function createListClientSessions(stateRef: Ref.Ref<AuthState>) {
  return (currentSessionId: string | null) =>
    Ref.get(stateRef).pipe(
      Effect.map(state =>
        Array.from(state.sessionsById.values())
          .filter(session => session.revokedAt === null && !isExpired(session.expiresAt))
          .map(session => toClientSession(session, currentSessionId))
      )
    )
}

function createRevokeClientSession(
  stateRef: Ref.Ref<AuthState>,
  closeLiveSession: (
    sessionId: string,
    closeEvent?: Socket.CloseEvent
  ) => Effect.Effect<number, never, never>
) {
  return (sessionId: string) =>
    Ref.modify(stateRef, state => {
      const existing = state.sessionsById.get(sessionId)
      if (!existing || existing.revokedAt !== null) {
        return [null, state] as const
      }
      const revokedAt = new Date().toISOString()
      const nextSessionsById = new Map(state.sessionsById)
      nextSessionsById.set(sessionId, {
        ...existing,
        revokedAt,
        connected: false,
      })
      const nextSessionsByToken = new Map(state.sessionsByToken)
      nextSessionsByToken.delete(existing.token)
      return [
        sessionId,
        {
          ...state,
          sessionsById: nextSessionsById,
          sessionsByToken: nextSessionsByToken,
        },
      ] as const
    }).pipe(
      Effect.flatMap(revokedSessionId => {
        if (revokedSessionId === null) {
          return Effect.succeed(false)
        }
        return closeLiveSession(revokedSessionId, new Socket.CloseEvent(4001, 'Client session revoked')).pipe(
          Effect.forkDetach,
          Effect.as(true)
        )
      })
    )
}

function createRevokeOtherClientSessions(
  stateRef: Ref.Ref<AuthState>,
  revokeClientSession: (sessionId: string) => Effect.Effect<boolean, never, never>
) {
  return (currentSessionId: string) =>
    Ref.get(stateRef).pipe(
      Effect.flatMap(state =>
        Effect.forEach(
          Array.from(state.sessionsById.keys()).filter(sessionId => sessionId !== currentSessionId),
          sessionId => revokeClientSession(sessionId).pipe(Effect.map(revoked => (revoked ? 1 : 0))),
          { concurrency: 'unbounded' }
        )
      ),
      Effect.map(revoked => revoked.reduce<number>((total, next) => total + next, 0))
    )
}

function createRevokeSessionsByRole(
  stateRef: Ref.Ref<AuthState>,
  revokeClientSession: (sessionId: string) => Effect.Effect<boolean, never, never>
) {
  return (role: AuthSessionRole) =>
    Ref.get(stateRef).pipe(
      Effect.flatMap(state =>
        Effect.forEach(
          Array.from(state.sessionsById.values())
            .filter(session => session.role === role && session.revokedAt === null)
            .map(session => session.sessionId),
          sessionId => revokeClientSession(sessionId).pipe(Effect.map(revoked => (revoked ? 1 : 0))),
          { concurrency: 'unbounded' }
        )
      ),
      Effect.map(revoked => revoked.reduce<number>((total, next) => total + next, 0))
    )
}

export const makeServerAuthShape = (config: typeof ServerConfig.Service) =>
  Effect.gen(function* () {
    const stateRef = yield* Ref.make(createInitialBootstrapCredentials(config))
    const liveSocketStateRef = yield* Ref.make<LiveSocketState>({
      nextConnectionId: 1,
      handlesByConnectionId: new Map(),
    })
    const requireAuth = Boolean(config.authToken || config.remoteAccessBootstrapToken)
    const anonymousSession = createAnonymousSession()
    const findSessionByToken = createFindSessionByToken(stateRef)
    const authenticateHttpRequest = createAuthenticateHttpRequest({
      requireAuth,
      anonymousSession,
      findSessionByToken,
    })
    const registerLiveSocket = createRegisterLiveSocket(liveSocketStateRef)
    const unregisterLiveSocket = createUnregisterLiveSocket(liveSocketStateRef)
    const closeLiveSession = createCloseLiveSession(liveSocketStateRef)
    const closeOtherLiveSessionsForRole = createCloseOtherLiveSessionsForRole(liveSocketStateRef)
    const exchangeBootstrapCredential = createExchangeBootstrapCredential(
      stateRef,
      'browser-session-cookie',
      closeLiveSession
    ) as ServerAuthShape['exchangeBootstrapCredential']
    const exchangeBootstrapCredentialForBearerSession = createExchangeBootstrapCredential(
      stateRef,
      'bearer-session-token',
      closeLiveSession
    ) as ServerAuthShape['exchangeBootstrapCredentialForBearerSession']
    const authenticateWebSocketUpgrade = createAuthenticateWebSocketUpgrade({
      requireAuth,
      anonymousSession,
      authenticateHttpRequest,
      findSessionByToken,
    })
    const getSessionState = createGetSessionState(authenticateHttpRequest)
    const markConnected = createMarkConnected(stateRef)
    const markDisconnected = createMarkDisconnected(stateRef)
    const listClientSessions = createListClientSessions(stateRef)
    const revokeClientSession = createRevokeClientSession(stateRef, closeLiveSession)
    const revokeOtherClientSessions = createRevokeOtherClientSessions(stateRef, revokeClientSession)
    const revokeSessionsByRole = createRevokeSessionsByRole(stateRef, revokeClientSession)

    return {
      cookieName: SESSION_COOKIE_NAME,
      getSessionState,
      exchangeBootstrapCredential,
      exchangeBootstrapCredentialForBearerSession,
      authenticateHttpRequest,
      authenticateWebSocketUpgrade,
      markConnected,
      markDisconnected,
      listClientSessions,
      revokeClientSession,
      revokeOtherClientSessions,
      revokeSessionsByRole,
      registerLiveSocket,
      unregisterLiveSocket,
      closeLiveSession,
      closeOtherLiveSessionsForRole,
    } satisfies ServerAuthShape
  })
