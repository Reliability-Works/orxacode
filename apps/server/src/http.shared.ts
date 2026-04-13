import type { HttpServerRequest } from 'effect/unstable/http'

export function corsHeaders(request: HttpServerRequest.HttpServerRequest) {
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
