/**
 * Derives active thread, model selection, provider, and phase state for ChatView.
 */

import { useMemo } from 'react'
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSelection,
  type ProviderKind,
  type ThreadId,
  type ServerProvider,
} from '@orxa-code/contracts'
import { useEffectiveComposerModelState } from '../../composerDraftStore'
import { buildLocalDraftThread, threadHasStarted } from '../ChatView.logic'
import { derivePhase } from '../../session-logic'
import { getComposerProviderState } from './composerProviderRegistry'
import { getProviderModels, resolveSelectableProvider } from '../../providerModels'
import { normalizeModelSlug } from '@orxa-code/shared/model'
import { useProjectById } from '../../storeSelectors'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { Thread } from '../../types'

const EMPTY_PROVIDERS: ServerProvider[] = []
const DEFAULT_RUNTIME_MODE = 'full-access' as const
const DEFAULT_INTERACTION_MODE = 'default' as const
const FALLBACK_MODEL_SELECTION = {
  provider: 'codex' as ProviderKind,
  model: DEFAULT_MODEL_BY_PROVIDER.codex,
}

type StoreSelectors = ReturnType<typeof useChatViewStoreSelectors>
type LocalState = ReturnType<typeof useChatViewLocalState>

function pickLockedProvider(
  thread: Thread | undefined,
  selectedByUser: ProviderKind | null,
  activeProject: { defaultModelSelection?: { provider?: ProviderKind } | null } | null | undefined
): ProviderKind | null {
  if (!threadHasStarted(thread)) return null
  const sessionProv = thread?.session?.provider ?? null
  const threadProv =
    thread?.modelSelection.provider ?? activeProject?.defaultModelSelection?.provider ?? null
  return sessionProv ?? threadProv ?? selectedByUser ?? null
}

function pickSelectedProvider(
  locked: ProviderKind | null,
  statuses: ServerProvider[],
  selectedByUser: ProviderKind | null,
  thread: Thread | undefined,
  activeProject: { defaultModelSelection?: { provider?: ProviderKind } | null } | null | undefined
): ProviderKind {
  if (locked) return locked
  const threadProv =
    thread?.modelSelection.provider ?? activeProject?.defaultModelSelection?.provider ?? null
  return resolveSelectableProvider(statuses, selectedByUser ?? threadProv ?? 'codex')
}

function buildSelectedModelSelection(
  provider: ProviderKind,
  model: string,
  options: Record<string, unknown> | null | undefined
): ModelSelection {
  return { provider, model, ...(options ? { options } : {}) }
}

function deriveThreadModes(
  composerDraft: { runtimeMode?: string | null; interactionMode?: string | null },
  thread: Thread | undefined
) {
  const runtimeMode = composerDraft.runtimeMode ?? thread?.runtimeMode ?? DEFAULT_RUNTIME_MODE
  const interactionMode =
    composerDraft.interactionMode ?? thread?.interactionMode ?? DEFAULT_INTERACTION_MODE
  return {
    runtimeMode: runtimeMode as 'full-access' | 'approval-required',
    interactionMode: interactionMode as 'default' | 'plan',
  }
}

function buildModelOptionsByProvider(statuses: ServerProvider[]) {
  return {
    codex: statuses.find(p => p.provider === 'codex')?.models ?? [],
    claudeAgent: statuses.find(p => p.provider === 'claudeAgent')?.models ?? [],
  }
}

function pickModelForPicker(
  opts: Array<{ slug: string }>,
  model: string,
  provider: ProviderKind
): string {
  if (opts.some(o => o.slug === model)) return model
  return normalizeModelSlug(model, provider) ?? model
}

function useProviderSelection(params: {
  threadId: ThreadId
  activeThread: Thread | undefined
  activeProject: ReturnType<typeof useProjectById>
  providerStatuses: readonly ServerProvider[]
  composerDraft: StoreSelectors['composerDraft']
  settings: StoreSelectors['settings']
}) {
  const { threadId, activeThread, activeProject, providerStatuses, composerDraft, settings } =
    params
  const selectedProviderByThreadId = composerDraft.activeProvider ?? null
  const lockedProvider = pickLockedProvider(activeThread, selectedProviderByThreadId, activeProject)
  const selectedProvider = pickSelectedProvider(
    lockedProvider,
    [...providerStatuses],
    selectedProviderByThreadId,
    activeThread,
    activeProject
  )
  const { modelOptions: composerModelOptions, selectedModel } = useEffectiveComposerModelState({
    threadId,
    providers: providerStatuses,
    selectedProvider,
    threadModelSelection: activeThread?.modelSelection,
    projectModelSelection: activeProject?.defaultModelSelection,
    settings,
  })
  const selectedProviderModels = getProviderModels(providerStatuses, selectedProvider)
  return {
    lockedProvider,
    selectedProvider,
    composerModelOptions,
    selectedModel,
    selectedProviderModels,
  }
}

