import { useCallback, useEffect, useMemo, type Dispatch, type SetStateAction } from 'react'
import type {
  PermissionRequest,
  QuestionAnswer,
  QuestionRequest,
} from '@opencode-ai/sdk/v2/client'
import type { Attachment } from './hooks/useComposerState'
import type { AgentQuestion } from './components/chat/QuestionDock'
import type { UnifiedProvider } from './state/unified-runtime'
import type { AppPreferences } from '~/types/app'
import { useAppCoreNotifications } from './app-core-notifications'
import {
  selectPendingPermissionDockData,
  selectPendingQuestionDockData,
} from './state/unified-runtime-store'

const PERMISSION_REPLY_TIMEOUT_MS = 15_000

type FollowupQueueItem = {
  id: string
  text: string
  timestamp: number
  attachments?: Attachment[]
}

type RequestConfirmation = (input: {
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  variant: 'danger'
}) => Promise<boolean>

type AppCoreAwaitingInputContext = {
  activePresentationProvider: UnifiedProvider
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  activeSessionKey: string | null
  appPreferences: AppPreferences
  effectiveSystemAddendum: string | undefined
  followupQueue: FollowupQueueItem[]
  isSessionInProgress: boolean
  permissions: PermissionRequest[]
  questions: QuestionRequest[]
  requestConfirmation: RequestConfirmation
  sendingQueuedId: string | undefined
  setAppPreferences: Dispatch<SetStateAction<AppPreferences>>
  setFollowupQueue: Dispatch<SetStateAction<FollowupQueueItem[]>>
  setPermissionDecisionPending: Dispatch<SetStateAction<'once' | 'always' | 'reject' | null>>
  setPermissionDecisionPendingRequestID: Dispatch<SetStateAction<string | null>>
  setSendingQueuedId: Dispatch<SetStateAction<string | undefined>>
  setStatusLine: (value: string) => void
  sendPrompt: (input: {
    textOverride: string
    attachmentOverride: Attachment[]
    systemAddendum: string | undefined
    promptSource: 'user'
    tools?: Record<string, boolean>
  }) => Promise<unknown>
  toolsPolicy: Record<string, boolean> | undefined
  permissionDecisionPending: 'once' | 'always' | 'reject' | null
  permissionDecisionPendingRequestID: string | null
  refreshProject: (directory: string) => Promise<unknown>
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  let timeoutId: number | undefined
  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) {
      window.clearTimeout(timeoutId)
    }
  })
}

function usePermissionDecisionReset(args: {
  pendingPermission: PermissionRequest | undefined
  permissionDecisionPending: AppCoreAwaitingInputContext['permissionDecisionPending']
  permissionDecisionPendingRequestID: string | null
  setPermissionDecisionPending: AppCoreAwaitingInputContext['setPermissionDecisionPending']
  setPermissionDecisionPendingRequestID: AppCoreAwaitingInputContext['setPermissionDecisionPendingRequestID']
}) {
  const {
    pendingPermission,
    permissionDecisionPending,
    permissionDecisionPendingRequestID,
    setPermissionDecisionPending,
    setPermissionDecisionPendingRequestID,
  } = args

  useEffect(() => {
    if (!permissionDecisionPending) {
      if (permissionDecisionPendingRequestID !== null) {
        setPermissionDecisionPendingRequestID(null)
      }
      return
    }
    if (!pendingPermission || permissionDecisionPendingRequestID !== pendingPermission.id) {
      setPermissionDecisionPending(null)
      setPermissionDecisionPendingRequestID(null)
    }
  }, [
    pendingPermission,
    permissionDecisionPending,
    permissionDecisionPendingRequestID,
    setPermissionDecisionPending,
    setPermissionDecisionPendingRequestID,
  ])
}

