/* eslint-disable complexity, max-lines, max-lines-per-function */
import type { Part } from '@opencode-ai/sdk/v2/client'
import type { ExecutionEventRecord, SessionMessageBundle } from '@shared/ipc'
import type { UnifiedTimelineRenderRow } from '../components/chat/unified-timeline-model'
import type { InternalEvent, TimelineEvent, TimelineKind } from './message-feed-timeline'
import {
  isLikelyTelemetryJson,
  isLikelyThinkingText,
  isProgressUpdateText,
} from './message-feed-visibility'
import type { ActivityEvent, DelegationTrace } from './opencode-session-presentation-types'
import {
  compactText,
  extractCommandPreview,
  extractModelLabel,
  extractShellCommandForTool,
  extractTaskDelegationInfo,
  extractTaskSessionIDFromOutput,
  inferTimelineKind,
  isBareCommandLabel,
  isCommandToolName,
  isLikelyShellCommand,
  isLowSignalCompletedLabel,
  isTaskToolName,
  isToolStatusActive,
  shouldHideAssistantTextPart,
  summarizeBrowserActionText,
  toObjectRecord,
  extractCommand,
  toToolReason,
} from './opencode-session-presentation-utils'
import {
  extractChangedFilesFromToolPart,
  toToolActivityLabel,
} from './opencode-session-presentation-tooling'

type AssistantClassificationState = {
  visible: Part[]
  internal: InternalEvent[]
  delegations: DelegationTrace[]
  timeline: TimelineEvent[]
  changedFiles: Array<Extract<UnifiedTimelineRenderRow, { kind: 'diff' }>>
  activity: ActivityEvent | null
  currentActor: string
  activeDelegation: DelegationTrace | null
}

function createAssistantClassificationState(): AssistantClassificationState {
  return {
    visible: [],
    internal: [],
    delegations: [],
    timeline: [],
    changedFiles: [],
    activity: null,
    currentActor: 'Main agent',
    activeDelegation: null,
  }
}

function summarizeAssistantTelemetryTextPart(part: Part & { type: 'text' }, actor?: string): InternalEvent | null {
  const text = part.text.trim()
  const browserActionSummary = summarizeBrowserActionText(text)
  if (browserActionSummary) {
    return { id: part.id, summary: browserActionSummary, actor }
  }
  if (isLikelyTelemetryJson(text)) {
    const parsed = toObjectRecord(text)
    const summary = typeof parsed?.type === 'string' ? parsed.type : 'Telemetry event'
    return { id: part.id, summary, actor }
  }
  return null
}

export function summarizeAssistantTelemetryPart(part: Part, actor?: string): InternalEvent | null {
  switch (part.type) {
    case 'step-start':
      return { id: part.id, summary: 'Step started', actor }
    case 'step-finish': {
      const tokens = part.tokens
      const details = `reason: ${part.reason} | input: ${tokens.input} | output: ${tokens.output} | cache read: ${tokens.cache.read}`
      return { id: part.id, summary: 'Step finished', details, actor }
    }
    case 'retry':
      return { id: part.id, summary: `Retry attempt ${part.attempt}`, actor }
    case 'compaction': {
      const auto = part.auto !== false
      return {
        id: part.id,
        summary: auto ? 'Automatic context compaction' : 'Manual context compaction',
        details: auto
          ? 'Summarized conversation state to recover context.'
          : 'Manual summarize/compaction requested.',
        actor,
      }
    }
    case 'snapshot':
      return { id: part.id, summary: 'Snapshot update', actor }
    case 'text':
      return summarizeAssistantTelemetryTextPart(part, actor)
    default:
      return null
  }
}

function summarizeDelegationTextPart(
  part: Part & { type: 'text' },
  actor?: string
) {
  const text = part.text.trim()
  if (isProgressUpdateText(text)) {
    return { id: part.id, summary: text.replace(/:\s*$/, ''), actor }
  }
  if (isLikelyTelemetryJson(text)) {
    const parsed = toObjectRecord(text)
    const summary = typeof parsed?.type === 'string' ? parsed.type : 'Telemetry event'
    return { id: part.id, summary, actor }
  }
  if (shouldHideAssistantTextPart(text)) {
    const browserActionSummary = summarizeBrowserActionText(text)
    if (browserActionSummary) {
      return { id: part.id, summary: browserActionSummary, actor }
    }
  }
  return null
}

