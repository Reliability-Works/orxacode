import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type {
  CodexApprovalRequest,
  CodexAttachment,
  CodexState,
  CodexThread,
  CodexUserInputRequest,
} from '@shared/ipc'
import type { TodoItem } from '../components/chat/TodoDock'
import type { SubagentInfo } from './codex-subagent-helpers'
import type { CommandDiffBaseline } from './codex-diff-helpers'
import type { CodexMessageItem } from './codex-session-types'
import { resetStreamingBookkeeping } from './codex-session-streaming'

const DEFAULT_CODEX_COLLABORATION_MODE_ID = 'default'
const PLAN_IMPLEMENTATION_PROMPT = 'Implement the plan.'

export interface CodexSessionActionDeps {
  directory: string
  codexOptions?: { codexPath?: string; codexArgs?: string }
  // State values
  serverInfo?: CodexState['serverInfo']
  thread: CodexThread | null
  pendingApproval: CodexApprovalRequest | null
  pendingUserInput: CodexUserInputRequest | null
  // Refs
  activeTurnIdRef: MutableRefObject<string | null>
  thinkingItemIdRef: MutableRefObject<string | null>
  pendingInterruptRef: MutableRefObject<boolean>
  interruptRequestedRef: MutableRefObject<boolean>
  messageIdCounterRef: MutableRefObject<number>
  streamingItemIdRef: MutableRefObject<string | null>
  codexItemToMsgIdRef: MutableRefObject<Map<string, string>>
  codexItemToExploreGroupIdRef: MutableRefObject<Map<string, string>>
  activeExploreGroupIdRef: MutableRefObject<string | null>
  currentReasoningIdRef: MutableRefObject<string | null>
  latestPlanUpdateIdRef: MutableRefObject<string | null>
  subagentThreadIdsRef: MutableRefObject<Set<string>>
  commandDiffSnapshotsRef: MutableRefObject<Map<string, Promise<CommandDiffBaseline | null>>>
  // Callbacks
  setConnectionState: (
    status: CodexState['status'],
    nextServerInfo?: CodexState['serverInfo'],
    nextLastError?: string
  ) => void
  setThreadState: (next: CodexThread | null) => void
  setMessagesState: (
    next: CodexMessageItem[] | ((previous: CodexMessageItem[]) => CodexMessageItem[])
  ) => void
  setStreamingState: (next: boolean) => void
  setPendingApprovalState: (next: CodexApprovalRequest | null) => void
  setPendingUserInputState: (next: CodexUserInputRequest | null) => void
  setPlanItemsState: (next: TodoItem[]) => void
  setDismissedPlanIdsState: (
    next: Set<string> | ((previous: Set<string>) => Set<string>)
  ) => void
  setSubagentsState: (
    next: SubagentInfo[] | ((previous: SubagentInfo[]) => SubagentInfo[])
  ) => void
  setActiveSubagentThreadIdState: (
    next: string | null | ((previous: string | null) => string | null)
  ) => void
  setThreadNameState: (next: string | undefined) => void
  recordLastError: (error: unknown, statusOverride?: CodexState['status']) => void
  clearLastError: () => void
  updateMessages: (
    updater: (previous: CodexMessageItem[]) => CodexMessageItem[],
    priority?: 'normal' | 'deferred'
  ) => void
}

// ---------------------------------------------------------------------------
// Connection Actions - Connect/Disconnect
// ---------------------------------------------------------------------------

function useCodexConnectionActions(deps: CodexSessionActionDeps) {
  const {
    directory,
    codexOptions,
    serverInfo,
    setConnectionState,
    setThreadState,
    setMessagesState,
    setStreamingState,
    recordLastError,
  } = deps

  const connect = useCallback(async () => {
    if (!window.orxa?.codex) {
      setConnectionState('error', serverInfo, 'Codex bridge not available')
      return
    }
    try {
      const state = await window.orxa.codex.start(directory, codexOptions)
      setConnectionState(state.status, state.serverInfo, state.lastError)
    } catch (err) {
      recordLastError(err, 'error')
    }
  }, [codexOptions, directory, recordLastError, serverInfo, setConnectionState])

  const disconnect = useCallback(async () => {
    if (!window.orxa?.codex) return
    try {
      await window.orxa.codex.stop()
    } catch {
      // ignore
    }
    setConnectionState('disconnected')
    setThreadState(null)
    setMessagesState([])
    setStreamingState(false)
  }, [setConnectionState, setMessagesState, setStreamingState, setThreadState])

  return { connect, disconnect }
}

