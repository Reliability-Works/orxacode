import type {
  AuthBearerBootstrapResult,
  ExecutionEnvironmentDescriptor,
  OrchestrationReadModel,
  ServerConfig,
} from '@orxa-code/contracts'

const MOBILE_SYNC_TRACE_REVISION = 'mobile-reopen-probe-1'
const REMOTE_AUTH_REQUEST_TIMEOUT_MS = 10_000

class RemoteEnvironmentAuthHttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'RemoteEnvironmentAuthHttpError'
    this.status = status
  }
}

function remoteEndpointUrl(httpBaseUrl: string, pathname: string): string {
  const url = new URL(httpBaseUrl)
  url.pathname = pathname
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function readRemoteAuthErrorMessage(
  response: Response,
  fallbackMessage: string
): Promise<string> {
  const text = await response.text()
  if (!text) {
    return fallbackMessage
  }

  try {
    const parsed = JSON.parse(text) as { readonly error?: string }
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      return parsed.error
    }
  } catch {
    // Fall back to raw text below.
  }

  return text
}

function logRemoteApi(event: string, data: Record<string, unknown>) {
  if (typeof window === 'undefined') {
    return
  }

  console.info('[mobile-sync] remote api', {
    event,
    revision: MOBILE_SYNC_TRACE_REVISION,
    ...data,
  })
}

function logRemoteApiError(event: string, data: Record<string, unknown>) {
  if (typeof window === 'undefined') {
    return
  }

  console.error('[mobile-sync] remote api', {
    event,
    revision: MOBILE_SYNC_TRACE_REVISION,
    ...data,
  })
}

async function fetchRemoteJson<T>(input: {
  readonly httpBaseUrl: string
  readonly pathname: string
  readonly method?: 'GET' | 'POST'
  readonly bearerToken?: string
  readonly body?: unknown
}): Promise<T> {
  const requestUrl = remoteEndpointUrl(input.httpBaseUrl, input.pathname)
  const startedAt = Date.now()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_AUTH_REQUEST_TIMEOUT_MS)
  logRemoteApi('fetch-start', {
    method: input.method ?? 'GET',
    pathname: input.pathname,
    requestUrl,
  })
  let response: Response
  try {
    response = await fetch(requestUrl, {
      method: input.method ?? 'GET',
      headers: {
        ...(input.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(input.bearerToken ? { authorization: `Bearer ${input.bearerToken}` } : {}),
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timeoutId)
    const durationMs = Date.now() - startedAt
    const message =
      error instanceof DOMException && error.name === 'AbortError'
        ? `Remote auth request timed out after ${REMOTE_AUTH_REQUEST_TIMEOUT_MS}ms.`
        : (error as Error).message
    logRemoteApiError('fetch-error', {
      method: input.method ?? 'GET',
      pathname: input.pathname,
      requestUrl,
      durationMs,
      message,
    })
    throw new Error(
      `Failed to fetch remote auth endpoint ${requestUrl} (${message}).`,
      { cause: error }
    )
  }
  clearTimeout(timeoutId)

  logRemoteApi('fetch-response', {
    method: input.method ?? 'GET',
    pathname: input.pathname,
    requestUrl,
    durationMs: Date.now() - startedAt,
    status: response.status,
  })

  if (!response.ok) {
    throw new RemoteEnvironmentAuthHttpError(
      await readRemoteAuthErrorMessage(response, `Remote auth request failed (${response.status}).`),
      response.status
    )
  }

  return (await response.json()) as T
}

export async function bootstrapRemoteBearerSession(input: {
  readonly httpBaseUrl: string
  readonly credential: string
}): Promise<AuthBearerBootstrapResult> {
  return fetchRemoteJson<AuthBearerBootstrapResult>({
    httpBaseUrl: input.httpBaseUrl,
    pathname: '/api/auth/bootstrap/bearer',
    method: 'POST',
    body: {
      credential: input.credential,
    },
  })
}

export async function fetchRemoteEnvironmentDescriptor(input: {
  readonly httpBaseUrl: string
}): Promise<ExecutionEnvironmentDescriptor> {
  return fetchRemoteJson<ExecutionEnvironmentDescriptor>({
    httpBaseUrl: input.httpBaseUrl,
    pathname: '/.well-known/orxa/environment',
  })
}

export async function resolveRemoteWebSocketConnectionUrl(input: {
  readonly wsBaseUrl: string
  readonly bearerToken: string
}): Promise<string> {
  logRemoteApi('resolve-ws-url-start', {
    wsBaseUrl: input.wsBaseUrl,
  })
  const url = new URL(input.wsBaseUrl, window.location.origin)
  url.pathname = '/ws'
  url.search = ''
  url.hash = ''
  url.searchParams.set('token', input.bearerToken)
  const resolvedUrl = new URL(url.toString())
  if (resolvedUrl.searchParams.has('token')) {
    resolvedUrl.searchParams.set('token', '[redacted]')
  }
  logRemoteApi('resolve-ws-url-done', {
    wsBaseUrl: input.wsBaseUrl,
    resolvedUrl: resolvedUrl.toString(),
  })
  return url.toString()
}

export async function fetchRemoteMobileSyncBootstrap(input: {
  readonly httpBaseUrl: string
  readonly bearerToken: string
}): Promise<{
  readonly config: ServerConfig
  readonly readModel: OrchestrationReadModel
}> {
  return fetchRemoteJson<{
    readonly config: ServerConfig
    readonly readModel: OrchestrationReadModel
  }>({
    httpBaseUrl: input.httpBaseUrl,
    pathname: '/api/mobile-sync/bootstrap',
    bearerToken: input.bearerToken,
  })
}