function summarizeDelegationToolEvent(
  part: Part & { type: 'tool' },
  actor?: string,
  workspaceDirectory?: string | null
) {
  const stateRecord = part.state as unknown as Record<string, unknown>
  const stateMetadata = stateRecord.metadata
  const stateOutput = stateRecord.output
  const status = part.state.status
  const kind = inferTimelineKind(part.tool, part.state.input, workspaceDirectory)
  const isCommandTool = isCommandToolName(part.tool)
  const showCommand =
    (isCommandTool && kind !== 'read' && kind !== 'search' && kind !== 'list' && kind !== 'todo') ||
    kind === 'run' ||
    kind === 'git'
  const commandPreview = showCommand ? extractCommandPreview(part.state.input) : null
  const command = commandPreview && isLikelyShellCommand(commandPreview) ? commandPreview : undefined
  const failure =
    status === 'error'
      ? typeof stateRecord.error === 'string'
        ? compactText(stateRecord.error, 220)
        : 'Tool execution failed'
      : undefined
  const label = toToolActivityLabel(
    part.tool,
    status,
    part.state.input,
    workspaceDirectory,
    stateMetadata,
    stateOutput
  )

  if (kind === 'run' && !command && !failure && isBareCommandLabel(label)) {
    return null
  }
  if (isLowSignalCompletedLabel(label) && !command && !failure) {
    return null
  }

  return {
    id: part.id,
    summary: label,
    details: failure,
    actor,
    kind,
    command,
    failure,
  }
}

export function summarizeDelegationEvent(
  part: Part,
  actor?: string,
  workspaceDirectory?: string | null
): InternalEvent | null {
  switch (part.type) {
    case 'step-start':
      return { id: part.id, summary: 'Step started', actor }
    case 'step-finish': {
      const tokens = part.tokens
      const details = `reason: ${part.reason} | input: ${tokens.input} | output: ${tokens.output} | cache read: ${tokens.cache.read}`
      return { id: part.id, summary: 'Step finished', details, actor }
    }
    case 'tool':
      return summarizeDelegationToolEvent(part, actor, workspaceDirectory)
    case 'reasoning':
      return { id: part.id, summary: 'Reasoning update', actor }
    case 'retry':
      return { id: part.id, summary: `Retry attempt ${part.attempt}`, actor }
    case 'compaction': {
      const auto = part.auto !== false
      return {
        id: part.id,
        summary: auto ? 'Automatic context compaction' : 'Manual context compaction',
        details: auto
          ? 'Summarized conversation state to recover context.'
          : 'Manual summarize/compaction requested.',
        actor,
      }
    }
    case 'snapshot':
      return { id: part.id, summary: 'Snapshot update', actor }
    case 'patch':
      return { id: part.id, summary: `Patch update (${part.files.length} files)`, actor }
    case 'text':
      return summarizeDelegationTextPart(part, actor)
    default:
      return null
  }
}

function summarizeAssistantTextPart(
  part: Part & { type: 'text' },
  currentActor: string,
  workspaceDirectory?: string | null
) {
  if (isLikelyThinkingText(part.text)) {
    const snippet = part.text.trim().slice(0, 80)
    return {
      mode: 'thinking' as const,
      row: {
        id: `${part.id}:thinking-detected`,
        label: `Thinking: ${snippet}${part.text.trim().length > 80 ? '...' : ''}`,
        kind: 'read' as TimelineKind,
      },
    }
  }
  if (shouldHideAssistantTextPart(part.text)) {
    const telemetryEvent = summarizeAssistantTelemetryPart(part, currentActor)
    const delegationEvent = telemetryEvent ? null : summarizeDelegationEvent(part, currentActor, workspaceDirectory)
    return { mode: 'hidden' as const, telemetryEvent, delegationEvent }
  }
  return { mode: 'visible' as const }
}

