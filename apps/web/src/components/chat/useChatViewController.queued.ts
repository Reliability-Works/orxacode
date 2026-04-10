import { useCallback } from 'react'
import type { ThreadId } from '@orxa-code/contracts'

import { collapseExpandedComposerCursor, detectComposerTrigger } from '../../composer-logic'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { useComposerDraftCallbacks } from './useChatViewBehavior1'
import { revokeQueuedComposerMessage, type QueuedComposerMessage } from './queuedComposerMessages'

export function useQueuedComposerMessageCallbacks(
  threadId: ThreadId,
  state: {
    store: ReturnType<typeof useChatViewStoreSelectors>
    ls: ReturnType<typeof useChatViewLocalState>
  },
  utils: {
    composerDraftCbs: ReturnType<typeof useComposerDraftCallbacks>
    scheduleComposerFocus: () => void
  }
) {
  const { store, ls } = state
  const {
    promptRef,
    composerImagesRef,
    composerTerminalContextsRef,
    setComposerCursor,
    setComposerTrigger,
    setQueuedComposerMessages,
  } = ls
  const restoreQueuedComposerMessage = useCallback(
    (message: QueuedComposerMessage) => {
      store.clearComposerDraftContent(threadId)
      store.setComposerDraftPrompt(threadId, message.prompt)
      store.setComposerDraftTerminalContexts(threadId, message.terminalContexts)
      store.setComposerDraftModelSelection(threadId, message.selectedModelSelection)
      store.setComposerDraftRuntimeMode(threadId, message.runtimeMode)
      store.setComposerDraftInteractionMode(threadId, message.interactionMode)
      utils.composerDraftCbs.addComposerImagesToDraft(message.images)
      setQueuedComposerMessages(messages => messages.filter(entry => entry.id !== message.id))
      promptRef.current = message.prompt
      composerImagesRef.current = message.images
      composerTerminalContextsRef.current = message.terminalContexts
      setComposerCursor(collapseExpandedComposerCursor(message.prompt, message.prompt.length))
      setComposerTrigger(detectComposerTrigger(message.prompt, message.prompt.length))
      utils.scheduleComposerFocus()
    },
    [
      composerImagesRef,
      composerTerminalContextsRef,
      promptRef,
      setComposerCursor,
      setComposerTrigger,
      setQueuedComposerMessages,
      store,
      threadId,
      utils,
    ]
  )
  const removeQueuedComposerMessage = useCallback(
    (message: QueuedComposerMessage) => {
      setQueuedComposerMessages(messages => messages.filter(entry => entry.id !== message.id))
      revokeQueuedComposerMessage(message)
    },
    [setQueuedComposerMessages]
  )
  return { restoreQueuedComposerMessage, removeQueuedComposerMessage }
}
