import { randomBytes, randomUUID } from 'node:crypto'

import type {
  AuthBootstrapResult,
  AuthBearerBootstrapResult,
  AuthClientMetadata,
  AuthClientSession,
  AuthSessionMethod,
  AuthSessionRole,
  AuthSessionState,
} from '@orxa-code/contracts'
import { Data, ServiceMap } from 'effect'
import type * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest'
import type * as Socket from 'effect/unstable/socket/Socket'

import { ServerConfig } from '../config'

export const AUTHORIZATION_PREFIX = 'Bearer '
export const SESSION_COOKIE_NAME = 'orxa_session'
export const SESSION_TOKEN_QUERY_PARAM = 'token'
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30
export const REMOTE_PAIRING_CREDENTIAL_SUBJECT = 'remote-pairing'
export const DESKTOP_BOOTSTRAP_CREDENTIAL_SUBJECT = 'desktop-bootstrap'

export type BootstrapCredentialRecord = {
  readonly credential: string
  readonly role: AuthSessionRole
  readonly subject: string
  readonly label?: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly revokedAt: string | null
}

export type SessionRecord = {
  readonly sessionId: string
  readonly token: string
  readonly role: AuthSessionRole
  readonly method: AuthSessionMethod
  readonly subject: string
  readonly client: AuthClientMetadata
  readonly issuedAt: string
  readonly expiresAt: string
  readonly revokedAt: string | null
  readonly connected: boolean
  readonly lastConnectedAt: string | null
}

export type AuthState = {
  readonly bootstrapCredentials: Map<string, BootstrapCredentialRecord>
  readonly sessionsById: Map<string, SessionRecord>
  readonly sessionsByToken: Map<string, string>
}

export type AuthenticatedSession = {
  readonly sessionId: string
  readonly subject: string
  readonly role: AuthSessionRole
  readonly method: AuthSessionMethod
  readonly expiresAt: string
}

export type BootstrapExchangeResult = {
  readonly response: AuthBootstrapResult
  readonly sessionToken: string
}

export type StateMutationResult<T> =
  | {
      readonly ok: true
      readonly value: T
    }
  | {
      readonly ok: false
      readonly error: AuthError
    }

export type BootstrapClientMetadata = {
  readonly userAgent?: string
  readonly ipAddress?: string
  readonly label?: string
}

export type LiveSessionSocketRegistration = {
  readonly sessionId: string
  readonly role: AuthSessionRole
  readonly close: (closeEvent: Socket.CloseEvent) => import('effect').Effect.Effect<void>
}

export class AuthError extends Data.TaggedError('AuthError')<{
  readonly message: string
  readonly status?: number
  readonly cause?: unknown
}> {}

export const defaultAuthDescriptor: AuthSessionState['auth'] = {
  mode: 'token',
}

export function nowIso() {
  return new Date().toISOString()
}

export function expiresAtIso(ttlMs: number) {
  return new Date(Date.now() + ttlMs).toISOString()
}

export function isExpired(isoDate: string): boolean {
  return Date.parse(isoDate) <= Date.now()
}

export function parseBearerToken(request: HttpServerRequest.HttpServerRequest): string | null {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith(AUTHORIZATION_PREFIX)) {
    return null
  }
  const token = header.slice(AUTHORIZATION_PREFIX.length).trim()
  return token.length > 0 ? token : null
}

export function deriveClientMetadata(input: BootstrapClientMetadata): AuthClientMetadata {
  return {
    ...(input.userAgent && input.userAgent.length > 0 ? { userAgent: input.userAgent } : {}),
    ...(input.ipAddress && input.ipAddress.length > 0 ? { ipAddress: input.ipAddress } : {}),
    ...(input.label && input.label.length > 0 ? { label: input.label } : {}),
  }
}

