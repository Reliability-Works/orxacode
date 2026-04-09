/**
 * Local useState / useRef declarations for ChatView.
 *
 * Separating these from the main function body keeps the ChatView function
 * within the max-lines-per-function budget while preserving hook call order.
 */

import * as Schema from 'effect/Schema'
import { useState } from 'react'
import type { ThreadId } from '@orxa-code/contracts'
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
import { useChatViewLocalRefs, useChatViewPendingInputState } from './useChatViewLocalState.refs'

interface PendingPullRequestSetupRequest {
  threadId: ThreadId
  worktreePath: string
  scriptId: string
}

export const ChatAuxSidebarModeSchema = Schema.Literals(['none', 'git', 'files'])
export type ChatAuxSidebarMode = typeof ChatAuxSidebarModeSchema.Type

const CHAT_AUX_SIDEBAR_MODE_KEY = 'orxa:chat-aux-sidebar-mode'
const CHAT_AUX_SIDEBAR_WIDTH_KEY = 'orxa:chat-aux-sidebar-width'
const DEFAULT_CHAT_AUX_SIDEBAR_WIDTH = 384

function useChatAuxSidebarModeState() {
  return useLocalStorage(
    CHAT_AUX_SIDEBAR_MODE_KEY,
    'none' as ChatAuxSidebarMode,
    ChatAuxSidebarModeSchema
  )
}

function useChatAuxSidebarWidthState() {
  return useLocalStorage(CHAT_AUX_SIDEBAR_WIDTH_KEY, DEFAULT_CHAT_AUX_SIDEBAR_WIDTH, Schema.Finite)
}

function useChatAuxSidebarState() {
  const [auxSidebarMode, setAuxSidebarMode] = useChatAuxSidebarModeState()
  const [auxSidebarWidth, setAuxSidebarWidth] = useChatAuxSidebarWidthState()
  return { auxSidebarMode, setAuxSidebarMode, auxSidebarWidth, setAuxSidebarWidth }
}

function useLastInvokedScriptState() {
  return useLocalStorage(LAST_INVOKED_SCRIPT_BY_PROJECT_KEY, {}, LastInvokedScriptByProjectSchema)
}

export function useChatViewLocalState(prompt: string) {
  const refs = useChatViewLocalRefs(prompt)
  const pending = useChatViewPendingInputState()
  const { auxSidebarMode, setAuxSidebarMode, auxSidebarWidth, setAuxSidebarWidth } =
    useChatAuxSidebarState()
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
  const [planSidebarOpen, setPlanSidebarOpen] = useState(false)
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0)
  const [composerHighlightedItemId, setComposerHighlightedItemId] = useState<string | null>(null)
  const [pullRequestDialogState, setPullRequestDialogState] =
    useState<PullRequestDialogState | null>(null)
  const [pendingPullRequestSetupRequest, setPendingPullRequestSetupRequest] =
    useState<PendingPullRequestSetupRequest | null>(null)
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
    planSidebarOpen,
    setPlanSidebarOpen,
    auxSidebarMode,
    setAuxSidebarMode,
    auxSidebarWidth,
    setAuxSidebarWidth,
    nowTick,
    setNowTick,
    terminalFocusRequestId,
    setTerminalFocusRequestId,
    composerHighlightedItemId,
    setComposerHighlightedItemId,
    pullRequestDialogState,
    setPullRequestDialogState,
    pendingPullRequestSetupRequest,
    setPendingPullRequestSetupRequest,
    attachmentPreviewHandoffByMessageId,
    setAttachmentPreviewHandoffByMessageId,
    composerCursor,
    setComposerCursor,
    composerTrigger,
    setComposerTrigger,
    lastInvokedScriptByProjectId,
    setLastInvokedScriptByProjectId,
  }
}

export type ChatViewLocalState = ReturnType<typeof useChatViewLocalState>
export type { PendingPullRequestSetupRequest }
