/**
 * executeSend + handleSendFailure extracted from useChatSendAction.
 */

import {
  type ModelSelection,
  type ProviderKind,
  type ServerProvider,
  type ThreadId,
  type RuntimeMode,
  type ProviderInteractionMode,
} from '@orxa-code/contracts'
import { newCommandId, newMessageId } from '~/lib/utils'
import { readNativeApi } from '~/nativeApi'
import {
  appendTerminalContextsToPrompt,
  type TerminalContextDraft,
} from '../../lib/terminalContext'
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  type ComposerTrigger,
} from '../../composer-logic'
import {
  buildExpiredTerminalContextToastCopy,
  cloneComposerImageForRetry,
  readFileAsDataUrl,
  revokeUserMessagePreviewUrls,
} from '../ChatView.logic'
import { toastManager } from '../ui/toastState'
import type { ComposerImageAttachment, DraftThreadEnvMode } from '../../composerDraftStore'
import type { ChatMessage, Thread } from '../../types'
import { executeSendTurn } from './useChatSendAction.turn'
import { formatOutgoingPrompt } from './useChatSendAction.helpers'
import type {
  CreateWorktreeMutation,
  PersistThreadSettingsForNextTurn,
  RunProjectScriptFn,
  SendStateRefsAndCallbacks,
} from './useChatSendAction.types'

const IMAGE_ONLY_BOOTSTRAP_PROMPT =
  '[User attached one or more images without additional text. Respond using the conversation context and the attached image(s).]'

export interface ExecuteSendParams extends SendStateRefsAndCallbacks {
  api: NonNullable<ReturnType<typeof readNativeApi>>
  activeThread: Thread
  activeProject: {
    id: import('@orxa-code/contracts').ProjectId
    cwd: string
    scripts: import('@orxa-code/contracts').ProjectScript[]
    defaultModelSelection?: ModelSelection | null
  }
  isServerThread: boolean
  isLocalDraftThread: boolean
  envMode: DraftThreadEnvMode
  composerImages: ComposerImageAttachment[]
  composerTerminalContexts: TerminalContextDraft[]
  promptForSend: string
  trimmed: string
  selectedProvider: ProviderKind
  selectedModel: string
  selectedProviderModels: ReadonlyArray<ServerProvider['models'][number]>
  selectedPromptEffort: string | null
  selectedModelSelection: ModelSelection
  runtimeMode: RuntimeMode
  interactionMode: ProviderInteractionMode
  expiredTerminalContextCount: number
  persistThreadSettingsForNextTurn: PersistThreadSettingsForNextTurn
  runProjectScript: RunProjectScriptFn
  createWorktreeMutation: CreateWorktreeMutation
}

interface SendPreparedData {
  imagesSnapshot: ComposerImageAttachment[]
  ctxSnapshot: TerminalContextDraft[]
  messageId: import('@orxa-code/contracts').MessageId
  createdAt: string
  outgoing: string
  turnAttachmentsPromise: Promise<
    Array<{ type: 'image'; name: string; mimeType: string; sizeBytes: number; dataUrl: string }>
  >
}

function prepareSendData(p: ExecuteSendParams): SendPreparedData {
  const imagesSnapshot = [...p.composerImages]
  const ctxSnapshot = [...p.composerTerminalContexts]
  const messageText = appendTerminalContextsToPrompt(p.promptForSend, ctxSnapshot)
  const messageId = newMessageId()
  const createdAt = new Date().toISOString()
  const outgoing = formatOutgoingPrompt({
    provider: p.selectedProvider,
    model: p.selectedModel,
    models: p.selectedProviderModels,
    effort: p.selectedPromptEffort,
    text: messageText || IMAGE_ONLY_BOOTSTRAP_PROMPT,
  })
  const turnAttachmentsPromise = Promise.all(
    imagesSnapshot.map(async img => ({
      type: 'image' as const,
      name: img.name,
      mimeType: img.mimeType,
      sizeBytes: img.sizeBytes,
      dataUrl: await readFileAsDataUrl(img.file),
    }))
  )
  return { imagesSnapshot, ctxSnapshot, messageId, createdAt, outgoing, turnAttachmentsPromise }
}

function pushOptimisticMessageAndClearComposer(p: ExecuteSendParams, data: SendPreparedData): void {
  const optimisticAttachments = data.imagesSnapshot.map(img => ({
    type: 'image' as const,
    id: img.id,
    name: img.name,
    mimeType: img.mimeType,
    sizeBytes: img.sizeBytes,
    previewUrl: img.previewUrl,
  }))
  p.setOptimisticUserMessages(ex => [
    ...ex,
    {
      id: data.messageId,
      role: 'user',
      text: data.outgoing,
      ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
      createdAt: data.createdAt,
      streaming: false,
    },
  ])
  p.shouldAutoScrollRef.current = true
  p.forceStickToBottom()
  p.setThreadError(p.activeThread.id, null)
  if (p.expiredTerminalContextCount > 0) {
    const c = buildExpiredTerminalContextToastCopy(p.expiredTerminalContextCount, 'omitted')
    toastManager.add({ type: 'warning', title: c.title, description: c.description })
  }
  p.promptRef.current = ''
  p.clearComposerDraftContent(p.activeThread.id)
  p.setComposerHighlightedItemId(null)
  p.setComposerCursor(0)
  p.setComposerTrigger(null)
}

