import { Schema } from 'effect'
import { IsoDateTime, TrimmedNonEmptyString } from './baseSchemas'

export const AuthSessionRole = Schema.Literals(['owner', 'client'])
export type AuthSessionRole = typeof AuthSessionRole.Type

export const AuthSessionMethod = Schema.Literals([
  'browser-session-cookie',
  'bearer-session-token',
])
export type AuthSessionMethod = typeof AuthSessionMethod.Type

export const AuthDescriptor = Schema.Struct({
  mode: Schema.Literal('token'),
})
export type AuthDescriptor = typeof AuthDescriptor.Type

export const AuthSessionState = Schema.Struct({
  authenticated: Schema.Boolean,
  auth: AuthDescriptor,
  role: Schema.optional(AuthSessionRole),
  sessionMethod: Schema.optional(AuthSessionMethod),
  expiresAt: Schema.optional(IsoDateTime),
})
export type AuthSessionState = typeof AuthSessionState.Type

export const AuthBootstrapInput = Schema.Struct({
  credential: TrimmedNonEmptyString,
})
export type AuthBootstrapInput = typeof AuthBootstrapInput.Type

export const AuthBootstrapResult = Schema.Struct({
  authenticated: Schema.Literal(true),
  role: AuthSessionRole,
  sessionMethod: Schema.Literal('browser-session-cookie'),
  expiresAt: IsoDateTime,
})
export type AuthBootstrapResult = typeof AuthBootstrapResult.Type

export const AuthBearerBootstrapResult = Schema.Struct({
  authenticated: Schema.Literal(true),
  role: AuthSessionRole,
  sessionMethod: Schema.Literal('bearer-session-token'),
  expiresAt: IsoDateTime,
  sessionToken: TrimmedNonEmptyString,
})
export type AuthBearerBootstrapResult = typeof AuthBearerBootstrapResult.Type

export const AuthClientMetadata = Schema.Struct({
  userAgent: Schema.optional(TrimmedNonEmptyString),
  ipAddress: Schema.optional(TrimmedNonEmptyString),
  label: Schema.optional(TrimmedNonEmptyString),
})
export type AuthClientMetadata = typeof AuthClientMetadata.Type

export const AuthClientSession = Schema.Struct({
  sessionId: TrimmedNonEmptyString,
  subject: TrimmedNonEmptyString,
  role: AuthSessionRole,
  method: AuthSessionMethod,
  client: AuthClientMetadata,
  issuedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  lastConnectedAt: Schema.NullOr(IsoDateTime),
  connected: Schema.Boolean,
  current: Schema.Boolean,
})
export type AuthClientSession = typeof AuthClientSession.Type