function useProviderDerivedMemos(params: {
  providerStatuses: readonly ServerProvider[]
  selectedProvider: ProviderKind
  selectedModel: string
  selectedProviderModels: ReturnType<typeof getProviderModels>
  composerDraft: StoreSelectors['composerDraft']
  composerModelOptions: ReturnType<typeof useEffectiveComposerModelState>['modelOptions']
}) {
  const {
    providerStatuses,
    selectedProvider,
    selectedModel,
    selectedProviderModels,
    composerDraft,
    composerModelOptions,
  } = params
  const composerProviderState = useMemo(
    () =>
      getComposerProviderState({
        provider: selectedProvider,
        model: selectedModel,
        models: selectedProviderModels,
        prompt: composerDraft.prompt,
        modelOptions: composerModelOptions,
      }),
    [
      composerModelOptions,
      composerDraft.prompt,
      selectedModel,
      selectedProvider,
      selectedProviderModels,
    ]
  )
  const selectedModelSelection = useMemo(
    () =>
      buildSelectedModelSelection(
        selectedProvider,
        selectedModel,
        composerProviderState.modelOptionsForDispatch
      ),
    [composerProviderState.modelOptionsForDispatch, selectedModel, selectedProvider]
  )
  const modelOptionsByProvider = useMemo(
    () => buildModelOptionsByProvider([...providerStatuses]),
    [providerStatuses]
  )
  const selectedModelForPickerWithCustomFallback = useMemo(
    () =>
      pickModelForPicker(
        [...(modelOptionsByProvider[selectedProvider] ?? [])],
        selectedModel,
        selectedProvider
      ),
    [modelOptionsByProvider, selectedModel, selectedProvider]
  )
  const activeProviderStatus = useMemo(
    () => providerStatuses.find(s => s.provider === selectedProvider) ?? null,
    [providerStatuses, selectedProvider]
  )
  return {
    composerProviderState,
    selectedModelSelection,
    modelOptionsByProvider,
    selectedModelForPickerWithCustomFallback,
    activeProviderStatus,
  }
}

function useDerivedProviderAndModel(params: {
  threadId: ThreadId
  activeThread: Thread | undefined
  activeProject: ReturnType<typeof useProjectById>
  providerStatuses: readonly ServerProvider[]
  composerDraft: StoreSelectors['composerDraft']
  settings: StoreSelectors['settings']
}) {
  const selection = useProviderSelection(params)
  const memos = useProviderDerivedMemos({
    providerStatuses: params.providerStatuses,
    selectedProvider: selection.selectedProvider,
    selectedModel: selection.selectedModel,
    selectedProviderModels: selection.selectedProviderModels,
    composerDraft: params.composerDraft,
    composerModelOptions: selection.composerModelOptions,
  })
  return { ...selection, ...memos }
}

export function useChatViewDerivedThread(
  threadId: ThreadId,
  store: StoreSelectors,
  ls: LocalState
) {
  const {
    serverThread,
    settings,
    composerDraft,
    draftThread,
    fallbackDraftProject,
    rawSearch,
    serverConfig,
  } = store
  const localDraftError = serverThread ? null : (ls.localDraftErrorsByThreadId[threadId] ?? null)

  const localDraftThread = useMemo(
    () =>
      draftThread
        ? buildLocalDraftThread(
            threadId,
            draftThread,
            fallbackDraftProject?.defaultModelSelection ?? FALLBACK_MODEL_SELECTION,
            localDraftError
          )
        : undefined,
    [draftThread, fallbackDraftProject?.defaultModelSelection, localDraftError, threadId]
  )

  const activeThread = serverThread ?? localDraftThread
  const activeProject = useProjectById(activeThread?.projectId ?? null)
  const providerStatuses = serverConfig?.providers ?? EMPTY_PROVIDERS
  const providerAndModel = useDerivedProviderAndModel({
    threadId,
    activeThread,
    activeProject,
    providerStatuses,
    composerDraft,
    settings,
  })
  const { runtimeMode, interactionMode } = deriveThreadModes(composerDraft, activeThread)
  const isServerThread = serverThread !== undefined
  const isLocalDraftThread = !isServerThread && localDraftThread !== undefined

  return {
    localDraftThread,
    activeThread,
    activeProject,
    providerStatuses,
    ...providerAndModel,
    selectedPromptEffort: providerAndModel.composerProviderState.promptEffort,
    runtimeMode,
    interactionMode,
    isServerThread,
    isLocalDraftThread,
    canCheckoutPullRequestIntoThread: isLocalDraftThread,
    diffOpen: rawSearch.diff === '1',
    activeThreadId: activeThread?.id ?? null,
    activeLatestTurn: activeThread?.latestTurn ?? null,
    phase: derivePhase(activeThread?.session ?? null),
  }
}
