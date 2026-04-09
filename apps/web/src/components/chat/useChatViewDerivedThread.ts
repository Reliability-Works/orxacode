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
import { buildLocalDraftThread } from '../ChatView.logic'
import { derivePhase } from '../../session-logic'
import { getComposerProviderState } from './composerProviderRegistry'
import { getProviderModels, resolveSelectableProvider } from '../../providerModels'
import { normalizeModelSlug } from '@orxa-code/shared/model'
import { useProjectById } from '../../storeSelectors'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { Thread } from '../../types'
import { filterHiddenOpencodeModels } from '../../opencodeModelGroups'

const EMPTY_PROVIDERS: ServerProvider[] = []
const DEFAULT_RUNTIME_MODE = 'full-access' as const
const DEFAULT_INTERACTION_MODE = 'default' as const
const FALLBACK_MODEL_SELECTION = {
  provider: 'codex' as ProviderKind,
  model: DEFAULT_MODEL_BY_PROVIDER.codex,
}

type StoreSelectors = ReturnType<typeof useChatViewStoreSelectors>
type LocalState = ReturnType<typeof useChatViewLocalState>

/** @internal exported for unit testing only */
export function pickLockedProvider(
  thread: Thread | undefined,
  selectedByUser: ProviderKind | null,
  activeProject: { defaultModelSelection?: { provider?: ProviderKind } | null } | null | undefined
): ProviderKind | null {
  // Sessions are always created with an explicit provider via the NewSessionModal,
  // so the composer model picker is model-only — lock as soon as any provider is known.
  const sessionProv = thread?.session?.provider ?? null
  const threadProv = thread?.modelSelection.provider ?? null
  const projectProv = activeProject?.defaultModelSelection?.provider ?? null
  return sessionProv ?? threadProv ?? projectProv ?? selectedByUser ?? null
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
  options: Record<string, unknown> | null | undefined,
  opencodeExtras?: { agentId?: string; variant?: string } | null
): ModelSelection {
  const base = { provider, model, ...(options ? { options } : {}) }
  if (provider === 'opencode' && opencodeExtras) {
    return {
      ...base,
      ...(opencodeExtras.agentId ? { agentId: opencodeExtras.agentId } : {}),
      ...(opencodeExtras.variant ? { variant: opencodeExtras.variant } : {}),
    } as ModelSelection
  }
  return base as ModelSelection
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

type ProviderModelList = ReadonlyArray<ServerProvider['models'][number]>
type ModelOptionsByProvider = Record<ProviderKind, ProviderModelList>

function findProviderModels(statuses: ServerProvider[], kind: ProviderKind): ProviderModelList {
  return statuses.find(p => p.provider === kind)?.models ?? []
}

function buildProviderEntry(statuses: ServerProvider[], kind: ProviderKind): ProviderModelList {
  switch (kind) {
    case 'codex':
      return findProviderModels(statuses, 'codex')
    case 'claudeAgent':
      return findProviderModels(statuses, 'claudeAgent')
    case 'opencode':
      return findProviderModels(statuses, 'opencode')
    default: {
      // Exhaustive check — TypeScript narrows kind to never here.
      // If a new ProviderKind is added without updating this switch,
      // the assignment below fails at compile time.
      const _exhaustive: never = kind
      void _exhaustive
      return []
    }
  }
}

/** @internal exported for unit testing only */
export function buildModelOptionsByProvider(
  statuses: ServerProvider[],
  opencodeHiddenModelSlugs: ReadonlyArray<string> = []
): ModelOptionsByProvider {
  return {
    codex: buildProviderEntry(statuses, 'codex'),
    claudeAgent: buildProviderEntry(statuses, 'claudeAgent'),
    opencode: filterHiddenOpencodeModels(
      buildProviderEntry(statuses, 'opencode'),
      opencodeHiddenModelSlugs
    ),
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

function useOpencodeExtras(
  selectedProvider: ProviderKind,
  modelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>,
  isPlanMode: boolean
): { agentId?: string; variant?: string } | null {
  return useMemo(() => {
    if (selectedProvider !== 'opencode') return null
    const selection = modelSelectionByProvider.opencode
    if (!selection || selection.provider !== 'opencode') return null
    // In plan mode we deliberately drop agentId so the server's resolver
    // falls back to the opencode `plan` primary agent. The user can still
    // have an agent selected — plan mode is a transient override.
    const agentId = isPlanMode ? undefined : selection.agentId
    return {
      ...(agentId ? { agentId } : {}),
      ...(selection.variant ? { variant: selection.variant } : {}),
    }
  }, [isPlanMode, modelSelectionByProvider, selectedProvider])
}

function useSelectedModelSelectionMemo(input: {
  selectedProvider: ProviderKind
  selectedModel: string
  modelOptionsForDispatch: ReturnType<typeof getComposerProviderState>['modelOptionsForDispatch']
  opencodeExtras: { agentId?: string; variant?: string } | null
}) {
  return useMemo(
    () =>
      buildSelectedModelSelection(
        input.selectedProvider,
        input.selectedModel,
        input.modelOptionsForDispatch,
        input.opencodeExtras
      ),
    [
      input.modelOptionsForDispatch,
      input.opencodeExtras,
      input.selectedModel,
      input.selectedProvider,
    ]
  )
}

function useProviderPickerDerived(input: {
  providerStatuses: readonly ServerProvider[]
  opencodeHiddenModelSlugs: ReadonlyArray<string>
  selectedProvider: ProviderKind
  selectedModel: string
}) {
  const modelOptionsByProvider = useMemo(
    () => buildModelOptionsByProvider([...input.providerStatuses], input.opencodeHiddenModelSlugs),
    [input.opencodeHiddenModelSlugs, input.providerStatuses]
  )
  const selectedModelForPickerWithCustomFallback = useMemo(
    () =>
      pickModelForPicker(
        [...(modelOptionsByProvider[input.selectedProvider] ?? [])],
        input.selectedModel,
        input.selectedProvider
      ),
    [input.selectedModel, input.selectedProvider, modelOptionsByProvider]
  )
  const activeProviderStatus = useMemo(
    () => input.providerStatuses.find(s => s.provider === input.selectedProvider) ?? null,
    [input.providerStatuses, input.selectedProvider]
  )
  return { modelOptionsByProvider, selectedModelForPickerWithCustomFallback, activeProviderStatus }
}

function useProviderDerivedMemos(params: {
  providerStatuses: readonly ServerProvider[]
  opencodeHiddenModelSlugs: ReadonlyArray<string>
  selectedProvider: ProviderKind
  selectedModel: string
  selectedProviderModels: ReturnType<typeof getProviderModels>
  composerDraft: StoreSelectors['composerDraft']
  composerModelOptions: ReturnType<typeof useEffectiveComposerModelState>['modelOptions']
  isOpencodePlanMode: boolean
}) {
  const {
    providerStatuses,
    opencodeHiddenModelSlugs,
    selectedProvider,
    selectedModel,
    selectedProviderModels,
    composerDraft,
    composerModelOptions,
    isOpencodePlanMode,
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
  const opencodeExtras = useOpencodeExtras(
    selectedProvider,
    composerDraft.modelSelectionByProvider,
    isOpencodePlanMode
  )
  const selectedModelSelection = useSelectedModelSelectionMemo({
    selectedProvider,
    selectedModel,
    modelOptionsForDispatch: composerProviderState.modelOptionsForDispatch,
    opencodeExtras,
  })
  const { modelOptionsByProvider, selectedModelForPickerWithCustomFallback, activeProviderStatus } =
    useProviderPickerDerived({
      providerStatuses,
      opencodeHiddenModelSlugs,
      selectedProvider,
      selectedModel,
    })
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
  const { interactionMode } = deriveThreadModes(params.composerDraft, params.activeThread)
  const isOpencodePlanMode = selection.selectedProvider === 'opencode' && interactionMode === 'plan'
  const memos = useProviderDerivedMemos({
    providerStatuses: params.providerStatuses,
    opencodeHiddenModelSlugs: params.settings.providers.opencode.hiddenModelSlugs,
    selectedProvider: selection.selectedProvider,
    selectedModel: selection.selectedModel,
    selectedProviderModels: selection.selectedProviderModels,
    composerDraft: params.composerDraft,
    composerModelOptions: selection.composerModelOptions,
    isOpencodePlanMode,
  })
  return { ...selection, ...memos }
}

export function useChatViewDerivedThread(
  threadId: ThreadId,
  store: StoreSelectors,
  ls: LocalState
) {
  const { serverThread, settings, composerDraft, draftThread, fallbackDraftProject, serverConfig } =
    store
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
    activeThreadId: activeThread?.id ?? null,
    activeLatestTurn: activeThread?.latestTurn ?? null,
    phase: derivePhase(activeThread?.session ?? null),
  }
}
