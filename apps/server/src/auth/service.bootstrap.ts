import type { AuthBearerBootstrapResult } from '@orxa-code/contracts'

import {
  AuthError,
  deriveClientMetadata,
  isExpired,
  issueSessionRecord,
  type AuthState,
  type BootstrapClientMetadata,
  type BootstrapExchangeResult,
  type SessionRecord,
  type StateMutationResult,
} from './service.types'

type BootstrapExchangeMethod = 'browser-session-cookie' | 'bearer-session-token'

export type BootstrapExchangeResponse = BootstrapExchangeResult | AuthBearerBootstrapResult

export type BootstrapExchangeMutationValue = {
  readonly response: BootstrapExchangeResponse
  readonly revokedSessionIds: ReadonlyArray<string>
}

export function createBootstrapExchangeStateMutation(input: {
  readonly credential: string
  readonly clientMetadata: BootstrapClientMetadata
  readonly method: BootstrapExchangeMethod
}) {
  return (
    state: AuthState
  ): readonly [StateMutationResult<BootstrapExchangeMutationValue>, AuthState] => {
    const grant = state.bootstrapCredentials.get(input.credential)
    if (!grant || grant.revokedAt !== null || isExpired(grant.expiresAt)) {
      return [
        {
          ok: false,
          error: new AuthError({
            message: 'Invalid bootstrap credential.',
            status: 401,
          }),
        },
        state,
      ]
    }

    const session = issueSessionRecord({
      role: grant.role,
      method: input.method,
      subject: grant.subject,
      client: deriveClientMetadata(input.clientMetadata),
    })
    const nextSessionsById = new Map(state.sessionsById)
    const nextSessionsByToken = new Map(state.sessionsByToken)
    const revokedSessionIds = revokePriorClientSessionsForNewBearerSession({
      method: input.method,
      nextSessionsById,
      nextSessionsByToken,
      session,
      state,
    })

    nextSessionsById.set(session.sessionId, session)
    nextSessionsByToken.set(session.token, session.sessionId)

    return [
      {
        ok: true,
        value: {
          response: createBootstrapExchangeResponse(input.method, session),
          revokedSessionIds,
        },
      },
      {
        ...state,
        sessionsById: nextSessionsById,
        sessionsByToken: nextSessionsByToken,
      },
    ]
  }
}

function createBootstrapExchangeResponse(
  method: BootstrapExchangeMethod,
  session: SessionRecord
): BootstrapExchangeResponse {
  if (method === 'browser-session-cookie') {
    return {
      response: {
        authenticated: true,
        role: session.role,
        sessionMethod: 'browser-session-cookie',
        expiresAt: session.expiresAt,
      },
      sessionToken: session.token,
    } satisfies BootstrapExchangeResult
  }

  return {
    authenticated: true,
    role: session.role,
    sessionMethod: 'bearer-session-token',
    expiresAt: session.expiresAt,
    sessionToken: session.token,
  } as const
}

function revokePriorClientSessionsForNewBearerSession(input: {
  readonly method: BootstrapExchangeMethod
  readonly nextSessionsById: Map<string, SessionRecord>
  readonly nextSessionsByToken: Map<string, string>
  readonly session: SessionRecord
  readonly state: AuthState
}): ReadonlyArray<string> {
  if (input.method !== 'bearer-session-token' || input.session.role !== 'client') {
    return []
  }

  const revokedAt = new Date().toISOString()
  const revokedSessionIds: Array<string> = []

  for (const existingSession of input.state.sessionsById.values()) {
    if (existingSession.role !== 'client' || existingSession.revokedAt !== null) {
      continue
    }

    revokedSessionIds.push(existingSession.sessionId)
    input.nextSessionsById.set(existingSession.sessionId, {
      ...existingSession,
      revokedAt,
      connected: false,
    })
    input.nextSessionsByToken.delete(existingSession.token)
  }

  return revokedSessionIds
}
