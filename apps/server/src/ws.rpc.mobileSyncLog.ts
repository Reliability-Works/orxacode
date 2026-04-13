const MOBILE_SYNC_TRACE_REVISION = 'mobile-reopen-probe-1'

export function logWsRpcInfo(event: string, data: Record<string, unknown>) {
  console.info('[mobile-sync] ws rpc', {
    revision: MOBILE_SYNC_TRACE_REVISION,
    event,
    ...data,
  })
}

export function logWsRpcError(event: string, data: Record<string, unknown>) {
  console.error('[mobile-sync] ws rpc', {
    revision: MOBILE_SYNC_TRACE_REVISION,
    event,
    ...data,
  })
}
