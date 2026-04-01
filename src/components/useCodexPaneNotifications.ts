import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import type { CodexApprovalRequest, CodexUserInputRequest } from '@shared/ipc'
import { selectPendingPermissionDockData, selectPendingQuestionDockData } from '../state/unified-runtime-store'
import type { PermissionMode } from '../types/app'

function deriveActivePlanItem(
  messages: Array<{ kind: string; toolType?: string; output?: string; status?: string; id: string; role?: string }>,
  dismissedPlanIds: Set<string>,
  isStreaming: boolean
) {
  if (isStreaming) return null
  let lastPlanIdx = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.kind === 'tool' && message.toolType === 'plan') {
      lastPlanIdx = index
      break
    }
  }
  if (lastPlanIdx < 0) return null
  const planItem = messages[lastPlanIdx]
  if (!planItem || !planItem.output?.trim() || planItem.status === 'error') return null
  if (dismissedPlanIds.has(planItem.id)) return null
  const hasUserMessageAfter = messages
    .slice(lastPlanIdx + 1)
    .some(message => message.kind === 'message' && message.role === 'user')
  return hasUserMessageAfter ? null : planItem
}

function buildAwaitingNotificationKey({
  permissionMode,
  pendingApproval,
  pendingUserInput,
  planReady,
}: {
  permissionMode: PermissionMode
  pendingApproval: CodexApprovalRequest | null
  pendingUserInput: CodexUserInputRequest | null
  planReady: boolean
}) {
  const visibleApproval = permissionMode === 'yolo-write' ? null : pendingApproval
  if (visibleApproval) return `approval:${visibleApproval.itemId ?? visibleApproval.id}`
  if (pendingUserInput) return `input:${pendingUserInput.itemId ?? pendingUserInput.id}`
  return planReady ? 'plan' : null
}

function buildNotificationBody(planReady: boolean, pendingUserInput: CodexUserInputRequest | null) {
  if (planReady) return 'Plan is ready for review'
  if (pendingUserInput) return 'Agent is asking a question'
  return 'Agent needs permission to continue'
}

function useCodexAwaitingNotifications({
  isSubagentThread,
  notifyOnAwaitingInput,
  pendingApproval,
  pendingUserInput,
  permissionMode,
  planReady,
  subagentSystemNotificationsEnabled,
  turnStartedAt,
}: {
  isSubagentThread: (threadId: string) => boolean
  notifyOnAwaitingInput?: boolean
  pendingApproval: CodexApprovalRequest | null
  pendingUserInput: CodexUserInputRequest | null
  permissionMode: PermissionMode
  planReady: boolean
  subagentSystemNotificationsEnabled?: boolean
  turnStartedAt: MutableRefObject<number>
}) {
  const lastNotifiedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!notifyOnAwaitingInput || document.hasFocus()) return
    const key = buildAwaitingNotificationKey({ permissionMode, pendingApproval, pendingUserInput, planReady })
    if (!key || key === lastNotifiedRef.current) return
    const eventThreadId =
      (permissionMode === 'yolo-write' ? null : pendingApproval)?.threadId ?? pendingUserInput?.threadId
    if (!subagentSystemNotificationsEnabled && eventThreadId && isSubagentThread(eventThreadId)) return
    if (turnStartedAt.current > 0 && Date.now() - turnStartedAt.current < 60_000) return
    lastNotifiedRef.current = key
    const body = buildNotificationBody(planReady, pendingUserInput)
    new Notification('Orxa Code', { body, silent: false }).onclick = () => window.focus()
  }, [isSubagentThread, notifyOnAwaitingInput, pendingApproval, pendingUserInput, permissionMode, planReady, subagentSystemNotificationsEnabled, turnStartedAt])
}

function useCodexAutoApproval({
  approveAction,
  pendingApproval,
  permissionMode,
}: {
  approveAction: (decision: 'accept' | 'acceptForSession') => Promise<unknown>
  pendingApproval: CodexApprovalRequest | null
  permissionMode: PermissionMode
}) {
  const autoApprovedRequestIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!pendingApproval) {
      autoApprovedRequestIdRef.current = null
      return
    }
    if (permissionMode !== 'yolo-write' || autoApprovedRequestIdRef.current === pendingApproval.id) return
    autoApprovedRequestIdRef.current = pendingApproval.id
    const decision = pendingApproval.availableDecisions.includes('acceptForSession') ? 'acceptForSession' : 'accept'
    void approveAction(decision)
  }, [approveAction, pendingApproval, permissionMode])
}

function useEscapeInterrupt(interruptTurn: () => Promise<unknown>, isStreaming: boolean) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isStreaming) void interruptTurn()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [interruptTurn, isStreaming])
}

function buildPermissionDockProps(args: {
  approveAction: (decision: 'accept' | 'acceptForSession') => Promise<unknown>
  denyAction: () => Promise<unknown>
  permissionMode: PermissionMode
  sessionStorageKey: string
}) {
  const pendingPermissionData = selectPendingPermissionDockData({
    provider: 'codex',
    sessionKey: args.sessionStorageKey,
    permissionMode: args.permissionMode,
  })
  if (!pendingPermissionData) return null
  return {
    description: pendingPermissionData.description,
    filePattern: pendingPermissionData.filePattern,
    command: pendingPermissionData.command,
    onDecide: (decision: 'allow_once' | 'allow_always' | 'reject') => {
      if (decision === 'allow_once') void args.approveAction('accept')
      else if (decision === 'allow_always') void args.approveAction('acceptForSession')
      else void args.denyAction()
    },
  }
}

