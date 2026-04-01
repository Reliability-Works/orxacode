import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { Attachment } from './hooks/useComposerState'
import type { AppPreferences } from '~/types/app'

type FollowupQueueItem = {
  id: string
  text: string
  timestamp: number
  attachments?: Attachment[]
}

type NotificationsContext = {
  activeProjectDir: string | undefined
  activeSessionID: string | undefined
  appPreferences: AppPreferences
  dockPendingPermission: {
    description: string
    filePattern?: string
    command?: string[]
  } | null
  dockPendingQuestion: {
    questions: Array<{ id: string }>
  } | null
  effectiveSystemAddendum: string | undefined
  followupQueue: FollowupQueueItem[]
  isSessionInProgress: boolean
  sendingQueuedId: string | undefined
  sendPrompt: (input: {
    textOverride: string
    attachmentOverride: Attachment[]
    systemAddendum: string | undefined
    promptSource: 'user'
    tools?: Record<string, boolean>
  }) => Promise<unknown>
  setFollowupQueue: Dispatch<SetStateAction<FollowupQueueItem[]>>
  setSendingQueuedId: Dispatch<SetStateAction<string | undefined>>
  toolsPolicy: Record<string, boolean> | undefined
}

function useAwaitingInputNotifications(args: NotificationsContext) {
  const { appPreferences, dockPendingPermission, dockPendingQuestion } = args
  const lastOpenCodeNotifyRef = useRef<string | null>(null)

  useEffect(() => {
    if (appPreferences.permissionMode === 'yolo-write') return
    if (!appPreferences.notifyOnAwaitingInput || document.hasFocus()) return
    const key = dockPendingQuestion
      ? `question:${dockPendingQuestion.questions?.[0]?.id ?? 'q'}`
      : dockPendingPermission
        ? `permission:${dockPendingPermission.description?.slice(0, 40) ?? 'p'}`
        : null
    if (!key || key === lastOpenCodeNotifyRef.current) return
    lastOpenCodeNotifyRef.current = key
    new Notification('Orxa Code', {
      body: dockPendingQuestion ? 'Agent is asking a question' : 'Agent needs permission to continue',
      silent: false,
    }).onclick = () => window.focus()
  }, [
    appPreferences.notifyOnAwaitingInput,
    appPreferences.permissionMode,
    dockPendingPermission,
    dockPendingQuestion,
  ])
}

function useTaskCompleteNotifications(args: NotificationsContext) {
  const { activeSessionID, appPreferences, isSessionInProgress } = args
  const prevSessionBusy = useRef(false)

  useEffect(() => {
    const isBusy = isSessionInProgress
    const wasBusy = prevSessionBusy.current
    prevSessionBusy.current = isBusy
    if (!appPreferences.notifyOnTaskComplete || document.hasFocus()) return
    if (wasBusy && !isBusy && activeSessionID) {
      new Notification('Orxa Code', {
        body: 'Agent has finished its task',
        silent: false,
      }).onclick = () => window.focus()
    }
  }, [activeSessionID, appPreferences.notifyOnTaskComplete, isSessionInProgress])
}

function useQueuedFollowupAutomation(args: NotificationsContext) {
  const {
    activeProjectDir,
    activeSessionID,
    effectiveSystemAddendum,
    followupQueue,
    isSessionInProgress,
    sendingQueuedId,
    sendPrompt,
    setFollowupQueue,
    setSendingQueuedId,
    toolsPolicy,
  } = args
  const prevSessionBusyForQueue = useRef(false)

  useEffect(() => {
    const isBusy = isSessionInProgress
    const wasBusy = prevSessionBusyForQueue.current
    prevSessionBusyForQueue.current = isBusy
    if (!activeProjectDir || !wasBusy || isBusy || followupQueue.length === 0 || sendingQueuedId) {
      return
    }
    const first = followupQueue[0]
    if (!first) {
      return
    }
    setSendingQueuedId(first.id)
    void sendPrompt({
      textOverride: first.text,
      attachmentOverride: first.attachments ?? [],
      systemAddendum: effectiveSystemAddendum,
      promptSource: 'user',
      tools: toolsPolicy,
    }).finally(() => {
      setSendingQueuedId(undefined)
    })
    setFollowupQueue(current => current.filter(message => message.id !== first.id))
  }, [
    activeProjectDir,
    effectiveSystemAddendum,
    followupQueue,
    isSessionInProgress,
    sendingQueuedId,
    sendPrompt,
    setFollowupQueue,
    setSendingQueuedId,
    toolsPolicy,
  ])

  useEffect(() => {
    setFollowupQueue([])
    setSendingQueuedId(undefined)
  }, [activeSessionID, setFollowupQueue, setSendingQueuedId])
}

export function useAppCoreNotifications(args: NotificationsContext) {
  useAwaitingInputNotifications(args)
  useTaskCompleteNotifications(args)
  useQueuedFollowupAutomation(args)
}
