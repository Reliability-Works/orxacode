import type { OrchestrationThreadActivity } from '@orxa-code/contracts'
import { asObjectRecord, asTrimmedString } from '@orxa-code/shared/records'

export function isOpencodeStartupTaskId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('opencode-startup-')
}

export function isOpencodeStartupTelemetryActivity(
  activity: Pick<OrchestrationThreadActivity, 'kind' | 'payload'>
): boolean {
  if (activity.kind !== 'task.progress') {
    return false
  }
  const payload = asObjectRecord(activity.payload)
  return isOpencodeStartupTaskId(payload?.taskId)
}

export function getOpencodeStartupTelemetryMessage(
  activity: Pick<OrchestrationThreadActivity, 'summary' | 'payload'>
): string {
  const payload = asObjectRecord(activity.payload)
  return (
    asTrimmedString(payload?.summary) ??
    asTrimmedString(payload?.detail) ??
    asTrimmedString(activity.summary) ??
    'Opencode startup telemetry'
  )
}
