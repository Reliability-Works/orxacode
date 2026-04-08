/**
 * Provider/model + mode change callbacks extracted from useChatViewBehavior2.
 */

import { useCallback } from 'react'
import {
  type ModelSelection,
  type ProviderInteractionMode,
  type ProviderKind,
  type RuntimeMode,
  type ThreadId,
} from '@orxa-code/contracts'
import { resolveSelectableProvider } from '../../providerModels'
import { resolveAppModelSelection } from '../../modelSelection'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { useChatViewDerivedThread } from './useChatViewDerivedThread'

type S = ReturnType<typeof useChatViewStoreSelectors>
type L = ReturnType<typeof useChatViewLocalState>
type T = ReturnType<typeof useChatViewDerivedThread>

function useProviderModelSelectCallback(store: S, td: T, scheduleComposerFocus: () => void) {
  const { setComposerDraftModelSelection, setStickyComposerModelSelection, settings } = store
  const { lockedProvider, providerStatuses, activeThread } = td
  return useCallback(
    (provider: ProviderKind, model: string) => {
      if (!activeThread) return
      if (lockedProvider !== null && provider !== lockedProvider) {
        scheduleComposerFocus()
        return
      }
      const resolvedProvider = resolveSelectableProvider(providerStatuses, provider)
      const resolvedModel = resolveAppModelSelection(
        resolvedProvider,
        settings,
        providerStatuses,
        model
      )
      const nextModelSelection: ModelSelection = {
        provider: resolvedProvider,
        model: resolvedModel,
      }
      setComposerDraftModelSelection(activeThread.id, nextModelSelection)
      setStickyComposerModelSelection(nextModelSelection)
      scheduleComposerFocus()
    },
    [
      activeThread,
      lockedProvider,
      providerStatuses,
      settings,
      scheduleComposerFocus,
      setComposerDraftModelSelection,
      setStickyComposerModelSelection,
    ]
  )
}

function useRuntimeModeChangeCallback(
  threadId: ThreadId,
  store: S,
  td: T,
  scheduleComposerFocus: () => void
) {
  const { setComposerDraftRuntimeMode, setDraftThreadContext } = store
  const { runtimeMode, isLocalDraftThread } = td
  return useCallback(
    (mode: RuntimeMode) => {
      if (mode === runtimeMode) return
      setComposerDraftRuntimeMode(threadId, mode)
      if (isLocalDraftThread) setDraftThreadContext(threadId, { runtimeMode: mode })
      scheduleComposerFocus()
    },
    [
      isLocalDraftThread,
      runtimeMode,
      scheduleComposerFocus,
      setComposerDraftRuntimeMode,
      setDraftThreadContext,
      threadId,
    ]
  )
}

function useInteractionModeChangeCallback(
  threadId: ThreadId,
  store: S,
  td: T,
  scheduleComposerFocus: () => void
) {
  const { setComposerDraftInteractionMode, setDraftThreadContext } = store
  const { interactionMode, isLocalDraftThread } = td
  return useCallback(
    (mode: ProviderInteractionMode) => {
      if (mode === interactionMode) return
      setComposerDraftInteractionMode(threadId, mode)
      if (isLocalDraftThread) setDraftThreadContext(threadId, { interactionMode: mode })
      scheduleComposerFocus()
    },
    [
      interactionMode,
      isLocalDraftThread,
      scheduleComposerFocus,
      setComposerDraftInteractionMode,
      setDraftThreadContext,
      threadId,
    ]
  )
}

export function useProviderModeCallbacks(
  threadId: ThreadId,
  store: S,
  ls: L,
  td: T,
  scheduleComposerFocus: () => void
) {
  void ls
  const onProviderModelSelect = useProviderModelSelectCallback(store, td, scheduleComposerFocus)
  const handleRuntimeModeChange = useRuntimeModeChangeCallback(
    threadId,
    store,
    td,
    scheduleComposerFocus
  )
  const handleInteractionModeChange = useInteractionModeChangeCallback(
    threadId,
    store,
    td,
    scheduleComposerFocus
  )

  const toggleInteractionMode = useCallback(() => {
    handleInteractionModeChange(td.interactionMode === 'plan' ? 'default' : 'plan')
  }, [handleInteractionModeChange, td.interactionMode])

  const toggleRuntimeMode = useCallback(() => {
    void handleRuntimeModeChange(
      td.runtimeMode === 'full-access' ? 'approval-required' : 'full-access'
    )
  }, [handleRuntimeModeChange, td.runtimeMode])

  return {
    onProviderModelSelect,
    handleRuntimeModeChange,
    handleInteractionModeChange,
    toggleInteractionMode,
    toggleRuntimeMode,
  }
}