// ---------------------------------------------------------------------------
// Thread Actions - Start Thread
// ---------------------------------------------------------------------------

function useCodexThreadActions(deps: CodexSessionActionDeps) {
  const {
    directory,
    activeTurnIdRef,
    thinkingItemIdRef,
    codexItemToMsgIdRef,
    codexItemToExploreGroupIdRef,
    activeExploreGroupIdRef,
    currentReasoningIdRef,
    latestPlanUpdateIdRef,
    subagentThreadIdsRef,
    pendingInterruptRef,
    interruptRequestedRef,
    commandDiffSnapshotsRef,
    streamingItemIdRef,
    setThreadState,
    setMessagesState,
    setStreamingState,
    setPlanItemsState,
    setThreadNameState,
    setSubagentsState,
    setActiveSubagentThreadIdState,
    recordLastError,
    clearLastError,
  } = deps

  const startThread = useCallback(
    async (options?: {
      model?: string
      title?: string
      approvalPolicy?: string
      sandbox?: string
    }) => {
      if (!window.orxa?.codex) return
      try {
        clearLastError()
        const t = await window.orxa.codex.startThread({
          cwd: directory,
          model: options?.model,
          title: options?.title,
          approvalPolicy: options?.approvalPolicy,
          sandbox: options?.sandbox,
        })
        setThreadState(t)
        setMessagesState([])
        setStreamingState(false)
        resetStreamingBookkeeping({
          streamingItemIdRef,
          thinkingItemIdRef,
          activeTurnIdRef,
          codexItemToMsgId: codexItemToMsgIdRef,
        })
        codexItemToExploreGroupIdRef.current.clear()
        activeExploreGroupIdRef.current = null
        currentReasoningIdRef.current = null
        latestPlanUpdateIdRef.current = null
        setPlanItemsState([])
        setThreadNameState(undefined)
        setSubagentsState([])
        setActiveSubagentThreadIdState(null)
        subagentThreadIdsRef.current.clear()
        pendingInterruptRef.current = false
        interruptRequestedRef.current = false
        commandDiffSnapshotsRef.current.clear()
      } catch (err) {
        recordLastError(err)
      }
    },
    [
      activeExploreGroupIdRef,
      activeTurnIdRef,
      clearLastError,
      codexItemToExploreGroupIdRef,
      codexItemToMsgIdRef,
      commandDiffSnapshotsRef,
      currentReasoningIdRef,
      directory,
      interruptRequestedRef,
      latestPlanUpdateIdRef,
      pendingInterruptRef,
      recordLastError,
      setActiveSubagentThreadIdState,
      setMessagesState,
      setPlanItemsState,
      setStreamingState,
      setSubagentsState,
      setThreadNameState,
      setThreadState,
      streamingItemIdRef,
      subagentThreadIdsRef,
      thinkingItemIdRef,
    ]
  )

  return { startThread }
}

// ---------------------------------------------------------------------------
// Message Actions
// ---------------------------------------------------------------------------

