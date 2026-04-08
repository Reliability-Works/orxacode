/**
 * Derives activity-based state for ChatView: plan state, pending approvals/inputs,
 * work log, and timeline entries.
 */

import { useMemo } from 'react'
import { useTurnDiffSummaries } from '../../hooks/useTurnDiffSummaries'
import {
  deriveCompletionDividerBeforeEntryId,
  derivePendingApprovals,
  derivePendingUserInputs,
  deriveTimelineEntries,
  deriveActiveWorkStartedAt,
  deriveWorkLogEntries,
  hasToolActivityForTurn,
  isLatestTurnSettled,
  formatElapsed,
} from '../../session-logic'
import {
  buildPendingUserInputAnswers,
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from '../../pendingUserInput'
import { deriveLatestContextWindowSnapshot } from '../../lib/contextWindow'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { useChatViewDerivedThread } from './useChatViewDerivedThread'
import type { MessageId, TurnId } from '@orxa-code/contracts'
import type { ChatMessage, TurnDiffSummary } from '../../types'

const EMPTY_ACTIVITIES: import('@orxa-code/contracts').OrchestrationThreadActivity[] = []
const EMPTY_PENDING_USER_INPUT_ANSWERS: Record<string, PendingUserInputDraftAnswer> = {}

type StoreSelectors = ReturnType<typeof useChatViewStoreSelectors>
type LocalState = ReturnType<typeof useChatViewLocalState>
type ThreadDerived = ReturnType<typeof useChatViewDerivedThread>

type ThreadActivitiesList = NonNullable<ThreadDerived['activeThread']>['activities']

function usePendingUserInputMemos(
  threadActivities: ThreadActivitiesList | typeof EMPTY_ACTIVITIES,
  ls: LocalState
) {
  const {
    respondingUserInputRequestIds,
    pendingUserInputAnswersByRequestId,
    pendingUserInputQuestionIndexByRequestId,
  } = ls
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(threadActivities),
    [threadActivities]
  )
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(threadActivities),
    [threadActivities]
  )
  const activePendingUserInput = pendingUserInputs[0] ?? null
  const activePendingDraftAnswers = useMemo(
    () =>
      activePendingUserInput
        ? (pendingUserInputAnswersByRequestId[activePendingUserInput.requestId] ??
          EMPTY_PENDING_USER_INPUT_ANSWERS)
        : EMPTY_PENDING_USER_INPUT_ANSWERS,
    [activePendingUserInput, pendingUserInputAnswersByRequestId]
  )
  const activePendingQuestionIndex = activePendingUserInput
    ? (pendingUserInputQuestionIndexByRequestId[activePendingUserInput.requestId] ?? 0)
    : 0
  const activePendingProgress = useMemo(
    () =>
      activePendingUserInput
        ? derivePendingUserInputProgress(
            activePendingUserInput.questions,
            activePendingDraftAnswers,
            activePendingQuestionIndex
          )
        : null,
    [activePendingDraftAnswers, activePendingQuestionIndex, activePendingUserInput]
  )
  const activePendingResolvedAnswers = useMemo(
    () =>
      activePendingUserInput
        ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingDraftAnswers)
        : null,
    [activePendingDraftAnswers, activePendingUserInput]
  )
  const activePendingIsResponding = activePendingUserInput
    ? respondingUserInputRequestIds.includes(activePendingUserInput.requestId)
    : false
  const activePendingApproval = pendingApprovals[0] ?? null
  return {
    pendingApprovals,
    pendingUserInputs,
    activePendingUserInput,
    activePendingDraftAnswers,
    activePendingQuestionIndex,
    activePendingProgress,
    activePendingResolvedAnswers,
    activePendingIsResponding,
    activePendingApproval,
  }
}

function useTimelineMemos(params: {
  td: ThreadDerived
  ls: LocalState
  workLogEntries: ReturnType<typeof deriveWorkLogEntries>
  latestTurnHasToolActivity: boolean
  latestTurnSettled: boolean
}) {
  const { td, ls, workLogEntries, latestTurnHasToolActivity, latestTurnSettled } = params
  const { activeThread, activeLatestTurn } = td
  const { attachmentPreviewHandoffByMessageId, optimisticUserMessages } = ls
  const serverMessages = activeThread?.messages
  const timelineMessages = useMemo(
    () =>
      buildTimelineMessages(
        serverMessages,
        attachmentPreviewHandoffByMessageId,
        optimisticUserMessages
      ) as ChatMessage[],
    [serverMessages, attachmentPreviewHandoffByMessageId, optimisticUserMessages]
  )
  const timelineEntries = useMemo(
    () =>
      deriveTimelineEntries(timelineMessages, activeThread?.proposedPlans ?? [], workLogEntries),
    [activeThread?.proposedPlans, timelineMessages, workLogEntries]
  )
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread)
  const turnDiffSummaryByAssistantMessageId = useMemo(() => {
    const map = new Map<MessageId, TurnDiffSummary>()
    for (const s of turnDiffSummaries) {
      if (s.assistantMessageId) map.set(s.assistantMessageId, s)
    }
    return map
  }, [turnDiffSummaries])
  const revertTurnCountByUserMessageId = useMemo(
    () =>
      buildRevertMap(
        timelineEntries,
        turnDiffSummaryByAssistantMessageId,
        inferredCheckpointTurnCountByTurnId
      ),
    [inferredCheckpointTurnCountByTurnId, timelineEntries, turnDiffSummaryByAssistantMessageId]
  )
  const completionSummary = useMemo(() => {
    if (
      !latestTurnSettled ||
      !activeLatestTurn?.startedAt ||
      !activeLatestTurn.completedAt ||
      !latestTurnHasToolActivity
    )
      return null
    const elapsed = formatElapsed(activeLatestTurn.startedAt, activeLatestTurn.completedAt)
    return elapsed ? `Worked for ${elapsed}` : null
  }, [activeLatestTurn, latestTurnHasToolActivity, latestTurnSettled])
  const completionDividerBeforeEntryId = useMemo(() => {
    if (!latestTurnSettled || !completionSummary) return null
    return deriveCompletionDividerBeforeEntryId(timelineEntries, activeLatestTurn)
  }, [activeLatestTurn, completionSummary, latestTurnSettled, timelineEntries])
  return {
    timelineMessages,
    timelineEntries,
    turnDiffSummaryByAssistantMessageId,
    revertTurnCountByUserMessageId,
    completionSummary,
    completionDividerBeforeEntryId,
  }
}

