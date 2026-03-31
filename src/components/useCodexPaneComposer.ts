import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { Attachment } from '../hooks/useComposerState'
import { addCodexComposerAttachments, buildCodexDisplayPrompt } from './CodexPane.helpers'
import type { PermissionMode } from '../types/app'

function buildTurnOptions({
  selectedCollabMode,
  selectedModelID,
  selectedReasoningEffort,
}: {
  selectedCollabMode?: string
  selectedModelID?: string
  selectedReasoningEffort?: string
}) {
  const options: { model?: string; effort?: string; collaborationMode?: string } = {}
  if (selectedModelID) options.model = selectedModelID
  if (selectedReasoningEffort) options.effort = selectedReasoningEffort
  if (selectedCollabMode) options.collaborationMode = selectedCollabMode
  return options
}

function useCodexQueueState({
  isStreaming,
  sendMessage,
}: {
  isStreaming: boolean
  sendMessage: (text: string) => Promise<unknown>
}) {
  const [codexQueue, setCodexQueue] = useState<Array<{ id: string; text: string; timestamp: number }>>([])
  const [codexSendingId, setCodexSendingId] = useState<string | undefined>()

  const prevCodexStreamingRef = useRef(false)
  useEffect(() => {
    const wasBusy = prevCodexStreamingRef.current
    prevCodexStreamingRef.current = isStreaming
    if (!wasBusy || isStreaming || codexQueue.length === 0 || codexSendingId) return
    const first = codexQueue[0]
    if (!first) return
    setCodexSendingId(first.id)
    void sendMessage(first.text).then(() => setCodexSendingId(undefined))
    setCodexQueue(current => current.filter(message => message.id !== first.id))
  }, [codexQueue, codexSendingId, isStreaming, sendMessage])

  const queueCodexMessage = useCallback((text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const id = `cq:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
    setCodexQueue(current => [...current, { id, text: trimmed, timestamp: Date.now() }])
  }, [])
  const removeCodexQueued = useCallback((id: string) => {
    setCodexQueue(current => current.filter(item => item.id !== id))
  }, [])

  return { codexQueue, codexSendingId, queueCodexMessage, removeCodexQueued, setCodexQueue, setCodexSendingId }
}

function useCodexQueueActions({
  codexQueue,
  codexSendingId,
  setCodexQueue,
  setCodexSendingId,
  setInput,
  steerMessage,
}: {
  codexQueue: Array<{ id: string; text: string; timestamp: number }>
  codexSendingId?: string
  setCodexQueue: Dispatch<SetStateAction<Array<{ id: string; text: string; timestamp: number }>>>
  setCodexSendingId: Dispatch<SetStateAction<string | undefined>>
  setInput: Dispatch<SetStateAction<string>>
  steerMessage: (text: string) => Promise<boolean>
}) {
  const editCodexQueued = useCallback((id: string) => {
    setCodexQueue(current => {
      const item = current.find(message => message.id === id)
      if (item) setInput(item.text)
      return current.filter(message => message.id !== id)
    })
  }, [setCodexQueue, setInput])

  const queuedAction = useCallback(async (id: string) => {
    const item = codexQueue.find(message => message.id === id)
    if (!item || codexSendingId) return
    setCodexSendingId(id)
    const sent = await steerMessage(item.text)
    setCodexSendingId(undefined)
    if (!sent) return
    setCodexQueue(current => current.filter(message => message.id !== id))
  }, [codexQueue, codexSendingId, setCodexQueue, setCodexSendingId, steerMessage])

  return { editCodexQueued, queuedAction }
}

function useCodexAttachmentActions({
  interruptTurn,
  setComposerAttachments,
}: {
  interruptTurn: () => Promise<unknown>
  setComposerAttachments: Dispatch<SetStateAction<Attachment[]>>
}) {
  const addComposerAttachments = useCallback((attachments: Attachment[]) => {
    setComposerAttachments(current => addCodexComposerAttachments(current, attachments))
  }, [setComposerAttachments])
  const removeAttachment = useCallback((url: string) => {
    setComposerAttachments(current => current.filter(item => item.url !== url))
  }, [setComposerAttachments])
  const pickImageAttachment = useCallback(async () => {
    try {
      const selection = await window.orxa.opencode.pickImage()
      if (selection) addComposerAttachments([selection])
    } catch {
      // Optional.
    }
  }, [addComposerAttachments])
  const abortActiveSession = useCallback(async () => {
    await interruptTurn()
  }, [interruptTurn])
  return { abortActiveSession, addComposerAttachments, pickImageAttachment, removeAttachment }
}

function useCodexPromptSubmission({
  composerAttachments,
  input,
  sendTurnNow,
  setComposerAttachments,
  setInput,
}: {
  composerAttachments: Attachment[]
  input: string
  sendTurnNow: (text: string, attachments: Attachment[]) => Promise<boolean>
  setComposerAttachments: Dispatch<SetStateAction<Attachment[]>>
  setInput: Dispatch<SetStateAction<string>>
}) {
  const queueCodexMessage = useCallback(
    (text: string, enqueueCodexMessage: (value: string) => void) => {
      enqueueCodexMessage(text)
      setInput('')
    },
    [setInput]
  )

  const sendPrompt = useCallback(async () => {
    const trimmed = input.trim()
    const attachmentsToSend = [...composerAttachments]
    if (!trimmed && attachmentsToSend.length === 0) return
    setInput('')
    setComposerAttachments([])
    const sent = await sendTurnNow(trimmed, attachmentsToSend)
    if (!sent) {
      setInput(trimmed)
      setComposerAttachments(attachmentsToSend)
    }
  }, [composerAttachments, input, sendTurnNow, setComposerAttachments, setInput])

  return { queueCodexMessage, sendPrompt }
}

function useCodexThreadReadiness({
  codexAccessMode,
  connect,
  connectionStatus,
  isDraft,
  permissionMode,
  startThread,
  thread,
}: {
  codexAccessMode?: string
  connect: () => Promise<{ status?: string } | undefined> | { status?: string } | undefined
  connectionStatus: string
  isDraft?: boolean
  permissionMode: PermissionMode
  startThread: (options: {
    title: string
    sandbox: 'danger-full-access' | 'read-only'
    approvalPolicy: 'never' | 'on-request'
  }) => Promise<{ id?: string | null } | undefined> | { id?: string | null } | undefined
  thread: { id?: string | null } | null
}) {
  return useCallback(async () => {
    if (thread) {
      return thread
    }
    if (isDraft || connectionStatus !== 'connected') {
      const state = await connect()
      const nextStatus = state?.status ?? connectionStatus
      if (nextStatus !== 'connected') {
        return null
      }
    }
    const allowFullAccess = permissionMode === 'yolo-write' || codexAccessMode === 'full-access'
    return (
      (await startThread({
        title: 'Orxa Code Session',
        sandbox: allowFullAccess ? 'danger-full-access' : 'read-only',
        approvalPolicy: allowFullAccess ? 'never' : 'on-request',
      })) ?? null
    )
  }, [codexAccessMode, connect, connectionStatus, isDraft, permissionMode, startThread, thread])
}

type UseCodexPaneComposerArgs = {
  codexAccessMode?: string
  connect: () => Promise<{ status?: string } | undefined> | { status?: string } | undefined
  connectionStatus: string
  directory: string
  interruptTurn: () => Promise<unknown>
  isDraft?: boolean
  isStreaming: boolean
  messageCount: number
  onFirstMessage?: () => void
  permissionMode: PermissionMode
  queueAutoTitleGeneration: (
    directory: string,
    prompt: string,
    existingUserMessageCount: number,
    targetThreadId: string
  ) => void
  selectedCollabMode?: string
  selectedModelID?: string
  selectedReasoningEffort?: string
  sendMessage: (
    text: string,
    options?: {
      threadID?: string
      model?: string
      effort?: string
      collaborationMode?: string
      attachments?: Array<{ type: 'image'; url: string }>
      displayPrompt?: string
    }
  ) => Promise<boolean>
  startThread: (options: {
    title: string
    sandbox: 'danger-full-access' | 'read-only'
    approvalPolicy: 'never' | 'on-request'
  }) => Promise<{ id?: string | null } | undefined> | { id?: string | null } | undefined
  steerMessage: (text: string) => Promise<boolean>
  thread: { id?: string | null } | null
}

export function useCodexPaneComposer({
  codexAccessMode, connect, connectionStatus, directory, interruptTurn, isDraft, isStreaming,
  messageCount, onFirstMessage, permissionMode, queueAutoTitleGeneration, selectedCollabMode,
  selectedModelID, selectedReasoningEffort, sendMessage, startThread, steerMessage, thread,
}: UseCodexPaneComposerArgs) {
  const [input, setInput] = useState('')
  const [composerAttachments, setComposerAttachments] = useState<Attachment[]>([])
  const [isPlanMode, setIsPlanMode] = useState(false)
  const { codexQueue, codexSendingId, queueCodexMessage: enqueueCodexMessage, removeCodexQueued, setCodexQueue, setCodexSendingId } =
    useCodexQueueState({ isStreaming, sendMessage: text => sendMessage(text) })
  const ensureThreadReady = useCodexThreadReadiness({
    codexAccessMode, connect, connectionStatus, isDraft, permissionMode, startThread, thread,
  })

  const sendTurnNow = useCallback(
    async (text: string, attachments: Attachment[], options?: { interruptIfBusy?: boolean }) => {
      const trimmed = text.trim()
      if (!trimmed && attachments.length === 0) return false
      const activeThread = thread ?? (await ensureThreadReady())
      if (!activeThread?.id) return false
      if (isStreaming) {
        if (!options?.interruptIfBusy) return false
        await interruptTurn()
      }
      if (trimmed) {
        queueAutoTitleGeneration(directory, trimmed, messageCount, activeThread.id)
      }
      const turnOptions = buildTurnOptions({ selectedCollabMode, selectedModelID, selectedReasoningEffort })
      const sent = await sendMessage(trimmed, {
        ...(Object.keys(turnOptions).length > 0 ? turnOptions : {}),
        threadID: activeThread.id,
        ...(attachments.length > 0
          ? { attachments: attachments.map(attachment => ({ type: 'image' as const, url: attachment.url })) }
          : {}),
        displayPrompt: buildCodexDisplayPrompt(trimmed, attachments.length),
      })
      if (!sent) return false
      onFirstMessage?.()
      return true
    },
    [
      directory, ensureThreadReady, interruptTurn, isStreaming, messageCount, onFirstMessage,
      queueAutoTitleGeneration, selectedCollabMode, selectedModelID, selectedReasoningEffort,
      sendMessage, thread,
    ]
  )

  const { abortActiveSession, addComposerAttachments, pickImageAttachment, removeAttachment } =
    useCodexAttachmentActions({ interruptTurn, setComposerAttachments })
  const promptSubmission = useCodexPromptSubmission({ composerAttachments, input, sendTurnNow, setComposerAttachments, setInput })
  const { editCodexQueued, queuedAction } = useCodexQueueActions({
    codexQueue, codexSendingId, setCodexQueue, setCodexSendingId, setInput, steerMessage,
  })

  return {
    abortActiveSession,
    addComposerAttachments,
    codexQueue,
    codexSendingId,
    composerAttachments,
    editCodexQueued,
    input,
    isPlanMode,
    pickImageAttachment,
    queueCodexMessage: (text: string) => promptSubmission.queueCodexMessage(text, enqueueCodexMessage),
    queuedAction,
    removeAttachment,
    removeCodexQueued,
    sendPrompt: promptSubmission.sendPrompt,
    setInput,
    setIsPlanMode,
  }
}