function resolveBaseBranchForWorktree(p: ExecuteSendParams): {
  baseBranchForWorktree: string | null
  blocked: boolean
} {
  const isFirstMessage = !p.isServerThread || p.activeThread.messages.length === 0
  const baseBranchForWorktree =
    isFirstMessage && p.envMode === 'worktree' && !p.activeThread.worktreePath
      ? p.activeThread.branch
      : null
  if (
    isFirstMessage &&
    p.envMode === 'worktree' &&
    !p.activeThread.worktreePath &&
    !p.activeThread.branch
  ) {
    p.setStoreThreadError(
      p.activeThread.id,
      'Select a base branch before sending in New worktree mode.'
    )
    return { baseBranchForWorktree: null, blocked: true }
  }
  return { baseBranchForWorktree, blocked: false }
}

export async function executeSend(p: ExecuteSendParams): Promise<void> {
  const { baseBranchForWorktree, blocked } = resolveBaseBranchForWorktree(p)
  if (blocked) return
  p.sendInFlightRef.current = true
  p.beginLocalDispatch({ preparingWorktree: Boolean(baseBranchForWorktree) })
  const data = prepareSendData(p)
  pushOptimisticMessageAndClearComposer(p, data)

  let turnStartSucceeded = false
  let createdLocalDraft = false
  try {
    const result = await executeSendTurn({
      api: p.api,
      thread: p.activeThread,
      project: p.activeProject,
      threadIdForSend: p.activeThread.id,
      isServerThread: p.isServerThread,
      isLocalDraftThread: p.isLocalDraftThread,
      baseBranchForWorktree,
      imagesSnapshot: data.imagesSnapshot,
      terminalContextsSnapshot: data.ctxSnapshot,
      trimmed: p.trimmed,
      outgoingText: data.outgoing,
      messageId: data.messageId,
      createdAt: data.createdAt,
      turnAttachmentsPromise: data.turnAttachmentsPromise,
      selectedProvider: p.selectedProvider,
      selectedModel: p.selectedModel,
      selectedModelSelection: p.selectedModelSelection,
      runtimeMode: p.runtimeMode,
      interactionMode: p.interactionMode,
      createWorktreeMutation: p.createWorktreeMutation,
      beginLocalDispatch: p.beginLocalDispatch,
      setStoreThreadBranch: p.setStoreThreadBranch,
      persistThreadSettings: p.persistThreadSettingsForNextTurn,
      runProjectScript: p.runProjectScript,
    })
    turnStartSucceeded = result.turnStartSucceeded
    createdLocalDraft = result.createdLocalDraft
  } catch (err) {
    await handleSendFailure({
      api: p.api,
      err,
      threadId: p.activeThread.id,
      messageId: data.messageId,
      promptForSend: p.promptForSend,
      imagesSnapshot: data.imagesSnapshot,
      ctxSnapshot: data.ctxSnapshot,
      turnStartSucceeded,
      createdLocalDraft,
      promptRef: p.promptRef,
      composerImagesRef: p.composerImagesRef,
      composerTerminalContextsRef: p.composerTerminalContextsRef,
      setOptimisticUserMessages: p.setOptimisticUserMessages,
      setPrompt: p.setPrompt,
      setComposerCursor: p.setComposerCursor,
      setComposerTrigger: p.setComposerTrigger,
      addComposerImagesToDraft: p.addComposerImagesToDraft,
      addComposerTerminalContextsToDraft: p.addComposerTerminalContextsToDraft,
      setThreadError: p.setThreadError,
    })
  }
  p.sendInFlightRef.current = false
  if (!turnStartSucceeded) p.resetLocalDispatch()
}

interface HandleSendFailureParams {
  api: NonNullable<ReturnType<typeof readNativeApi>>
  err: unknown
  threadId: ThreadId
  messageId: string
  promptForSend: string
  imagesSnapshot: ComposerImageAttachment[]
  ctxSnapshot: TerminalContextDraft[]
  turnStartSucceeded: boolean
  createdLocalDraft: boolean
  promptRef: React.MutableRefObject<string>
  composerImagesRef: React.MutableRefObject<ComposerImageAttachment[]>
  composerTerminalContextsRef: React.MutableRefObject<TerminalContextDraft[]>
  setOptimisticUserMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  setPrompt: (prompt: string) => void
  setComposerCursor: (cursor: number) => void
  setComposerTrigger: (trigger: ComposerTrigger | null) => void
  addComposerImagesToDraft: (images: ComposerImageAttachment[]) => void
  addComposerTerminalContextsToDraft: (contexts: TerminalContextDraft[]) => void
  setThreadError: (id: ThreadId | null, error: string | null) => void
}

async function handleSendFailure(p: HandleSendFailureParams): Promise<void> {
  if (p.createdLocalDraft && !p.turnStartSucceeded) {
    await p.api.orchestration
      .dispatchCommand({ type: 'thread.delete', commandId: newCommandId(), threadId: p.threadId })
      .catch(() => undefined)
  }
  const canRestore =
    !p.turnStartSucceeded &&
    p.promptRef.current.length === 0 &&
    p.composerImagesRef.current.length === 0 &&
    p.composerTerminalContextsRef.current.length === 0
  if (canRestore) {
    p.setOptimisticUserMessages(ex => {
      const removed = ex.filter(m => m.id === p.messageId)
      for (const m of removed) revokeUserMessagePreviewUrls(m)
      const next = ex.filter(m => m.id !== p.messageId)
      return next.length === ex.length ? ex : next
    })
    p.promptRef.current = p.promptForSend
    p.setPrompt(p.promptForSend)
    p.setComposerCursor(collapseExpandedComposerCursor(p.promptForSend, p.promptForSend.length))
    p.addComposerImagesToDraft(p.imagesSnapshot.map(cloneComposerImageForRetry))
    p.addComposerTerminalContextsToDraft(p.ctxSnapshot)
    p.setComposerTrigger(detectComposerTrigger(p.promptForSend, p.promptForSend.length))
  }
  p.setThreadError(p.threadId, p.err instanceof Error ? p.err.message : 'Failed to send message.')
}
