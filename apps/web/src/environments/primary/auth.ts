import type { AuthBootstrapResult, AuthSessionState } from '@orxa-code/contracts'

import { getPairingTokenFromUrl, stripPairingTokenFromUrl } from '../../pairingUrl'
import { readPrimaryEnvironmentTarget } from './target'
import { PrimaryEnvironmentUnavailableError } from './context'
import { resolvePrimaryEnvironmentBootstrap, resolvePrimaryEnvironmentHttpUrl } from './target'

export interface PrimaryAuthGateStateAuthenticated {
  readonly status: 'authenticated'
}

export interface PrimaryAuthGateStateRequiresAuth {
  readonly status: 'requires-auth'
  readonly auth: AuthSessionState['auth']
  readonly errorMessage?: string
}

export type PrimaryAuthGateState =
  | PrimaryAuthGateStateAuthenticated
  | PrimaryAuthGateStateRequiresAuth

let bootstrapPromise: Promise<PrimaryAuthGateState> | null = null
let primarySessionToken: string | null = null
const PRIMARY_AUTH_BOOTSTRAP_TIMEOUT_MS = 3_000

function unauthenticatedSessionState(): AuthSessionState {
  return {
    authenticated: false,
    auth: {
      mode: 'token',
    },
  }
}

export function peekPairingTokenFromUrl(): string | null {
  return getPairingTokenFromUrl(new URL(window.location.href))
}

export function takePairingTokenFromUrl(): string | null {
  const url = new URL(window.location.href)
  const token = getPairingTokenFromUrl(url)
  if (!token) {
    return null
  }
  const strippedUrl = stripPairingTokenFromUrl(url)
  window.history.replaceState({}, document.title, strippedUrl.toString())
  return token
}

export async function fetchSessionState(): Promise<AuthSessionState> {
  const targetSource = readPrimaryEnvironmentTarget().source
  const canFallBack = targetSource !== 'desktop-managed'
  let response: Response
  try {
    response = await fetch(resolvePrimaryEnvironmentHttpUrl('/api/auth/session'), {
      credentials: 'include',
    })
  } catch (error) {
    if (canFallBack) {
      return unauthenticatedSessionState()
    }
    throw error
  }
  if (!response.ok) {
    throw new Error(`Failed to load server auth session state (${response.status}).`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    const text = await response.text()
    if (canFallBack && /^\s*</.test(text)) {
      return unauthenticatedSessionState()
    }
    throw new PrimaryEnvironmentUnavailableError('Primary auth session endpoint returned HTML.')
  }
  return (await response.json()) as AuthSessionState
}

async function exchangeBootstrapCredential(credential: string): Promise<AuthBootstrapResult> {
  const response = await fetch(resolvePrimaryEnvironmentHttpUrl('/api/auth/bootstrap'), {
    method: 'POST',
    credentials: 'include',
    signal: AbortSignal.timeout(PRIMARY_AUTH_BOOTSTRAP_TIMEOUT_MS),
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({ credential }),
  })

  if (!response.ok) {
    const message = (await response.text()).trim()
    throw new Error(message || `Failed to bootstrap auth session (${response.status}).`)
  }

  const result = (await response.json()) as AuthBootstrapResult
  if (result.sessionToken) {
    primarySessionToken = result.sessionToken
  }
  return result
}

async function bootstrapPrimaryAuth(): Promise<PrimaryAuthGateState> {
  let currentSession: AuthSessionState
  try {
    currentSession = await fetchSessionState()
  } catch {
    return {
      status: 'requires-auth',
      auth: unauthenticatedSessionState().auth,
    }
  }
  if (currentSession.authenticated) {
    return { status: 'authenticated' }
  }

  const bootstrapCredential = (await resolvePrimaryEnvironmentBootstrap())?.bootstrapToken ?? null
  if (!bootstrapCredential) {
    return {
      status: 'requires-auth',
      auth: currentSession.auth,
    }
  }

  try {
    await exchangeBootstrapCredential(bootstrapCredential)
    return { status: 'authenticated' }
  } catch (error) {
    return {
      status: 'requires-auth',
      auth: currentSession.auth,
      errorMessage: error instanceof Error ? error.message : 'Authentication failed.',
    }
  }
}

export function resolveInitialPrimaryAuthGateState(): Promise<PrimaryAuthGateState> {
  if (bootstrapPromise) {
    return bootstrapPromise
  }

  const nextPromise = bootstrapPrimaryAuth()
  bootstrapPromise = nextPromise.finally(() => {
    if (bootstrapPromise === nextPromise) {
      bootstrapPromise = null
    }
  })
  return bootstrapPromise
}

export function resetPrimaryAuthGateStateForTests(): void {
  bootstrapPromise = null
  primarySessionToken = null
}

export async function resolvePrimaryWebSocketConnectionUrl(wsBaseUrl: string): Promise<string> {
  await refreshPrimaryAuthSession()
  const url = new URL(wsBaseUrl, window.location.origin)
  url.pathname = '/ws'
  url.search = ''
  url.hash = ''
  if (primarySessionToken) {
    url.searchParams.set('token', primarySessionToken)
  }
  return url.toString()
}

export async function refreshPrimaryAuthSession(): Promise<void> {
  const bootstrap = await resolvePrimaryEnvironmentBootstrap()
  if (readPrimaryEnvironmentTarget().source !== 'desktop-managed') {
    return
  }
  const bootstrapCredential = bootstrap?.bootstrapToken?.trim() ?? ''
  if (!bootstrapCredential) {
    throw new Error('Desktop-managed primary environment is missing its bootstrap token.')
  }

  primarySessionToken = null
  await exchangeBootstrapCredential(bootstrapCredential)
}
