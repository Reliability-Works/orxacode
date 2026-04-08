/**
 * Shared types for the chat send action hook and its split helpers.
 *
 * Extracted to a sibling module so the hook bodies and execute helpers can
 * share the same type surface without duplicating it in multiple files.
 */

import type {
  ModelSelection,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadId,
} from '@orxa-code/contracts'
import type { TerminalContextDraft } from '../../lib/terminalContext'
import type { ComposerTrigger } from '../../composer-logic'
import type { ComposerImageAttachment } from '../../composerDraftStore'
import type { ChatMessage } from '../../types'
import type { RunScriptOptions } from './useChatTerminalActions'

export interface SendStateRefsAndCallbacks {
  sendInFlightRef: React.MutableRefObject<boolean>
  shouldAutoScrollRef: React.MutableRefObject<boolean>
  composerImagesRef: React.MutableRefObject<ComposerImageAttachment[]>
  composerTerminalContextsRef: React.MutableRefObject<TerminalContextDraft[]>
  promptRef: React.MutableRefObject<string>
  beginLocalDispatch: (opts?: { preparingWorktree?: boolean }) => void
  resetLocalDispatch: () => void
  setStoreThreadError: (id: ThreadId, error: string | null) => void
  setStoreThreadBranch: (id: ThreadId, branch: string, path: string) => void
  setThreadError: (id: ThreadId | null, error: string | null) => void
  setOptimisticUserMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>
  setComposerCursor: (cursor: number) => void
  setComposerTrigger: (trigger: ComposerTrigger | null) => void
  setComposerHighlightedItemId: (id: string | null) => void
  forceStickToBottom: () => void
  clearComposerDraftContent: (id: ThreadId) => void
  addComposerImagesToDraft: (images: ComposerImageAttachment[]) => void
  addComposerTerminalContextsToDraft: (contexts: TerminalContextDraft[]) => void
  setPrompt: (prompt: string) => void
}

export interface PersistThreadSettingsForNextTurn {
  (input: {
    threadId: ThreadId
    createdAt: string
    modelSelection?: ModelSelection
    runtimeMode: RuntimeMode
    interactionMode: ProviderInteractionMode
  }): Promise<void>
}

export interface RunProjectScriptFn {
  (script: { id: string; command: string; name: string }, opts?: RunScriptOptions): Promise<void>
}

export interface CreateWorktreeMutation {
  mutateAsync: (input: {
    cwd: string
    branch: string
    newBranch: string
  }) => Promise<{ worktree: { branch: string; path: string } }>
}
