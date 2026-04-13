type MobileSyncRelayContext = {
  readonly bearerToken: string
  readonly httpBaseUrl: string
}

type MobileSyncRelayEntry = {
  readonly level: 'info' | 'warn' | 'error'
  readonly text: string
  readonly timestamp: string
}

const MAX_BATCH_SIZE = 20
const MAX_TEXT_LENGTH = 4000

let relayContext: MobileSyncRelayContext | null = null
let pendingEntries: MobileSyncRelayEntry[] = []
let flushScheduled = false
let flushInFlight = false

function isMobileSyncLogRelayEnabled() {
  const env = (import.meta as ImportMeta & {
    readonly env?: Record<string, string | boolean | undefined>
  }).env
  const devValue = env?.DEV

  return (
    devValue === true ||
    String(devValue ?? '') === 'true' ||
    env?.VITE_ENABLE_MOBILE_SYNC_LOG_RELAY === '1'
  )
}

function normalizeLogUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl, window.location.origin)
  url.pathname = '/api/mobile-sync/log'
  url.search = ''
  url.hash = ''
  return url.toString()
}

async function flushEntries(): Promise<void> {
  if (flushInFlight || pendingEntries.length === 0 || relayContext === null || typeof window === 'undefined') {
    return
  }

  flushInFlight = true
  const batch = pendingEntries.slice(0, MAX_BATCH_SIZE)

  try {
    await fetch(normalizeLogUrl(relayContext.httpBaseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${relayContext.bearerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ entries: batch }),
      keepalive: true,
    })
    pendingEntries = pendingEntries.slice(batch.length)
  } catch {
    // Best-effort diagnostics only.
  } finally {
    flushInFlight = false
    if (pendingEntries.length > 0) {
      scheduleFlush()
    }
  }
}

function scheduleFlush() {
  if (flushScheduled || typeof window === 'undefined') {
    return
  }
  flushScheduled = true
  window.setTimeout(() => {
    flushScheduled = false
    void flushEntries()
  }, 150)
}

export function setMobileSyncLogRelayContext(context: MobileSyncRelayContext | null) {
  relayContext = isMobileSyncLogRelayEnabled() ? context : null
  if (relayContext && pendingEntries.length > 0) {
    scheduleFlush()
  }
}

export function relayMobileSyncLogEntry(entry: MobileSyncRelayEntry) {
  if (!isMobileSyncLogRelayEnabled() || relayContext === null) {
    return
  }

  pendingEntries = [
    ...pendingEntries.slice(-(MAX_BATCH_SIZE * 4 - 1)),
    {
      ...entry,
      text: entry.text.slice(0, MAX_TEXT_LENGTH),
    },
  ]
  scheduleFlush()
}

export function resetMobileSyncLogRelayForTests() {
  relayContext = null
  pendingEntries = []
  flushScheduled = false
  flushInFlight = false
}
