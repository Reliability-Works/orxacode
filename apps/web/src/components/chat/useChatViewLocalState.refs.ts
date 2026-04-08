/**
 * Ref declarations for ChatView local state.
 *
 * Extracted from useChatViewLocalState to keep that hook within the
 * max-lines-per-function budget. Refs only — no useState/useEffect.
 */

import { useCallback, useRef, useState } from 'react'
import type { ApprovalRequestId } from '@orxa-code/contracts'
import type { ComposerPromptEditorHandle } from '../ComposerPromptEditor'
import type { ComposerCommandItem } from './ComposerCommandMenu'
import type { ComposerImageAttachment } from '../../composerDraftStore'
import type { TerminalContextDraft } from '../../lib/terminalContext'
import type { ChatMessage } from '../../types'
import type { PendingUserInputDraftAnswer } from '../../pendingUserInput'

export function useChatViewPendingInputState() {
  const [respondingRequestIds, setRespondingRequestIds] = useState<ApprovalRequestId[]>([])
  const [respondingUserInputRequestIds, setRespondingUserInputRequestIds] = useState<
    ApprovalRequestId[]
  >([])
  const [pendingUserInputAnswersByRequestId, setPendingUserInputAnswersByRequestId] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({})
  const [pendingUserInputQuestionIndexByRequestId, setPendingUserInputQuestionIndexByRequestId] =
    useState<Record<string, number>>({})
  return {
    respondingRequestIds,
    setRespondingRequestIds,
    respondingUserInputRequestIds,
    setRespondingUserInputRequestIds,
    pendingUserInputAnswersByRequestId,
    setPendingUserInputAnswersByRequestId,
    pendingUserInputQuestionIndexByRequestId,
    setPendingUserInputQuestionIndexByRequestId,
  }
}

export function useChatViewLocalRefs(prompt: string) {
  const promptRef = useRef(prompt)
  const optimisticUserMessagesRef = useRef<ChatMessage[]>([])
  const composerTerminalContextsRef = useRef<TerminalContextDraft[]>([])
  const planSidebarDismissedForTurnRef = useRef<string | null>(null)
  const setPlanSidebarDismissedForTurn = useCallback((turnKey: string) => {
    planSidebarDismissedForTurnRef.current = turnKey
  }, [])
  const clearPlanSidebarDismissedForTurn = useCallback(() => {
    planSidebarDismissedForTurnRef.current = null
  }, [])
  const planSidebarOpenOnNextThreadRef = useRef(false)
  const composerEditorRef = useRef<ComposerPromptEditorHandle | null>(null)
  const composerImagesRef = useRef<ComposerImageAttachment[]>([])
  const composerSelectLockRef = useRef(false)
  const composerMenuOpenRef = useRef(false)
  const composerMenuItemsRef = useRef<ComposerCommandItem[]>([])
  const activeComposerMenuItemRef = useRef<ComposerCommandItem | null>(null)
  const attachmentPreviewHandoffByMessageIdRef = useRef<Record<string, string[]>>({})
  const attachmentPreviewHandoffTimeoutByMessageIdRef = useRef<Record<string, number>>({})
  const dragDepthRef = useRef(0)

  return {
    promptRef,
    optimisticUserMessagesRef,
    composerTerminalContextsRef,
    planSidebarDismissedForTurnRef,
    setPlanSidebarDismissedForTurn,
    clearPlanSidebarDismissedForTurn,
    planSidebarOpenOnNextThreadRef,
    composerEditorRef,
    composerImagesRef,
    composerSelectLockRef,
    composerMenuOpenRef,
    composerMenuItemsRef,
    activeComposerMenuItemRef,
    attachmentPreviewHandoffByMessageIdRef,
    attachmentPreviewHandoffTimeoutByMessageIdRef,
    dragDepthRef,
  }
}

export type ChatViewLocalRefs = ReturnType<typeof useChatViewLocalRefs>