export function useChatViewDerivedActivities(
  store: StoreSelectors,
  ls: LocalState,
  td: ThreadDerived
) {
  const { activeThread, activeLatestTurn, phase } = td
  const threadActivities = activeThread?.activities ?? EMPTY_ACTIVITIES
  const workLogEntries = useMemo(
    () => deriveWorkLogEntries(threadActivities, activeLatestTurn?.turnId ?? undefined),
    [activeLatestTurn?.turnId, threadActivities]
  )
  const latestTurnHasToolActivity = useMemo(
    () => hasToolActivityForTurn(threadActivities, activeLatestTurn?.turnId),
    [activeLatestTurn?.turnId, threadActivities]
  )
  const pendingInput = usePendingUserInputMemos(threadActivities, ls)
  const latestTurnSettled = isLatestTurnSettled(activeLatestTurn, activeThread?.session ?? null)
  const activeContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(activeThread?.activities ?? []),
    [activeThread?.activities]
  )
  const timeline = useTimelineMemos({
    td,
    ls,
    workLogEntries,
    latestTurnHasToolActivity,
    latestTurnSettled,
  })
  const isWorking = phase === 'running'
  const activeWorkStartedAt = deriveActiveWorkStartedAt(
    activeLatestTurn,
    activeThread?.session ?? null,
    null
  )
  return {
    threadActivities,
    workLogEntries,
    latestTurnHasToolActivity,
    ...pendingInput,
    latestTurnSettled,
    activeContextWindow,
    ...timeline,
    isWorking,
    activeWorkStartedAt,
  }
}

function buildTimelineMessages(
  serverMessages:
    | Array<{
        id: string
        role: string
        attachments?: Array<{ type: string; previewUrl?: string }>
      }>
    | undefined,
  handoffs: Record<string, string[]>,
  optimistic: Array<{ id: string }>
) {
  const messages = serverMessages ?? []
  const hasHandoffs = Object.keys(handoffs).length > 0
  const withHandoffs = hasHandoffs ? messages.map(m => applyHandoff(m, handoffs)) : messages
  if (optimistic.length === 0) return withHandoffs
  const serverIds = new Set(withHandoffs.map(m => m.id))
  const pending = optimistic.filter(m => !serverIds.has(m.id))
  if (pending.length === 0) return withHandoffs
  return [...withHandoffs, ...pending]
}

function applyHandoff(
  message: { id: string; role: string; attachments?: Array<{ type: string; previewUrl?: string }> },
  handoffs: Record<string, string[]>
) {
  if (message.role !== 'user' || !message.attachments?.length) return message
  const handoff = handoffs[message.id]
  if (!handoff?.length) return message
  let changed = false
  let imgIdx = 0
  const attachments = message.attachments.map(a => {
    if (a.type !== 'image') return a
    const url = handoff[imgIdx++]
    if (!url || a.previewUrl === url) return a
    changed = true
    return { ...a, previewUrl: url }
  })
  return changed ? { ...message, attachments } : message
}

function buildRevertMap(
  entries: Array<{ kind: string; message?: { id: MessageId; role: string } }>,
  diffMap: Map<MessageId, TurnDiffSummary>,
  inferred: Record<TurnId, number>
): Map<MessageId, number> {
  const map = new Map<MessageId, number>()
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry || entry.kind !== 'message' || entry.message?.role !== 'user') continue
    for (let j = i + 1; j < entries.length; j++) {
      const next = entries[j]
      if (!next || next.kind !== 'message') continue
      if (next.message?.role === 'user') break
      const summary = next.message ? diffMap.get(next.message.id) : undefined
      if (!summary) continue
      const count =
        summary.checkpointTurnCount ?? (summary.turnId ? inferred[summary.turnId] : undefined)
      if (typeof count !== 'number') break
      if (entry.message?.id) map.set(entry.message.id, Math.max(0, count - 1))
      break
    }
  }
  return map
}