function useYoloPermissionAutoApprove(args: {
  activeProjectDir: string | undefined
  permissionMode: AppPreferences['permissionMode']
  isPermissionDecisionInFlight: boolean
  pendingPermission: PermissionRequest | undefined
  refreshProject: AppCoreAwaitingInputContext['refreshProject']
  setPermissionDecisionPending: AppCoreAwaitingInputContext['setPermissionDecisionPending']
  setPermissionDecisionPendingRequestID: AppCoreAwaitingInputContext['setPermissionDecisionPendingRequestID']
  setStatusLine: AppCoreAwaitingInputContext['setStatusLine']
}) {
  const {
    activeProjectDir,
    permissionMode,
    isPermissionDecisionInFlight,
    pendingPermission,
    refreshProject,
    setPermissionDecisionPending,
    setPermissionDecisionPendingRequestID,
    setStatusLine,
  } = args

  useEffect(() => {
    if (permissionMode !== 'yolo-write') {
      return
    }
    if (!activeProjectDir || !pendingPermission || isPermissionDecisionInFlight) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        setPermissionDecisionPending('once')
        setPermissionDecisionPendingRequestID(pendingPermission.id)
        await window.orxa.opencode.replyPermission(
          activeProjectDir,
          pendingPermission.id,
          'once',
          'Auto-approved in Yolo mode'
        )
        if (!cancelled) {
          await refreshProject(activeProjectDir)
        }
      } catch (error) {
        if (!cancelled) {
          setStatusLine(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) {
          setPermissionDecisionPending(null)
          setPermissionDecisionPendingRequestID(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    activeProjectDir,
    isPermissionDecisionInFlight,
    pendingPermission,
    permissionMode,
    refreshProject,
    setPermissionDecisionPending,
    setPermissionDecisionPendingRequestID,
    setStatusLine,
  ])
}

function useReplyPendingPermission(args: {
  activeProjectDir: string | undefined
  confirmDangerousActions: boolean
  pendingPermission: PermissionRequest | undefined
  refreshProject: AppCoreAwaitingInputContext['refreshProject']
  requestConfirmation: AppCoreAwaitingInputContext['requestConfirmation']
  setAppPreferences: AppCoreAwaitingInputContext['setAppPreferences']
  setPermissionDecisionPending: AppCoreAwaitingInputContext['setPermissionDecisionPending']
  setPermissionDecisionPendingRequestID: AppCoreAwaitingInputContext['setPermissionDecisionPendingRequestID']
  setStatusLine: AppCoreAwaitingInputContext['setStatusLine']
}) {
  const {
    activeProjectDir,
    confirmDangerousActions,
    pendingPermission,
    refreshProject,
    requestConfirmation,
    setAppPreferences,
    setPermissionDecisionPending,
    setPermissionDecisionPendingRequestID,
    setStatusLine,
  } = args

  return useCallback(
    async (reply: 'once' | 'always' | 'reject') => {
      if (!activeProjectDir || !pendingPermission) {
        return
      }
      if (reply === 'reject' && confirmDangerousActions) {
        const confirmed = await requestConfirmation({
          title: 'Reject permission request',
          message: 'Reject this permission request?',
          confirmLabel: 'Reject',
          cancelLabel: 'Cancel',
          variant: 'danger',
        })
        if (!confirmed) {
          return
        }
      }
      try {
        if (reply === 'always') {
          setAppPreferences(current =>
            current.permissionMode === 'yolo-write'
              ? current
              : {
                  ...current,
                  permissionMode: 'yolo-write',
                }
          )
        }
        setPermissionDecisionPending(reply)
        setPermissionDecisionPendingRequestID(pendingPermission.id)
        await withTimeout(
          window.orxa.opencode.replyPermission(activeProjectDir, pendingPermission.id, reply),
          PERMISSION_REPLY_TIMEOUT_MS,
          'Permission response timed out. Please try again.'
        )
        await refreshProject(activeProjectDir)
        setStatusLine(`Permission ${reply === 'reject' ? 'rejected' : 'approved'}`)
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      } finally {
        setPermissionDecisionPending(null)
        setPermissionDecisionPendingRequestID(null)
      }
    },
    [
      activeProjectDir,
      confirmDangerousActions,
      pendingPermission,
      refreshProject,
      requestConfirmation,
      setAppPreferences,
      setPermissionDecisionPending,
      setPermissionDecisionPendingRequestID,
      setStatusLine,
    ]
  )
}

function usePendingPermissionState(context: AppCoreAwaitingInputContext) {
  const pendingPermission = useMemo(() => context.permissions[0], [context.permissions])
  const isPermissionDecisionInFlight = Boolean(
    pendingPermission &&
      context.permissionDecisionPending !== null &&
      context.permissionDecisionPendingRequestID === pendingPermission.id
  )

  usePermissionDecisionReset({
    pendingPermission,
    permissionDecisionPending: context.permissionDecisionPending,
    permissionDecisionPendingRequestID: context.permissionDecisionPendingRequestID,
    setPermissionDecisionPending: context.setPermissionDecisionPending,
    setPermissionDecisionPendingRequestID: context.setPermissionDecisionPendingRequestID,
  })
  useYoloPermissionAutoApprove({
    activeProjectDir: context.activeProjectDir,
    permissionMode: context.appPreferences.permissionMode,
    isPermissionDecisionInFlight,
    pendingPermission,
    refreshProject: context.refreshProject,
    setPermissionDecisionPending: context.setPermissionDecisionPending,
    setPermissionDecisionPendingRequestID: context.setPermissionDecisionPendingRequestID,
    setStatusLine: context.setStatusLine,
  })
  const replyPendingPermission = useReplyPendingPermission({
    activeProjectDir: context.activeProjectDir,
    confirmDangerousActions: context.appPreferences.confirmDangerousActions,
    pendingPermission,
    refreshProject: context.refreshProject,
    requestConfirmation: context.requestConfirmation,
    setAppPreferences: context.setAppPreferences,
    setPermissionDecisionPending: context.setPermissionDecisionPending,
    setPermissionDecisionPendingRequestID: context.setPermissionDecisionPendingRequestID,
    setStatusLine: context.setStatusLine,
  })

  return { pendingPermission, isPermissionDecisionInFlight, replyPendingPermission }
}

function usePendingQuestionState(context: AppCoreAwaitingInputContext) {
  const {
    activeProjectDir,
    activeSessionID,
    appPreferences,
    questions,
    refreshProject,
    requestConfirmation,
    setStatusLine,
  } = context

  const pendingQuestion = useMemo(() => {
    const question = questions[0] ?? null
    if (question && activeSessionID && question.sessionID && question.sessionID !== activeSessionID) {
      return null
    }
    return question
  }, [activeSessionID, questions])

  const replyPendingQuestion = useCallback(
    async (answers: QuestionAnswer[]) => {
      if (!activeProjectDir || !pendingQuestion) {
        return
      }
      const normalized = answers.map(item =>
        item.map(value => value.trim()).filter(value => value.length > 0)
      )
      if (!normalized.some(item => item.length > 0)) {
        return
      }
      try {
        await window.orxa.opencode.replyQuestion(activeProjectDir, pendingQuestion.id, normalized)
        await refreshProject(activeProjectDir)
        setStatusLine('Question answered')
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error))
      }
    },
    [activeProjectDir, pendingQuestion, refreshProject, setStatusLine]
  )

  const rejectPendingQuestion = useCallback(async () => {
    if (!activeProjectDir || !pendingQuestion) {
      return
    }
    if (appPreferences.confirmDangerousActions) {
      const confirmed = await requestConfirmation({
        title: 'Reject question request',
        message: 'Reject this question request?',
        confirmLabel: 'Reject',
        cancelLabel: 'Cancel',
        variant: 'danger',
      })
      if (!confirmed) {
        return
      }
    }
    try {
      await window.orxa.opencode.rejectQuestion(activeProjectDir, pendingQuestion.id)
      await refreshProject(activeProjectDir)
      setStatusLine('Question rejected')
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error))
    }
  }, [
    activeProjectDir,
    appPreferences.confirmDangerousActions,
    pendingQuestion,
    refreshProject,
    requestConfirmation,
    setStatusLine,
  ])

  return { pendingQuestion, replyPendingQuestion, rejectPendingQuestion }
}

