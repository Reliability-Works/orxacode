/**
 * Local useState / useRef declarations for ChatView.
 *
 * Separating these from the main function body keeps the ChatView function
 * within the max-lines-per-function budget while preserving hook call order.
 */

import * as Schema from 'effect/Schema'
import { useEffect, useRef, useState } from 'react'
import type { GitDiffScopeKind, ThreadId } from '@orxa-code/contracts'
import type { ExpandedImagePreview } from './ExpandedImagePreview'
import type { PullRequestDialogState } from '../ChatView.logic'
import type { ChatMessage } from '../../types'
import {
  collapseExpandedComposerCursor,
  detectComposerTrigger,
  type ComposerTrigger,
} from '../../composer-logic'
import { useLocalStorage } from '~/hooks/useLocalStorage'
import {
  LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
  LastInvokedScriptByProjectSchema,
} from '../ChatView.logic'
import { revokeQueuedComposerMessage, type QueuedComposerMessage } from './queuedComposerMessages'
import { useChatViewLocalRefs, useChatViewPendingInputState } from './useChatViewLocalState.refs'

interface PendingPullRequestSetupRequest {
  threadId: ThreadId
  worktreePath: string
  scriptId: string
}

export const ChatAuxSidebarModeSchema = Schema.Literals(['none', 'git', 'files', 'browser'])
export type ChatAuxSidebarMode = typeof ChatAuxSidebarModeSchema.Type
export const ChatGitDiffScopeSchema = Schema.Literals(['unstaged', 'staged', 'branch'])

const CHAT_AUX_SIDEBAR_WIDTH_KEY = 'orxa:chat-aux-sidebar-width'
const DEFAULT_CHAT_AUX_SIDEBAR_WIDTH = 384
const CHAT_GIT_DIFF_SCOPE_KEY = 'orxa:chat-git-diff-scope'

function useChatAuxSidebarModeState() {
  return useState<ChatAuxSidebarMode>('none')
}

function useChatAuxSidebarWidthState() {
  return useLocalStorage(CHAT_AUX_SIDEBAR_WIDTH_KEY, DEFAULT_CHAT_AUX_SIDEBAR_WIDTH, Schema.Finite)
}

function useGitDiffScopeState() {
  return useLocalStorage<GitDiffScopeKind, GitDiffScopeKind>(
    CHAT_GIT_DIFF_SCOPE_KEY,
    'unstaged',
    ChatGitDiffScopeSchema
  )
}

function useChatAuxSidebarState() {
  const [auxSidebarMode, setAuxSidebarMode] = useChatAuxSidebarModeState()
  const [auxSidebarWidth, setAuxSidebarWidth] = useChatAuxSidebarWidthState()
  return { auxSidebarMode, setAuxSidebarMode, auxSidebarWidth, setAuxSidebarWidth }
}

function useLastInvokedScriptState() {
  return useLocalStorage(LAST_INVOKED_SCRIPT_BY_PROJECT_KEY, {}, LastInvokedScriptByProjectSchema)
}

function useChatViewComposerUiState(prompt: string) {
  const [attachmentPreviewHandoffByMessageId, setAttachmentPreviewHandoffByMessageId] = useState<
    Record<string, string[]>
  >({})
  const [composerCursor, setComposerCursor] = useState(() =>
    collapseExpandedComposerCursor(prompt, prompt.length)
  )
  const [composerTrigger, setComposerTrigger] = useState<ComposerTrigger | null>(() =>
    detectComposerTrigger(prompt, prompt.length)
  )
  return {
    attachmentPreviewHandoffByMessageId,
    setAttachmentPreviewHandoffByMessageId,
    composerCursor,
    setComposerCursor,
    composerTrigger,
    setComposerTrigger,
  }
}

function useQueuedComposerMessagesState() {
  const [queuedComposerMessages, setQueuedComposerMessages] = useState<QueuedComposerMessage[]>([])
  const queuedComposerMessagesRef = useRef<QueuedComposerMessage[]>([])

  useEffect(() => {
    queuedComposerMessagesRef.current = queuedComposerMessages
  }, [queuedComposerMessages])

  useEffect(
    () => () => {
      for (const message of queuedComposerMessagesRef.current) {
        revokeQueuedComposerMessage(message)
      }
    },
    []
  )

  return { queuedComposerMessages, setQueuedComposerMessages }
}

export function useChatViewLocalState(prompt: string) {
  const refs = useChatViewLocalRefs(prompt)
  const pending = useChatViewPendingInputState()
  const { auxSidebarMode, setAuxSidebarMode, auxSidebarWidth, setAuxSidebarWidth } =
    useChatAuxSidebarState()
  const [gitDiffScope, setGitDiffScope] = useGitDiffScopeState()
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] =
    useLastInvokedScriptState()
  const [isDragOverComposer, setIsDragOverComposer] = useState(false)
  const [expandedImage, setExpandedImage] = useState<ExpandedImagePreview | null>(null)
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([])
  const [localDraftErrorsByThreadId, setLocalDraftErrorsByThreadId] = useState<
    Record<ThreadId, string | null>
  >({})
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false)
  const [expandedWorkGroups, setExpandedWorkGroups] = useState<Record<string, boolean>>({})
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0)
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null)
  const { queuedComposerMessages, setQueuedComposerMessages } = useQueuedComposerMessagesState()
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null)
  const [pendingPullRequestSetupRequest, setPendingPullRequestSetupRequest] =
    useState<PendingPullRequestSetupRequest | null>(null)
  const composerUi = useChatViewComposerUiState(prompt)

  return {
    ...refs,
    ...pending,
    isDragOverComposer,
    setIsDragOverComposer,
    expandedImage,
    setExpandedImage,
    optimisticUserMessages,
    setOptimisticUserMessages,
    localDraftErrorsByThreadId,
    setLocalDraftErrorsByThreadId,
    isRevertingCheckpoint,
    setIsRevertingCheckpoint,
    expandedWorkGroups,
    setExpandedWorkGroups,
    auxSidebarMode,
    setAuxSidebarMode,
    auxSidebarWidth,
    setAuxSidebarWidth,
    gitDiffScope,
    setGitDiffScope,
    nowTick,
    setNowTick,
    terminalFocusRequestId,
    setTerminalFocusRequestId,
    composerHighlightedItemId,
    setComposerHighlightedItemId,
    queuedComposerMessages,
    setQueuedComposerMessages,
    pullRequestDialogState,
    setPullRequestDialogState,
    pendingPullRequestSetupRequest,
    setPendingPullRequestSetupRequest,
    ...composerUi,
    lastInvokedScriptByProjectId,
    setLastInvokedScriptByProjectId,
  }
}

export type ChatViewLocalState = ReturnType<typeof useChatViewLocalState>
export type { PendingPullRequestSetupRequest }
