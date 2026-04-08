/**
 * Composer draft store subscriptions for ChatView.
 *
 * Extracted from useChatViewStoreSelectors to keep that aggregator within
 * the max-lines-per-function budget. Only pure composerDraftStore actions
 * and the sticky model selection setter live here.
 */

import { useComposerDraftStore } from '../../composerDraftStore'

export function useChatViewComposerDraftActions() {
  const setStickyComposerModelSelection = useComposerDraftStore(s => s.setStickyModelSelection)
  const setComposerDraftPrompt = useComposerDraftStore(s => s.setPrompt)
  const setComposerDraftModelSelection = useComposerDraftStore(s => s.setModelSelection)
  const setComposerDraftRuntimeMode = useComposerDraftStore(s => s.setRuntimeMode)
  const setComposerDraftInteractionMode = useComposerDraftStore(s => s.setInteractionMode)
  const addComposerDraftImage = useComposerDraftStore(s => s.addImage)
  const addComposerDraftImages = useComposerDraftStore(s => s.addImages)
  const removeComposerDraftImage = useComposerDraftStore(s => s.removeImage)
  const insertComposerDraftTerminalContext = useComposerDraftStore(s => s.insertTerminalContext)
  const addComposerDraftTerminalContexts = useComposerDraftStore(s => s.addTerminalContexts)
  const removeComposerDraftTerminalContext = useComposerDraftStore(s => s.removeTerminalContext)
  const setComposerDraftTerminalContexts = useComposerDraftStore(s => s.setTerminalContexts)
  const clearComposerDraftPersistedAttachments = useComposerDraftStore(
    s => s.clearPersistedAttachments
  )
  const syncComposerDraftPersistedAttachments = useComposerDraftStore(
    s => s.syncPersistedAttachments
  )
  const clearComposerDraftContent = useComposerDraftStore(s => s.clearComposerContent)
  const setDraftThreadContext = useComposerDraftStore(s => s.setDraftThreadContext)
  const getDraftThreadByProjectId = useComposerDraftStore(s => s.getDraftThreadByProjectId)
  const getDraftThread = useComposerDraftStore(s => s.getDraftThread)
  const setProjectDraftThreadId = useComposerDraftStore(s => s.setProjectDraftThreadId)
  const clearProjectDraftThreadId = useComposerDraftStore(s => s.clearProjectDraftThreadId)

  return {
    setStickyComposerModelSelection,
    setComposerDraftPrompt,
    setComposerDraftModelSelection,
    setComposerDraftRuntimeMode,
    setComposerDraftInteractionMode,
    addComposerDraftImage,
    addComposerDraftImages,
    removeComposerDraftImage,
    insertComposerDraftTerminalContext,
    addComposerDraftTerminalContexts,
    removeComposerDraftTerminalContext,
    setComposerDraftTerminalContexts,
    clearComposerDraftPersistedAttachments,
    syncComposerDraftPersistedAttachments,
    clearComposerDraftContent,
    setDraftThreadContext,
    getDraftThreadByProjectId,
    getDraftThread,
    setProjectDraftThreadId,
    clearProjectDraftThreadId,
  }
}
