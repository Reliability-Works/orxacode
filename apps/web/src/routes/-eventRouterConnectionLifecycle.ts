import { Throttler } from '@tanstack/react-pacer'

import { isTransportConnectionErrorMessage } from '../rpc/transportError'

const RECOVERY_TRANSPORT_RETRY_DELAY_MS = 250
const MAX_RECOVERY_TRANSPORT_RETRIES = 12
const DEFAULT_RECOVERY_TIMEOUT_MS = 3_000
export const SNAPSHOT_RECOVERY_TIMEOUT_MS = 20_000
export const REPLAY_RECOVERY_TIMEOUT_MS = 10_000

function formatErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return String(error)
}

function isTransportTimeoutErrorMessage(message: string) {
  return /\bTransportTimeoutError\b/i.test(message)
}

function withOperationTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`TransportTimeoutError: ${label}`))
    }, timeoutMs)

    void operation().then(
      value => {
        window.clearTimeout(timeoutId)
        resolve(value)
      },
      error => {
        window.clearTimeout(timeoutId)
        reject(error)
      }
    )
  })
}

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    window.setTimeout(resolve, ms)
  })
}

export async function retryTransportRecoveryOperation<T>(
  operation: () => Promise<T>,
  isDisposed: () => boolean,
  options?: {
    timeoutMs?: number
    label?: string
    reconnect?: () => Promise<void>
  }
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withOperationTimeout(
        operation,
        options?.timeoutMs ?? DEFAULT_RECOVERY_TIMEOUT_MS,
        options?.label ?? 'operation'
      )
    } catch (error) {
      const formattedError = formatErrorMessage(error)
      if (
        isDisposed() ||
        (!isTransportConnectionErrorMessage(formattedError) &&
          !isTransportTimeoutErrorMessage(formattedError)) ||
        attempt >= MAX_RECOVERY_TRANSPORT_RETRIES - 1
      ) {
        throw error
      }
      await options?.reconnect?.()
      await sleep(RECOVERY_TRANSPORT_RETRY_DELAY_MS)
      if (isDisposed()) {
        throw error
      }
    }
  }
}

export function registerForegroundReconcileListeners(
  runConnectionReconcile: () => Promise<void>,
  isDisposed: () => boolean
) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => undefined
  }

  const connectionReconcileThrottler = new Throttler<() => void>(
    () => {
      if (isDisposed()) {
        return
      }
      void runConnectionReconcile()
    },
    { wait: 350, leading: true, trailing: false }
  )
  const scheduleConnectionReconcile = () => {
    if (!isDisposed()) {
      void connectionReconcileThrottler.maybeExecute()
    }
  }
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      scheduleConnectionReconcile()
    }
  }
  const intervalId = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      scheduleConnectionReconcile()
    }
  }, 10_000)

  window.addEventListener('focus', scheduleConnectionReconcile)
  window.addEventListener('pageshow', scheduleConnectionReconcile)
  window.addEventListener('online', scheduleConnectionReconcile)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  return () => {
    connectionReconcileThrottler.cancel()
    window.clearInterval(intervalId)
    window.removeEventListener('focus', scheduleConnectionReconcile)
    window.removeEventListener('pageshow', scheduleConnectionReconcile)
    window.removeEventListener('online', scheduleConnectionReconcile)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}
