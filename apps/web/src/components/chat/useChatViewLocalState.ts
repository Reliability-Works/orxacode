/**
 * Local useState / useRef declarations for ChatView.
 *
 * Separating these from the main function body keeps the ChatView function
 * within the max-lines-per-function budget while preserving hook call order.
 */

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

export function useChatViewLocalState(prompt: string) {
  const refs = useChatViewLocalRefs(prompt)
  const pending = useChatViewPendingInputState()
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
  const [lastInvokedScriptByProjectId, setLastInvokedScriptByProjectId] = useLocalStorage(
    LAST_INVOKED_SCRIPT_BY_PROJECT_KEY,
    {},
    LastInvokedScriptByProjectSchema
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
