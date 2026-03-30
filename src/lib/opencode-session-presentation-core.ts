import type { FileDiff, SessionStatus } from '@opencode-ai/sdk/v2/client'
import type {
  ChangeProvenanceRecord,
  ExecutionEventRecord,
  SessionMessageBundle,
} from '@shared/ipc'
import { getVisibleParts } from './message-feed-visibility'
import { groupAdjacentExploreRows, groupAdjacentTimelineExplorationRows, groupAdjacentToolCallRows } from './timeline-row-grouping'
import {
  groupChangedFileRows,
} from './session-presentation-helpers'
import {
  buildChangedFilesFromProvenance,
  buildProvenanceByTurn,
  buildSessionDiffLookup,
  dedupeChangedFiles,
  hydrateChangedFilesWithSessionDiff,
} from './opencode-session-presentation-diff'
import {
  classifyAssistantParts,
  deriveLatestReasoning,
} from './opencode-session-presentation-assistant'
import { buildMessageRows, injectTurnDividers } from './opencode-session-presentation-rows'
import { buildTimelineBlocks } from './message-feed-timeline'
import type { UnifiedProjectedSessionPresentation } from './session-presentation'

export type { ActivityEvent } from './opencode-session-presentation-types'

function buildEmptyPresentation(latestReasoning: { label: string; content: string } | null) {
  return {
    provider: 'opencode' as const,
    rows: [],
    latestActivity: latestReasoning
      ? { id: 'opencode:reasoning:latest', label: latestReasoning.label }
      : null,
    latestActivityContent: latestReasoning?.content ?? null,
    placeholderTimestamp: 0,
  }
}

function isBusySession(sessionStatus?: SessionStatus) {
  return sessionStatus?.type === 'busy' || sessionStatus?.type === 'retry'
}

export function projectOpencodeSessionPresentation(input: {
  messages: SessionMessageBundle[]
  sessionDiff?: FileDiff[]
  sessionStatus?: SessionStatus
  executionLedger?: ExecutionEventRecord[]
  changeProvenance?: ChangeProvenanceRecord[]
  assistantLabel?: string
  workspaceDirectory?: string | null
}): UnifiedProjectedSessionPresentation {
  const {
    assistantLabel = 'Orxa',
    changeProvenance = [],
    executionLedger = [],
    messages,
    sessionDiff = [],
    sessionStatus,
    workspaceDirectory,
  } = input
  const sessionDiffLookup = buildSessionDiffLookup(sessionDiff)
  const latestReasoning = deriveLatestReasoning(messages, executionLedger)
  if (messages.length === 0) {
    return buildEmptyPresentation(latestReasoning)
  }

  let latestActivity: { id: string; label: string } | null = null
  let lastRenderedRole: string | undefined
  const provenanceByTurn = buildProvenanceByTurn(changeProvenance)

  const nextRows = messages.flatMap(bundle => {
    const role = bundle.info.role
    const assistantClassification =
      role === 'assistant' ? classifyAssistantParts(bundle.parts, workspaceDirectory) : undefined
    const visibleParts = assistantClassification?.visible ?? getVisibleParts(role, bundle.parts)
    const toolParts = role === 'assistant' ? bundle.parts.filter(part => part.type === 'tool') : []
    const provenanceChangedFiles =
      role === 'assistant'
        ? buildChangedFilesFromProvenance(
            provenanceByTurn.get(bundle.info.id) ?? [],
            sessionDiffLookup
          )
        : []
    const changedFiles = dedupeChangedFiles(
      hydrateChangedFilesWithSessionDiff(
        [...(assistantClassification?.changedFiles ?? []), ...provenanceChangedFiles],
        sessionDiffLookup
      )
    )
    const timelineBlocks = buildTimelineBlocks(assistantClassification?.timeline ?? [])
    if (role === 'assistant') {
      latestActivity = assistantClassification?.activity ?? null
    }
    if (
      visibleParts.length === 0 &&
      timelineBlocks.length === 0 &&
      toolParts.length === 0 &&
      changedFiles.length === 0
    ) {
      return []
    }
    const showHeader = role !== lastRenderedRole
    if (visibleParts.some(part => part.type === 'text' || part.type === 'file')) {
      lastRenderedRole = role
    }

    return buildMessageRows(
      bundle,
      visibleParts,
      toolParts,
      changedFiles,
      timelineBlocks,
      assistantLabel,
      showHeader,
      workspaceDirectory
    )
  })

  const lastMessage = messages.at(-1)
  const placeholderTimestamp =
    lastMessage &&
    'updated' in lastMessage.info.time &&
    typeof lastMessage.info.time.updated === 'number'
      ? lastMessage.info.time.updated
      : (lastMessage?.info.time.created ?? 0)
  const effectiveLatestActivity =
    latestActivity ??
    (latestReasoning ? { id: 'opencode:reasoning:latest', label: latestReasoning.label } : null)
  const isBusy = isBusySession(sessionStatus)
  const groupedRows = groupAdjacentExploreRows(
    groupAdjacentTimelineExplorationRows(
      groupAdjacentToolCallRows(groupChangedFileRows(nextRows, { enabled: !isBusy }), {
        enabled: isBusy,
      })
    )
  )
  const finalRows = isBusy ? groupedRows : injectTurnDividers(groupedRows, messages)

  return {
    provider: 'opencode' as const,
    rows: finalRows,
    latestActivity: effectiveLatestActivity,
    latestActivityContent: latestReasoning?.content ?? null,
    placeholderTimestamp,
  }
}
