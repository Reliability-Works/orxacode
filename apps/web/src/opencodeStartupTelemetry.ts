import type { OrchestrationThreadActivity } from '@orxa-code/contracts'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function isOpencodeStartupTaskId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('opencode-startup-')
}

export function isOpencodeStartupTelemetryActivity(
  activity: Pick<OrchestrationThreadActivity, 'kind' | 'payload'>
): boolean {
  if (activity.kind !== 'task.progress') {
    return false
  }
  const payload = asRecord(activity.payload)
  return isOpencodeStartupTaskId(payload?.taskId)
}

export function getOpencodeStartupTelemetryMessage(
  activity: Pick<OrchestrationThreadActivity, 'summary' | 'payload'>
): string {
  const payload = asRecord(activity.payload)
  return (
    asTrimmedString(payload?.summary) ??
    asTrimmedString(payload?.detail) ??
    asTrimmedString(activity.summary) ??
    'Opencode startup telemetry'
  )
}
