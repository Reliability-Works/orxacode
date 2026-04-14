const BACKEND_READY_PROBE_TIMEOUT_MS = 1_000

export async function waitForBackendReady(input: {
  readonly log: (message: string) => void
  readonly port: number
  readonly maxWaitMs?: number
}): Promise<void> {
  const intervalMs = 200
  const maxWaitMs = input.maxWaitMs ?? 15_000
  const maxAttempts = Math.ceil(maxWaitMs / intervalMs)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${input.port}/.well-known/orxa/environment`, {
        signal: AbortSignal.timeout(BACKEND_READY_PROBE_TIMEOUT_MS),
      })
      if (response.ok) {
        input.log(`backend ready after ${attempt + 1} attempts`)
        return
      }
    } catch {
      // Server not listening yet
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  input.log(`backend readiness check timed out after ${maxWaitMs}ms, proceeding anyway`)
}