function classifyAssistantToolPart(
  part: Part & { type: 'tool' },
  state: AssistantClassificationState,
  workspaceDirectory?: string | null
) {
  const status = part.state.status
  const stateTitle =
    'title' in part.state && typeof part.state.title === 'string' ? part.state.title.trim() : ''
  const stateRecord = part.state as unknown as Record<string, unknown>
  const stateMetadata = stateRecord.metadata
  const stateOutput = typeof stateRecord.output === 'string' ? stateRecord.output : undefined
  const stateError = typeof stateRecord.error === 'string' ? stateRecord.error : undefined
  let label = toToolActivityLabel(
    part.tool,
    status,
    part.state.input,
    workspaceDirectory,
    stateMetadata,
    stateOutput
  )
  const kind = inferTimelineKind(part.tool, part.state.input, workspaceDirectory)
  const toolName = part.tool.trim().toLowerCase()
  const toolChangedFiles = extractChangedFilesFromToolPart(part, kind, workspaceDirectory)
  if (toolChangedFiles.length > 0) {
    state.changedFiles.push(...toolChangedFiles)
  }
  const isCommandTool = isCommandToolName(toolName)
  const shellCommand = extractShellCommandForTool(part.state.input, stateTitle)
  const explicitCommand = extractCommand(part.state.input)
  const explicitCommandPreview = extractCommandPreview(part.state.input, 92)
  const explicitCommandLooksNarrative =
    Boolean(explicitCommandPreview) &&
    !isLikelyShellCommand(explicitCommandPreview ?? '') &&
    (stateTitle.length === 0 || explicitCommandPreview?.toLowerCase() === stateTitle.toLowerCase())
  const hasExplicitCommand = Boolean(explicitCommand) && !explicitCommandLooksNarrative
  const hasNarrativeTitle =
    isCommandTool &&
    kind === 'run' &&
    stateTitle.length > 0 &&
    (!hasExplicitCommand || explicitCommandLooksNarrative) &&
    !isLikelyShellCommand(stateTitle)
  if (hasNarrativeTitle) {
    if (isToolStatusActive(status)) {
      label = `${compactText(stateTitle, 72)}...`
    } else if (status === 'error') {
      label = `Failed ${compactText(stateTitle, 92)}`
    } else {
      label = compactText(stateTitle, 92)
    }
  } else if ((isBareCommandLabel(label) || label === 'Running command...') && stateTitle) {
    label = isToolStatusActive(status)
      ? `Running ${compactText(stateTitle, 72)}...`
      : `Ran ${compactText(stateTitle, 72)}`
  }
  const taskDelegation = isTaskToolName(toolName)
    ? extractTaskDelegationInfo(
        part.state.input,
        'metadata' in part.state ? part.state.metadata : undefined
      )
    : null
  if (taskDelegation) {
    const outputSessionID =
      'output' in part.state ? extractTaskSessionIDFromOutput(part.state.output) : undefined
    state.delegations.push({
      id: `task:${part.id}`,
      agent: taskDelegation.agent,
      description: taskDelegation.description,
      prompt: taskDelegation.prompt,
      modelLabel: taskDelegation.modelLabel,
      command: taskDelegation.command,
      sessionID: taskDelegation.sessionID ?? outputSessionID,
      events: [],
    })
    state.activeDelegation = state.delegations.at(-1) ?? null
    state.currentActor = taskDelegation.agent
  }
  if (isToolStatusActive(status)) {
    state.activity = null
  } else {
    if (taskDelegation) {
      return
    }
    if (kind === 'todo') {
      return
    }
    if (
      isCommandTool &&
      shellCommand &&
      kind !== 'read' &&
      kind !== 'search' &&
      kind !== 'list'
    ) {
      return
    }
    const showReason = kind === 'create' || kind === 'delete'
    const showCommand =
      (isCommandTool && kind !== 'read' && kind !== 'search' && kind !== 'list') ||
      kind === 'run' ||
      kind === 'git'
    const commandPreview = showCommand
      ? (extractCommandPreview(part.state.input) ??
        (kind === 'run' && !hasExplicitCommand && stateTitle && isLikelyShellCommand(stateTitle)
          ? compactText(stateTitle, 92)
          : null))
      : null
    const command = commandPreview && isLikelyShellCommand(commandPreview) ? commandPreview : null
    if (kind === 'run' && !command && !stateError && isBareCommandLabel(label)) {
      return
    }
    if (isLowSignalCompletedLabel(label) && !command && !stateError) {
      return
    }
    if (
      (part.state.status === 'error' &&
        !shellCommand &&
        (kind === 'edit' || kind === 'create' || kind === 'delete')) ||
      (toolChangedFiles.length > 0 &&
        (kind === 'edit' || kind === 'create' || kind === 'delete' || kind === 'run'))
    ) {
      return
    }
    state.timeline.push({
      id: `${part.id}:timeline`,
      label,
      kind,
      reason: showReason ? `Why this changed: ${state.currentActor} via ${toToolReason(part.tool)}` : undefined,
      command: command ?? undefined,
      output: stateOutput && stateOutput.trim().length > 0 ? stateOutput.trim() : undefined,
      failure:
        status === 'error'
          ? stateError?.trim() || stateOutput?.trim() || 'Tool execution failed'
          : undefined,
    })
  }
}