function buildQuestionDockProps(args: {
  rejectUserInput: () => Promise<unknown>
  respondToUserInput: (answers: Record<string, { answers: string[] }>) => Promise<unknown>
  sessionStorageKey: string
}) {
  const pendingQuestionData = selectPendingQuestionDockData({
    provider: 'codex',
    sessionKey: args.sessionStorageKey,
  })
  if (!pendingQuestionData) return null
  return {
    questions: pendingQuestionData.questions,
    onSubmit: (rawAnswers: Record<string, string | string[]>) => {
      const answers: Record<string, { answers: string[] }> = {}
      for (const [questionId, value] of Object.entries(rawAnswers)) {
        answers[questionId] = { answers: Array.isArray(value) ? value : [value] }
      }
      void args.respondToUserInput(answers)
    },
    onReject: () => void args.rejectUserInput(),
  }
}

function buildPendingPlanProps(args: {
  acceptPlan: (options: { collaborationMode?: string; model?: string; effort?: string; planItemId?: string }) => Promise<unknown>
  activePlanItem: { id: string } | null
  defaultCollaborationModeId: string
  dismissPlan: (planItemId?: string) => void
  planReady: boolean
  selectedModelID?: string
  selectedReasoningEffort?: string
  setIsPlanMode: (next: boolean) => void
  setSelectedCollabMode: (next: string | undefined) => void
  submitPlanChanges: (changes: string, planItemId?: string) => Promise<unknown>
}) {
  if (!args.planReady) return null
  return {
    onAccept: () => {
      args.setIsPlanMode(false)
      args.setSelectedCollabMode(args.defaultCollaborationModeId)
      void args.acceptPlan({
        collaborationMode: args.defaultCollaborationModeId,
        model: args.selectedModelID,
        effort: args.selectedReasoningEffort,
        planItemId: args.activePlanItem?.id,
      })
    },
    onSubmitChanges: (changes: string) => void args.submitPlanChanges(changes, args.activePlanItem?.id),
    onDismiss: () => args.dismissPlan(args.activePlanItem?.id),
  }
}

export function useCodexPaneNotifications({
  acceptPlan,
  approveAction,
  defaultCollaborationModeId,
  denyAction,
  dismissPlan,
  dismissedPlanIds,
  interruptTurn,
  isStreaming,
  isSubagentThread,
  messages,
  notifyOnAwaitingInput,
  pendingApproval,
  pendingUserInput,
  permissionMode,
  rejectUserInput,
  respondToUserInput,
  selectedModelID,
  selectedReasoningEffort,
  sessionStorageKey,
  setIsPlanMode,
  setSelectedCollabMode,
  subagentSystemNotificationsEnabled,
  submitPlanChanges,
  turnStartedAt,
}: {
  acceptPlan: (options: { collaborationMode?: string; model?: string; effort?: string; planItemId?: string }) => Promise<unknown>
  approveAction: (decision: 'accept' | 'acceptForSession') => Promise<unknown>
  defaultCollaborationModeId: string
  denyAction: () => Promise<unknown>
  dismissPlan: (planItemId?: string) => void
  dismissedPlanIds: Set<string>
  interruptTurn: () => Promise<unknown>
  isStreaming: boolean
  isSubagentThread: (threadId: string) => boolean
  messages: Array<{ kind: string; toolType?: string; output?: string; status?: string; id: string; role?: string }>
  notifyOnAwaitingInput?: boolean
  pendingApproval: CodexApprovalRequest | null
  pendingUserInput: CodexUserInputRequest | null
  permissionMode: PermissionMode
  rejectUserInput: () => Promise<unknown>
  respondToUserInput: (answers: Record<string, { answers: string[] }>) => Promise<unknown>
  selectedModelID?: string
  selectedReasoningEffort?: string
  sessionStorageKey: string
  setIsPlanMode: (next: boolean) => void
  setSelectedCollabMode: (next: string | undefined) => void
  subagentSystemNotificationsEnabled?: boolean
  submitPlanChanges: (changes: string, planItemId?: string) => Promise<unknown>
  turnStartedAt: MutableRefObject<number>
}) {
  const activePlanItem = useMemo(
    () => deriveActivePlanItem(messages, dismissedPlanIds, isStreaming),
    [dismissedPlanIds, isStreaming, messages]
  )
  const planReady = activePlanItem !== null

  useCodexAwaitingNotifications({
    isSubagentThread,
    notifyOnAwaitingInput,
    pendingApproval,
    pendingUserInput,
    permissionMode,
    planReady,
    subagentSystemNotificationsEnabled,
    turnStartedAt,
  })
  useCodexAutoApproval({ approveAction, pendingApproval, permissionMode })
  useEscapeInterrupt(interruptTurn, isStreaming)

  const permissionDockProps = buildPermissionDockProps({
    approveAction,
    denyAction,
    permissionMode,
    sessionStorageKey,
  })
  const questionDockProps = buildQuestionDockProps({
    rejectUserInput,
    respondToUserInput,
    sessionStorageKey,
  })
  const pendingPlanProps = buildPendingPlanProps({
    acceptPlan,
    activePlanItem,
    defaultCollaborationModeId,
    dismissPlan,
    planReady,
    selectedModelID,
    selectedReasoningEffort,
    setIsPlanMode,
    setSelectedCollabMode,
    submitPlanChanges,
  })

  return {
    activePlanItem,
    pendingPlanProps,
    permissionDockProps,
    planReady,
    questionDockProps,
  }
}