function usePendingDockProps(args: {
  activePresentationProvider: AppCoreAwaitingInputContext['activePresentationProvider']
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  activeSessionKey: string | null
  permissionMode: AppPreferences['permissionMode']
  isPermissionDecisionInFlight: boolean
  replyPendingPermission: (reply: 'once' | 'always' | 'reject') => Promise<void>
  pendingQuestion: QuestionRequest | null
  replyPendingQuestion: (answers: QuestionAnswer[]) => Promise<void>
  rejectPendingQuestion: () => Promise<void>
}) {
  const {
    activePresentationProvider,
    activeProjectDir,
    activeSessionID,
    activeSessionKey,
    permissionMode,
    isPermissionDecisionInFlight,
    replyPendingPermission,
    pendingQuestion,
    replyPendingQuestion,
    rejectPendingQuestion,
  } = args

  const pendingPermissionData = selectPendingPermissionDockData({
    provider: activePresentationProvider,
    directory: activeProjectDir,
    sessionID: activeSessionID,
    sessionKey: activeSessionKey ?? undefined,
    permissionMode,
  })

  const pendingQuestionData = selectPendingQuestionDockData({
    provider: activePresentationProvider,
    directory: activeProjectDir,
    sessionID: activeSessionID,
    sessionKey: activeSessionKey ?? undefined,
  })

  const dockPendingPermission = useMemo(() => {
    if (!pendingPermissionData || isPermissionDecisionInFlight) {
      return null
    }
    return {
      description: pendingPermissionData.description,
      filePattern: pendingPermissionData.filePattern,
      command: pendingPermissionData.command,
      onDecide: (decision: 'allow_once' | 'allow_always' | 'reject') => {
        const replyMap: Record<string, 'once' | 'always' | 'reject'> = {
          allow_once: 'once',
          allow_always: 'always',
          reject: 'reject',
        }
        void replyPendingPermission(replyMap[decision])
      },
    }
  }, [isPermissionDecisionInFlight, pendingPermissionData, replyPendingPermission])

  const dockPendingQuestion = useMemo(() => {
    if (!pendingQuestionData || !pendingQuestion) {
      return null
    }
    return {
      questions: pendingQuestionData.questions as AgentQuestion[],
      onSubmit: (answers: Record<string, string | string[]>) => {
        const ordered: QuestionAnswer[] = pendingQuestionData.questions.map(question => {
          const answer = answers[question.id]
          if (!answer) {
            return []
          }
          return Array.isArray(answer) ? answer : [answer]
        })
        void replyPendingQuestion(ordered)
      },
      onReject: () => {
        void rejectPendingQuestion()
      },
    }
  }, [pendingQuestion, pendingQuestionData, rejectPendingQuestion, replyPendingQuestion])

  return { dockPendingPermission, dockPendingQuestion }
}