function classifyAssistantReasoningPart(part: Part & { type: 'reasoning' }, state: AssistantClassificationState) {
  const record = part as unknown as Record<string, unknown>
  const summary =
    typeof record.summary === 'string'
      ? record.summary
      : typeof record.text === 'string'
        ? record.text
        : ''
  if (summary) {
    const trimmed = summary.length > 80 ? `${summary.slice(0, 77)}...` : summary
    state.activity = { id: `${part.id}:activity`, label: trimmed }
  }
}

function classifyAssistantAgentPart(part: Part & { type: 'agent' }, state: AssistantClassificationState) {
  state.currentActor = part.name
  state.activity = {
    id: `${part.id}:activity`,
    label: `Switched to ${part.name}`,
  }
}

function classifyAssistantSubtaskPart(
  part: Part & { type: 'subtask' },
  state: AssistantClassificationState
) {
  const trace: DelegationTrace = {
    id: part.id,
    agent: part.agent,
    description: part.description,
    prompt: part.prompt,
    modelLabel: extractModelLabel(part.model),
    command: part.command,
    events: [],
  }
  state.delegations.push(trace)
  state.activeDelegation = trace
  state.currentActor = part.agent
}

function classifyAssistantVisibleTextPart(
  part: Part & { type: 'text' },
  state: AssistantClassificationState,
  workspaceDirectory?: string | null
) {
  const summary = summarizeAssistantTextPart(part, state.currentActor, workspaceDirectory)
  if (summary.mode === 'thinking') {
    state.timeline.push(summary.row)
    return
  }
  if (summary.mode === 'hidden') {
    if (summary.telemetryEvent) {
      state.internal.push(summary.telemetryEvent)
    }
    if (summary.delegationEvent && state.activeDelegation) {
      state.activeDelegation.events.push(summary.delegationEvent)
    }
    return
  }
  state.visible.push(part)
}

function classifyAssistantHiddenTextPart(
  part: Part & { type: 'text' },
  state: AssistantClassificationState,
  workspaceDirectory?: string | null
) {
  const telemetryEvent = summarizeAssistantTelemetryPart(part, state.currentActor)
  if (telemetryEvent) {
    state.internal.push(telemetryEvent)
  }
  if (state.activeDelegation) {
    const delegationEvent = summarizeDelegationEvent(part, state.currentActor, workspaceDirectory)
    if (delegationEvent) {
      state.activeDelegation.events.push(delegationEvent)
    }
  }
}