export function createInitialBootstrapCredentials(config: typeof ServerConfig.Service): AuthState {
  const bootstrapCredentials = new Map<string, BootstrapCredentialRecord>()
  const issuedAt = nowIso()
  const expiresAt = expiresAtIso(SESSION_TTL_MS)

  if (config.authToken) {
    bootstrapCredentials.set(config.authToken, {
      credential: config.authToken,
      role: 'owner',
      subject: DESKTOP_BOOTSTRAP_CREDENTIAL_SUBJECT,
      issuedAt,
      expiresAt,
      revokedAt: null,
    })
  }

  if (config.remoteAccessBootstrapToken) {
    bootstrapCredentials.set(config.remoteAccessBootstrapToken, {
      credential: config.remoteAccessBootstrapToken,
      role: 'client',
      subject: REMOTE_PAIRING_CREDENTIAL_SUBJECT,
      label: 'Remote pairing',
      issuedAt,
      expiresAt,
      revokedAt: null,
    })
  }

  return {
    bootstrapCredentials,
    sessionsById: new Map<string, SessionRecord>(),
    sessionsByToken: new Map<string, string>(),
  }
}

export function toAuthenticatedSession(session: SessionRecord): AuthenticatedSession {
  return {
    sessionId: session.sessionId,
    subject: session.subject,
    role: session.role,
    method: session.method,
    expiresAt: session.expiresAt,
  }
}

export function toClientSession(
  session: SessionRecord,
  currentSessionId: string | null
): AuthClientSession {
  return {
    sessionId: session.sessionId,
    subject: session.subject,
    role: session.role,
    method: session.method,
    client: session.client,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
    lastConnectedAt: session.lastConnectedAt,
    connected: session.connected,
    current: currentSessionId === session.sessionId,
  }
}

export function issueSessionRecord(input: {
  role: AuthSessionRole
  method: AuthSessionMethod
  subject: string
  client: AuthClientMetadata
}): SessionRecord {
  return {
    sessionId: randomUUID(),
    token: randomBytes(24).toString('hex'),
    role: input.role,
    method: input.method,
    subject: input.subject,
    client: input.client,
    issuedAt: nowIso(),
    expiresAt: expiresAtIso(SESSION_TTL_MS),
    revokedAt: null,
    connected: false,
    lastConnectedAt: null,
  }
}

export interface ServerAuthShape {
  readonly cookieName: string
  readonly getSessionState: (
    request: HttpServerRequest.HttpServerRequest
  ) => import('effect').Effect.Effect<AuthSessionState>
  readonly exchangeBootstrapCredential: (
    credential: string,
    clientMetadata: BootstrapClientMetadata
  ) => import('effect').Effect.Effect<BootstrapExchangeResult, AuthError>
  readonly exchangeBootstrapCredentialForBearerSession: (
    credential: string,
    clientMetadata: BootstrapClientMetadata
  ) => import('effect').Effect.Effect<AuthBearerBootstrapResult, AuthError>
  readonly authenticateHttpRequest: (
    request: HttpServerRequest.HttpServerRequest
  ) => import('effect').Effect.Effect<AuthenticatedSession, AuthError>
  readonly authenticateWebSocketUpgrade: (
    request: HttpServerRequest.HttpServerRequest
  ) => import('effect').Effect.Effect<AuthenticatedSession, AuthError>
  readonly markConnected: (sessionId: string) => import('effect').Effect.Effect<void>
  readonly markDisconnected: (sessionId: string) => import('effect').Effect.Effect<void>
  readonly listClientSessions: (
    currentSessionId: string | null
  ) => import('effect').Effect.Effect<ReadonlyArray<AuthClientSession>>
  readonly revokeClientSession: (sessionId: string) => import('effect').Effect.Effect<boolean>
  readonly revokeOtherClientSessions: (
    currentSessionId: string
  ) => import('effect').Effect.Effect<number>
  readonly revokeSessionsByRole: (
    role: AuthSessionRole
  ) => import('effect').Effect.Effect<number>
  readonly registerLiveSocket: (
    registration: LiveSessionSocketRegistration
  ) => import('effect').Effect.Effect<string>
  readonly unregisterLiveSocket: (connectionId: string) => import('effect').Effect.Effect<void>
  readonly closeLiveSession: (
    sessionId: string,
    closeEvent?: Socket.CloseEvent
  ) => import('effect').Effect.Effect<number>
  readonly closeOtherLiveSessionsForRole: (
    role: AuthSessionRole,
    currentSessionId: string,
    closeEvent?: Socket.CloseEvent
  ) => import('effect').Effect.Effect<number>
}

export class ServerAuth extends ServiceMap.Service<ServerAuth, ServerAuthShape>()(
  'orxacode/server/ServerAuth'
) {}
