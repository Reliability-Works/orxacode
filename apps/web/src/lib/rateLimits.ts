import type { OrchestrationThreadActivity } from '@orxa-code/contracts'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatResetWindow(seconds: number | null): string | null {
  if (seconds === null || seconds <= 0) {
    return null
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  const minutes = seconds / 60
  if (minutes < 60) {
    return `${Math.round(minutes)}m`
  }
  return `${Math.round(minutes / 60)}h`
}

function describeRateLimits(payload: Record<string, unknown>): string | null {
  const remainingRequests =
    asFiniteNumber(payload.remaining_requests) ??
    asFiniteNumber(payload.remainingRequests) ??
    asFiniteNumber(payload.requests_remaining) ??
    asFiniteNumber(payload.requestsRemaining)
  const resetSeconds =
    asFiniteNumber(payload.reset_seconds) ??
    asFiniteNumber(payload.resetSeconds) ??
    asFiniteNumber(payload.seconds_until_reset) ??
    asFiniteNumber(payload.secondsUntilReset)

  if (remainingRequests !== null && resetSeconds !== null) {
    return `${remainingRequests} requests left · resets in ${formatResetWindow(resetSeconds)}`
  }
  if (remainingRequests !== null) {
    return `${remainingRequests} requests left`
  }
  if (resetSeconds !== null) {
    return `Rate limits reset in ${formatResetWindow(resetSeconds)}`
  }

  const nested = Object.values(payload).find(value => asRecord(value) !== null)
  const nestedRecord = nested ? asRecord(nested) : null
  if (nestedRecord) {
    return describeRateLimits(nestedRecord)
  }
  return null
}

export interface RateLimitSnapshot {
  readonly summary: string
  readonly updatedAt: string
}

export function deriveLatestRateLimitSnapshot(
  activities: ReadonlyArray<OrchestrationThreadActivity>
): RateLimitSnapshot | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]
    if (!activity || activity.kind !== 'rate-limits.updated') {
      continue
    }
    const payload = asRecord(activity.payload)
    if (!payload) {
      continue
    }
    const summary = describeRateLimits(payload)
    if (!summary) {
      continue
    }
    return {
      summary,
      updatedAt: activity.createdAt,
    }
  }
  return null
}