function classifyAssistantPart(
  part: Part,
  state: AssistantClassificationState,
  workspaceDirectory?: string | null
) {
  switch (part.type) {
    case 'subtask':
      classifyAssistantSubtaskPart(part, state)
      return
    case 'text':
      if (isLikelyThinkingText(part.text)) {
        state.timeline.push({
          id: `${part.id}:thinking-detected`,
          label: `Thinking: ${part.text.trim().slice(0, 80)}${part.text.trim().length > 80 ? '...' : ''}`,
          kind: 'read' as TimelineKind,
        })
        return
      }
      if (shouldHideAssistantTextPart(part.text)) {
        classifyAssistantHiddenTextPart(part, state, workspaceDirectory)
        return
      }
      classifyAssistantVisibleTextPart(part, state, workspaceDirectory)
      return
    case 'file':
      state.visible.push(part)
      return
    case 'tool':
      classifyAssistantToolPart(part, state, workspaceDirectory)
      return
    case 'reasoning':
      classifyAssistantReasoningPart(part, state)
      return
    case 'agent':
      classifyAssistantAgentPart(part, state)
      return
    default: {
      const telemetryEvent = summarizeAssistantTelemetryPart(part, state.currentActor)
      if (telemetryEvent) {
        state.internal.push(telemetryEvent)
      }
      if (state.activeDelegation) {
        const delegationEvent = summarizeDelegationEvent(part, state.currentActor, workspaceDirectory)
        if (delegationEvent) {
          state.activeDelegation.events.push(delegationEvent)
        }
      }
    }
  }
}

export function classifyAssistantParts(parts: Part[], workspaceDirectory?: string | null) {
  const state = createAssistantClassificationState()
  for (const part of parts) {
    classifyAssistantPart(part, state, workspaceDirectory)
  }
  return {
    visible: state.visible,
    internal: state.internal,
    delegations: state.delegations,
    timeline: state.timeline,
    changedFiles: state.changedFiles,
    activity: state.activity,
  }
}

export function isGenericReasoningLabel(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized === 'reasoning update' || normalized === 'reasoning'
}

function selectLatestReasoning(
  latest: { label: string; content: string; timestamp: number } | null,
  candidate: { label: string; content: string; timestamp: number } | null
) {
  if (!candidate) {
    return latest
  }
  if (!latest || latest.timestamp <= candidate.timestamp) {
    return candidate
  }
  return latest
}

function extractReasoningFromMessageBundle(bundle: SessionMessageBundle) {
  if (bundle.info.role !== 'assistant') {
    return null
  }
  let latest: { label: string; content: string; timestamp: number } | null = null
  for (const part of bundle.parts) {
    if (part.type !== 'reasoning') {
      continue
    }
    const record = part as unknown as Record<string, unknown>
    const content = typeof record.text === 'string' ? record.text.trim() : ''
    const rawSummary = typeof record.summary === 'string' ? record.summary.trim() : ''
    const summary = isGenericReasoningLabel(rawSummary) ? '' : rawSummary
    if (!content && !summary) {
      continue
    }
    latest = selectLatestReasoning(latest, {
      label: compactText(summary || content, 80),
      content,
      timestamp: bundle.info.time.created,
    })
  }
  return latest
}

function extractReasoningFromLedgerRecord(record: ExecutionEventRecord) {
  if (record.kind !== 'reasoning') {
    return null
  }
  const content = record.detail?.trim() ?? ''
  const rawSummary = record.summary.trim()
  const summary = isGenericReasoningLabel(rawSummary) ? '' : rawSummary
  if (!content && !summary) {
    return null
  }
  return {
    label: compactText(content || summary, 80),
    content,
    timestamp: record.timestamp,
  }
}

export function deriveLatestReasoning(
  messages: SessionMessageBundle[],
  executionLedger: ExecutionEventRecord[]
) {
  let latest: { label: string; content: string; timestamp: number } | null = null
  for (const bundle of messages) {
    latest = selectLatestReasoning(latest, extractReasoningFromMessageBundle(bundle))
  }
  for (const record of executionLedger) {
    latest = selectLatestReasoning(latest, extractReasoningFromLedgerRecord(record))
  }
  return latest
}