function useCodexMessageActions(deps: CodexSessionActionDeps) {
  const { directory, thread, messageIdCounterRef, recordLastError, clearLastError, setMessagesState } = deps

  const sendMessage = useCallback(
    async (
      prompt: string,
      options?: {
        model?: string
        effort?: string
        collaborationMode?: string
        attachments?: CodexAttachment[]
        displayPrompt?: string
      }
    ) => {
      if (!window.orxa?.codex || !thread) return

      const userMsgId = `codex-user-${messageIdCounterRef.current++}`
      const displayPrompt = options?.displayPrompt ?? prompt
      setMessagesState(prev => [
        ...prev,
        {
          id: userMsgId,
          kind: 'message',
          role: 'user',
          content: displayPrompt,
          timestamp: Date.now(),
        },
      ])

      try {
        clearLastError()
        await window.orxa.codex.startTurn(
          thread.id,
          prompt,
          directory,
          options?.model,
          options?.effort,
          options?.collaborationMode,
          options?.attachments
        )
      } catch (err) {
        console.error('[useCodexSession] codex.startTurn failed', err)
        recordLastError(err)
      }
    },
    [clearLastError, directory, messageIdCounterRef, recordLastError, setMessagesState, thread]
  )

  const steerMessage = useCallback(
    async (prompt: string) => {
      if (!window.orxa?.codex || !thread) return false
      const trimmed = prompt.trim()
      const turnId = deps.activeTurnIdRef.current?.trim() ?? ''
      if (!trimmed || !turnId) {
        return false
      }
      const userMsgId = `codex-user-${messageIdCounterRef.current++}`
      setMessagesState(prev => [
        ...prev,
        { id: userMsgId, kind: 'message', role: 'user', content: trimmed, timestamp: Date.now() },
      ])
      try {
        clearLastError()
        await window.orxa.codex.steerTurn(thread.id, turnId, trimmed)
        return true
      } catch (err) {
        recordLastError(err)
        return false
      }
    },
    [deps.activeTurnIdRef, clearLastError, messageIdCounterRef, recordLastError, setMessagesState, thread]
  )

  return { sendMessage, steerMessage }
}

// ---------------------------------------------------------------------------
// Approval/Input Actions
// ---------------------------------------------------------------------------

function useCodexApprovalActions(deps: CodexSessionActionDeps) {
  const {
    pendingApproval,
    pendingUserInput,
    setPendingApprovalState,
    setPendingUserInputState,
    recordLastError,
  } = deps

  const approveAction = useCallback(
    async (decision: string) => {
      if (!window.orxa?.codex || !pendingApproval) return
      try {
        await window.orxa.codex.approve(pendingApproval.id, decision)
        setPendingApprovalState(null)
      } catch (err) {
        recordLastError(err)
      }
    },
    [pendingApproval, recordLastError, setPendingApprovalState]
  )

  const denyAction = useCallback(async () => {
    if (!window.orxa?.codex || !pendingApproval) return
    try {
      await window.orxa.codex.deny(pendingApproval.id)
      setPendingApprovalState(null)
    } catch (err) {
      recordLastError(err)
    }
  }, [pendingApproval, recordLastError, setPendingApprovalState])

  const respondToUserInput = useCallback(
    async (answers: Record<string, { answers: string[] }>) => {
      if (!window.orxa?.codex || !pendingUserInput) return
      try {
        await window.orxa.codex.respondToUserInput(pendingUserInput.id, answers)
        setPendingUserInputState(null)
      } catch (err) {
        recordLastError(err)
      }
    },
    [pendingUserInput, recordLastError, setPendingUserInputState]
  )

  const rejectUserInput = useCallback(async () => {
    if (!window.orxa?.codex || !pendingUserInput) return
    try {
      const emptyAnswers: Record<string, { answers: string[] }> = {}
      for (const q of pendingUserInput.questions ?? []) {
        emptyAnswers[q.id] = { answers: [] }
      }
      await window.orxa.codex.respondToUserInput(pendingUserInput.id, emptyAnswers)
      setPendingUserInputState(null)
    } catch (err) {
      recordLastError(err)
    }
  }, [pendingUserInput, recordLastError, setPendingUserInputState])

  return {
    approveAction,
    denyAction,
    respondToUserInput,
    rejectUserInput,
  }
}

// ---------------------------------------------------------------------------
// Interrupt Actions
// ---------------------------------------------------------------------------

