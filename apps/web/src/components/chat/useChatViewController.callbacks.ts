/**
 * Core callbacks wiring extracted from useChatViewController. Composed of
 * several smaller sub-hooks to stay under the per-function line limit.
 */

import { type ThreadId } from '@orxa-code/contracts'
import {
  useChatTerminalOpenControls,
  useChatTerminalManagement,
  useChatRunProjectScript,
} from './useChatTerminalActions'
import {
  useApprovalCallbacks,
  usePendingUserInputCallbacks,
  useProviderModeCallbacks,
  usePersistThreadSettings,
  useProjectScriptCallbacks,
  useApplyPromptReplacement,
  useReadComposerSnapshot,
  useNudgeComposerMenuHighlight,
  useOnSelectComposerItem,
  useImageExpandCallbacks,
  useRevertAndInterruptCallbacks,
  useGitSidebarCallbacks,
  useEnvModeAndTraitsCallbacks,
  useWorkGroupCallbacks,
} from './useChatViewBehavior2'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { useChatViewDerivedThread } from './useChatViewDerivedThread'
import type { useChatViewDerivedActivities } from './useChatViewDerivedActivities'
import type { useChatViewDerivedComposer } from './useChatViewDerivedComposer'

type S = ReturnType<typeof useChatViewStoreSelectors>
type L = ReturnType<typeof useChatViewLocalState>
type T = ReturnType<typeof useChatViewDerivedThread>
type A = ReturnType<typeof useChatViewDerivedActivities>
type C = ReturnType<typeof useChatViewDerivedComposer>

function useTerminalAndScriptCallbacks(
  store: S,
  ls: L,
  td: T,
  setThreadError: (id: ThreadId | null, error: string | null) => void
) {
  const { setTerminalOpen, setTerminalHeight, toggleTerminalVisibility } =
    useChatTerminalOpenControls(
      td.activeThreadId,
      store.terminalState.terminalOpen,
      store.storeSetTerminalOpen,
      store.storeSetTerminalHeight
    )
  const terminalMgmt = useChatTerminalManagement(
    td.activeThreadId,
    store.terminalState,
    store.storeSplitTerminal,
    store.storeNewTerminal,
    store.storeSetActiveTerminal,
    store.storeCloseTerminal,
    ls.setTerminalFocusRequestId
  )
  const runProjectScript = useChatRunProjectScript(
    td.activeThreadId,
    td.activeProject?.cwd ?? null,
    td.activeThread?.worktreePath ?? null,
    null,
    td.activeProject?.id ?? null,
    store.terminalState,
    store.storeNewTerminal,
    store.storeSetActiveTerminal,
    ls.setTerminalFocusRequestId,
    ls.setLastInvokedScriptByProjectId,
    setTerminalOpen,
    setThreadError
  )
  return {
    setTerminalOpen,
    setTerminalHeight,
    toggleTerminalVisibility,
    ...terminalMgmt,
    runProjectScript,
  }
}

function useProviderAndScriptCallbacks(
  threadId: ThreadId,
  store: S,
  ls: L,
  td: T,
  scheduleComposerFocus: () => void
) {
  const provider = useProviderModeCallbacks(threadId, store, ls, td, scheduleComposerFocus)
  const persistThreadSettingsForNextTurn = usePersistThreadSettings(store)
  const { saveProjectScript, updateProjectScript, deleteProjectScript } = useProjectScriptCallbacks(
    store,
    td
  )
  return {
    ...provider,
    persistThreadSettingsForNextTurn,
    saveProjectScript,
    updateProjectScript,
    deleteProjectScript,
  }
}

function useComposerInteractionCallbacks(
  ls: L,
  cd: C,
  setPrompt: (s: string) => void,
  handleInteractionModeChange: (
    mode: import('@orxa-code/contracts').ProviderInteractionMode
  ) => void,
  onProviderModelSelect: (
    provider: import('@orxa-code/contracts').ProviderKind,
    model: string
  ) => void
) {
  const applyPromptReplacement = useApplyPromptReplacement(ls, setPrompt)
  const readComposerSnapshot = useReadComposerSnapshot(ls)
  const nudgeComposerMenuHighlight = useNudgeComposerMenuHighlight(ls, cd)
  const onSelectComposerItem = useOnSelectComposerItem(
    ls,
    applyPromptReplacement,
    readComposerSnapshot,
    handleInteractionModeChange,
    onProviderModelSelect
  )
  return {
    applyPromptReplacement,
    readComposerSnapshot,
    nudgeComposerMenuHighlight,
    onSelectComposerItem,
  }
}

function useThreadCallbacks(
  threadId: ThreadId,
  store: S,
  ls: L,
  td: T,
  ad: A,
  setThreadError: (id: ThreadId | null, error: string | null) => void,
  setPrompt: (s: string) => void,
  scheduleComposerFocus: () => void
) {
  const imageCbs = useImageExpandCallbacks(ls)
  const { onRevertToTurnCount, onInterrupt } = useRevertAndInterruptCallbacks(
    td,
    ad,
    setThreadError,
    ls
  )
  const { openGitSidebar } = useGitSidebarCallbacks(ls)
  const { onEnvModeChange, setPromptFromTraits } = useEnvModeAndTraitsCallbacks(
    threadId,
    store,
    td,
    ls,
    setPrompt,
    scheduleComposerFocus
  )
  const { onToggleWorkGroup } = useWorkGroupCallbacks(ls)
  const { onRespondToApproval, onRespondToUserInput } = useApprovalCallbacks(
    td.activeThreadId,
    store,
    ls
  )
  const pendingUserInputCbs = usePendingUserInputCallbacks(ls, ad, onRespondToUserInput)
  return {
    ...imageCbs,
    onRevertToTurnCount,
    onInterrupt,
    openGitSidebar,
    onEnvModeChange,
    setPromptFromTraits,
    onToggleWorkGroup,
    onRespondToApproval,
    onRespondToUserInput,
    ...pendingUserInputCbs,
  }
}

export function useChatViewCallbacksCore(
  threadId: ThreadId,
  store: S,
  ls: L,
  td: T,
  ad: A,
  cd: C,
  setThreadError: (id: ThreadId | null, error: string | null) => void,
  setPrompt: (s: string) => void,
  scheduleComposerFocus: () => void
) {
  const terminalAndScript = useTerminalAndScriptCallbacks(store, ls, td, setThreadError)
  const providerAndScript = useProviderAndScriptCallbacks(
    threadId,
    store,
    ls,
    td,
    scheduleComposerFocus
  )
  const composerInteraction = useComposerInteractionCallbacks(
    ls,
    cd,
    setPrompt,
    providerAndScript.handleInteractionModeChange,
    providerAndScript.onProviderModelSelect
  )
  const threadCbs = useThreadCallbacks(
    threadId,
    store,
    ls,
    td,
    ad,
    setThreadError,
    setPrompt,
    scheduleComposerFocus
  )
  return {
    ...terminalAndScript,
    ...providerAndScript,
    ...composerInteraction,
    ...threadCbs,
  }
}
