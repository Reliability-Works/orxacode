import type { OrchestrationThreadActivity, ToolLifecycleItemType } from '@orxa-code/contracts'
import { asObjectRecord, asTrimmedString } from '@orxa-code/shared/records'

type MinimalWorkLogEntry = {
  readonly activityKind: OrchestrationThreadActivity['kind']
  readonly itemType?: ToolLifecycleItemType
  readonly label: string
  readonly toolTitle?: string
  readonly detail?: string
}

function isSubagentToolLifecycleEntry(entry: MinimalWorkLogEntry): boolean {
  return (
    entry.itemType === 'collab_agent_tool_call' &&
    (entry.activityKind === 'tool.started' ||
      entry.activityKind === 'tool.updated' ||
      entry.activityKind === 'tool.completed')
  )
}

function readSubagentData(payload: Record<string, unknown> | null) {
  const data = asObjectRecord(payload?.data)
  const item = asObjectRecord(data?.item) ?? data
  const input = asObjectRecord(item?.input)
  return { item, input }
}

function readSubagentType(parts: ReturnType<typeof readSubagentData>): string | null {
  return (
    asTrimmedString(parts.item?.subagent_type) ??
    asTrimmedString(parts.item?.subagentType) ??
    asTrimmedString(parts.input?.subagent_type) ??
    asTrimmedString(parts.input?.subagentType)
  )
}

function readSubagentPrompt(parts: ReturnType<typeof readSubagentData>): string | null {
  return asTrimmedString(parts.item?.prompt) ?? asTrimmedString(parts.input?.prompt)
}

function readSubagentDescription(parts: ReturnType<typeof readSubagentData>): string | null {
  return asTrimmedString(parts.item?.description) ?? asTrimmedString(parts.input?.description)
}

function buildSubagentStableKey(payload: Record<string, unknown> | null): string | undefined {
  const parts = readSubagentData(payload)
  const stableParts = [
    readSubagentType(parts),
    readSubagentPrompt(parts),
    readSubagentDescription(parts),
    asTrimmedString(payload?.detail),
  ].filter((value): value is string => value !== null)
  return stableParts.length > 0
    ? ['collab_agent_tool_call', ...stableParts].join('\u001f')
    : undefined
}

function buildSubagentLabelKey(entry: MinimalWorkLogEntry): string | undefined {
  const normalizedLabel = (entry.toolTitle ?? entry.label)
    .replace(/^(?:delegating|delegated)\s+to\s+/i, '')
    .replace(/\s+(?:complete|completed)\s*$/i, '')
    .trim()
  return normalizedLabel.length > 0
    ? ['collab_agent_tool_call', normalizedLabel].join('\u001f')
    : undefined
}

export function isVisibleSubagentToolStartActivity(activity: OrchestrationThreadActivity): boolean {
  if (activity.kind !== 'tool.started') {
    return false
  }
  const payload = asObjectRecord(activity.payload)
  return payload?.itemType === 'collab_agent_tool_call'
}

export function deriveSubagentToolLifecycleCollapseKey(
  entry: MinimalWorkLogEntry,
  payload: Record<string, unknown> | null
): string | undefined {
  if (!isSubagentToolLifecycleEntry(entry)) {
    return undefined
  }
  return buildSubagentStableKey(payload) ?? buildSubagentLabelKey(entry)
}