function useCodexInterruptActions(deps: CodexSessionActionDeps) {
  const {
    thread,
    activeTurnIdRef,
    thinkingItemIdRef,
    pendingInterruptRef,
    interruptRequestedRef,
    setStreamingState,
    recordLastError,
    updateMessages,
  } = deps

  const interruptTurn = useCallback(async () => {
    if (!window.orxa?.codex || !thread) return
    const turnId = activeTurnIdRef.current
    interruptRequestedRef.current = true
    if (!turnId) {
      pendingInterruptRef.current = true
    }
    setStreamingState(false)
    activeTurnIdRef.current = null
    const tId = thinkingItemIdRef.current
    thinkingItemIdRef.current = null
    updateMessages(prev =>
      prev.filter(message => {
        if (tId && message.id === tId) {
          return false
        }
        return !(message.kind === 'reasoning' && !message.content && !message.summary)
      })
    )
    try {
      await window.orxa.codex.interruptTurn(thread.id, turnId ?? 'pending')
    } catch (err) {
      recordLastError(err)
    }
  }, [
    activeTurnIdRef,
    interruptRequestedRef,
    pendingInterruptRef,
    recordLastError,
    setStreamingState,
    thinkingItemIdRef,
    thread,
    updateMessages,
  ])

  return { interruptTurn }
}

// ---------------------------------------------------------------------------
// Plan Actions
// ---------------------------------------------------------------------------

interface PlanActionsResult {
  acceptPlan: (options?: {
    collaborationMode?: string
    model?: string
    effort?: string
    planItemId?: string
  }) => Promise<void>
  submitPlanChanges: (changes: string, planItemId?: string) => Promise<void>
  dismissPlan: (planItemId?: string) => void
  openSubagentThread: (threadId: string) => void
  closeSubagentThread: () => void
}

function useCodexPlanActions(
  deps: CodexSessionActionDeps,
  sendMessage: (
    prompt: string,
    options?: {
      model?: string
      effort?: string
      collaborationMode?: string
      attachments?: CodexAttachment[]
      displayPrompt?: string
    }
  ) => Promise<void>
): PlanActionsResult {
  const { setDismissedPlanIdsState, setActiveSubagentThreadIdState } = deps

  const acceptPlan = useCallback(
    async (options?: {
      collaborationMode?: string
      model?: string
      effort?: string
      planItemId?: string
    }) => {
      const collaborationMode = options?.collaborationMode ?? DEFAULT_CODEX_COLLABORATION_MODE_ID
      const planItemId = options?.planItemId
      if (planItemId) {
        setDismissedPlanIdsState(prev => new Set([...prev, planItemId]))
      }
      await sendMessage(PLAN_IMPLEMENTATION_PROMPT, {
        model: options?.model,
        effort: options?.effort,
        collaborationMode,
      })
    },
    [sendMessage, setDismissedPlanIdsState]
  )

  const submitPlanChanges = useCallback(
    async (changes: string, planItemId?: string) => {
      if (planItemId) {
        setDismissedPlanIdsState(prev => new Set([...prev, planItemId]))
      }
      await sendMessage(`Update the plan with these changes:\n\n${changes}`, { model: undefined })
    },
    [sendMessage, setDismissedPlanIdsState]
  )

  const dismissPlan = useCallback(
    (planItemId?: string) => {
      if (planItemId) {
        setDismissedPlanIdsState(prev => new Set([...prev, planItemId]))
      }
    },
    [setDismissedPlanIdsState]
  )

  const openSubagentThread = useCallback(
    (threadId: string) => {
      setActiveSubagentThreadIdState(threadId)
    },
    [setActiveSubagentThreadIdState]
  )

  const closeSubagentThread = useCallback(() => {
    setActiveSubagentThreadIdState(null)
  }, [setActiveSubagentThreadIdState])

  return {
    acceptPlan,
    submitPlanChanges,
    dismissPlan,
    openSubagentThread,
    closeSubagentThread,
  }
}

// ---------------------------------------------------------------------------
// Main Hook
// ---------------------------------------------------------------------------

export function useCodexSessionActions(deps: CodexSessionActionDeps) {
  const connectionActions = useCodexConnectionActions(deps)
  const threadActions = useCodexThreadActions(deps)
  const messageActions = useCodexMessageActions(deps)
  const approvalActions = useCodexApprovalActions(deps)
  const interruptActions = useCodexInterruptActions(deps)
  const planActions = useCodexPlanActions(deps, messageActions.sendMessage)

  return {
    ...connectionActions,
    ...threadActions,
    ...messageActions,
    ...approvalActions,
    ...interruptActions,
    ...planActions,
  }
}
