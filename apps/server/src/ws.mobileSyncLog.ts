import { Option } from 'effect'
import * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest'

const MOBILE_SYNC_TRACE_REVISION = 'mobile-reopen-probe-1'

export function logWebSocketUpgradeRequest(request: HttpServerRequest.HttpServerRequest) {
  const requestUrl = HttpServerRequest.toURL(request)
  console.info('[mobile-sync] ws route', {
    revision: MOBILE_SYNC_TRACE_REVISION,
    event: 'upgrade-request',
    pathname: Option.isSome(requestUrl) ? requestUrl.value.pathname : null,
    hasSessionTokenQuery: Option.isSome(requestUrl) && requestUrl.value.searchParams.has('token'),
    hasAuthorizationHeader: typeof request.headers.authorization === 'string',
    origin: typeof request.headers.origin === 'string' ? request.headers.origin : null,
    userAgent:
      typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  })
}

export function logWebSocketUpgradeAuthenticated(input: {
  sessionId: string
  role: string
  method: string
}) {
  console.info('[mobile-sync] ws route', {
    revision: MOBILE_SYNC_TRACE_REVISION,
    event: 'upgrade-authenticated',
    sessionId: input.sessionId,
    role: input.role,
    method: input.method,
  })
}

export function logWebSocketUpgradeAuthError(input: { message: string; status: number }) {
  console.error('[mobile-sync] ws route', {
    revision: MOBILE_SYNC_TRACE_REVISION,
    event: 'upgrade-auth-error',
    message: input.message,
    status: input.status,
  })
}