export function useAppCoreAwaitingInput(context: AppCoreAwaitingInputContext) {
  const permissionState = usePendingPermissionState(context)
  const questionState = usePendingQuestionState(context)
  const dockState = usePendingDockProps({
    activePresentationProvider: context.activePresentationProvider,
    activeProjectDir: context.activeProjectDir,
    activeSessionID: context.activeSessionID,
    activeSessionKey: context.activeSessionKey,
    permissionMode: context.appPreferences.permissionMode,
    isPermissionDecisionInFlight: permissionState.isPermissionDecisionInFlight,
    replyPendingPermission: permissionState.replyPendingPermission,
    pendingQuestion: questionState.pendingQuestion,
    replyPendingQuestion: questionState.replyPendingQuestion,
    rejectPendingQuestion: questionState.rejectPendingQuestion,
  })

  useAppCoreNotifications({
    activeProjectDir: context.activeProjectDir,
    activeSessionID: context.activeSessionID,
    appPreferences: context.appPreferences,
    dockPendingPermission: dockState.dockPendingPermission,
    dockPendingQuestion: dockState.dockPendingQuestion,
    effectiveSystemAddendum: context.effectiveSystemAddendum,
    followupQueue: context.followupQueue,
    isSessionInProgress: context.isSessionInProgress,
    sendingQueuedId: context.sendingQueuedId,
    sendPrompt: context.sendPrompt,
    setFollowupQueue: context.setFollowupQueue,
    setSendingQueuedId: context.setSendingQueuedId,
    toolsPolicy: context.toolsPolicy,
  })

  return {
    pendingPermission: permissionState.pendingPermission,
    pendingQuestion: questionState.pendingQuestion,
    isPermissionDecisionInFlight: permissionState.isPermissionDecisionInFlight,
    replyPendingPermission: permissionState.replyPendingPermission,
    replyPendingQuestion: questionState.replyPendingQuestion,
    rejectPendingQuestion: questionState.rejectPendingQuestion,
    dockPendingPermission: dockState.dockPendingPermission,
    dockPendingQuestion: dockState.dockPendingQuestion,
  }
}
