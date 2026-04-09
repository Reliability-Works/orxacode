/**
 * Zustand action implementations for composerDraftStore — content actions.
 *
 * Covers prompt, terminal contexts, model selection, images, and attachment
 * persistence. Imported by composerDraftStore.ts only.
 *
 * Extraction-only refactor — runtime behavior is preserved exactly.
 */
import {
  type ModelSelection,
  type ProviderKind,
  type ProviderModelOptions,
  type RuntimeMode,
  type ProviderInteractionMode,
  type ThreadId,
  DEFAULT_MODEL_BY_PROVIDER,
} from '@orxa-code/contracts'
import * as Equal from 'effect/Equal'
import {
  ensureInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from './lib/terminalContext'
import {
  normalizeProviderKind,
  normalizeProviderModelOptions,
  normalizeModelSelection,
} from './composerDraftStore.normalize'
import {
  type ComposerDraftStoreState,
  type ComposerThreadDraftState,
  type ComposerImageAttachment,
  type PersistedComposerImageAttachment,
  createEmptyThreadDraft,
  stripModelSelectionOptions,
  normalizeTerminalContextForThread,
  normalizeTerminalContextsForThread,
  composerImageDedupKey,
  revokeObjectPreviewUrl,
  terminalContextDedupKey,
  updateDraftByThreadId,
} from './composerDraftStore.state'

export type SetState = (
  partial:
    | ComposerDraftStoreState
    | Partial<ComposerDraftStoreState>
    | ((
        state: ComposerDraftStoreState
      ) => ComposerDraftStoreState | Partial<ComposerDraftStoreState>),
  replace?: false
) => void

export type GetState = () => ComposerDraftStoreState

/** Builds a Zustand updater that modifies a draft by threadId if it exists. */
function withCurrentDraft(
  set: SetState,
  threadId: ThreadId,
  updater: (
    current: ComposerThreadDraftState,
    state: ComposerDraftStoreState
  ) => Partial<ComposerDraftStoreState> | ComposerDraftStoreState
): void {
  if (threadId.length === 0) return
  set(state => {
    const current = state.draftsByThreadId[threadId]
    if (!current) return state
    return updater(current, state)
  })
}

export function actionSetPrompt(set: SetState, threadId: ThreadId, prompt: string): void {
  if (threadId.length === 0) return
  set(state => {
    const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft()
    return updateDraftByThreadId(state, threadId, { ...existing, prompt })
  })
}

export function actionSetTerminalContexts(
  set: SetState,
  threadId: ThreadId,
  contexts: TerminalContextDraft[]
): void {
  if (threadId.length === 0) return
  const normalizedContexts = normalizeTerminalContextsForThread(threadId, contexts)
  set(state => {
    const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft()
    const nextDraft: ComposerThreadDraftState = {
      ...existing,
      prompt: ensureInlineTerminalContextPlaceholders(existing.prompt, normalizedContexts.length),
      terminalContexts: normalizedContexts,
    }
    return updateDraftByThreadId(state, threadId, nextDraft)
  })
}

export function actionSetModelSelection(
  set: SetState,
  threadId: ThreadId,
  modelSelection: ModelSelection | null | undefined
): void {
  if (threadId.length === 0) return
  const normalized = normalizeModelSelection(modelSelection)
  set(state => {
    const existing = state.draftsByThreadId[threadId]
    if (!existing && normalized === null) return state
    const base = existing ?? createEmptyThreadDraft()
    const nextMap = { ...base.modelSelectionByProvider }
    if (normalized) {
      const current = nextMap[normalized.provider]
      if (normalized.options !== undefined) {
        nextMap[normalized.provider] = normalized
      } else {
        nextMap[normalized.provider] = {
          provider: normalized.provider,
          model: normalized.model,
          ...(current?.options ? { options: current.options } : {}),
        } as ModelSelection
      }
    }
    const nextActiveProvider = normalized?.provider ?? base.activeProvider
    if (
      Equal.equals(base.modelSelectionByProvider, nextMap) &&
      base.activeProvider === nextActiveProvider
    ) {
      return state
    }
    return updateDraftByThreadId(state, threadId, {
      ...base,
      modelSelectionByProvider: nextMap,
      activeProvider: nextActiveProvider,
    })
  })
}

export function actionSetModelOptions(
  set: SetState,
  threadId: ThreadId,
  modelOptions: ProviderModelOptions | null | undefined
): void {
  if (threadId.length === 0) return
  const normalizedOpts = normalizeProviderModelOptions(modelOptions)
  set(state => {
    const existing = state.draftsByThreadId[threadId]
    if (!existing && normalizedOpts === null) return state
    const base = existing ?? createEmptyThreadDraft()
    const nextMap = { ...base.modelSelectionByProvider }
    for (const provider of ['codex', 'claudeAgent', 'opencode'] as const) {
      if (!normalizedOpts || !(provider in normalizedOpts)) continue
      const opts = normalizedOpts[provider]
      const current = nextMap[provider]
      if (opts) {
        nextMap[provider] = {
          provider,
          model: current?.model ?? DEFAULT_MODEL_BY_PROVIDER[provider],
          options: opts,
        } as ModelSelection
      } else if (current?.options) {
        nextMap[provider] = stripModelSelectionOptions(current)
      }
    }
    if (Equal.equals(base.modelSelectionByProvider, nextMap)) return state
    return updateDraftByThreadId(state, threadId, { ...base, modelSelectionByProvider: nextMap })
  })
}

export function actionSetProviderModelOptions(
  set: SetState,
  threadId: ThreadId,
  provider: ProviderKind,
  nextProviderOptions: ProviderModelOptions[ProviderKind] | null | undefined,
  options?: { persistSticky?: boolean }
): void {
  if (threadId.length === 0) return
  const normalizedProvider = normalizeProviderKind(provider)
  if (normalizedProvider === null) return
  const normalizedOpts = normalizeProviderModelOptions(
    { [normalizedProvider]: nextProviderOptions },
    normalizedProvider
  )
  const providerOpts = normalizedOpts?.[normalizedProvider]
  set(state => {
    const existing = state.draftsByThreadId[threadId]
    const base = existing ?? createEmptyThreadDraft()
    const nextMap = { ...base.modelSelectionByProvider }
    const currentForProvider = nextMap[normalizedProvider]
    if (providerOpts) {
      nextMap[normalizedProvider] = {
        provider: normalizedProvider,
        model: currentForProvider?.model ?? DEFAULT_MODEL_BY_PROVIDER[normalizedProvider],
        options: providerOpts,
      } as ModelSelection
    } else if (currentForProvider?.options) {
      nextMap[normalizedProvider] = stripModelSelectionOptions(currentForProvider)
    }
    let nextStickyMap = state.stickyModelSelectionByProvider
    let nextStickyActiveProvider = state.stickyActiveProvider
    if (options?.persistSticky === true) {
      nextStickyMap = buildNextStickyMap(state, base, normalizedProvider, providerOpts)
      nextStickyActiveProvider = base.activeProvider ?? normalizedProvider
    }
    if (
      Equal.equals(base.modelSelectionByProvider, nextMap) &&
      Equal.equals(state.stickyModelSelectionByProvider, nextStickyMap) &&
      state.stickyActiveProvider === nextStickyActiveProvider
    ) {
      return state
    }
    const nextDraft: ComposerThreadDraftState = { ...base, modelSelectionByProvider: nextMap }
    const draftResult = updateDraftByThreadId(state, threadId, nextDraft)
    return {
      ...draftResult,
      ...(options?.persistSticky === true
        ? {
            stickyModelSelectionByProvider: nextStickyMap,
            stickyActiveProvider: nextStickyActiveProvider,
          }
        : {}),
    }
  })
}

function buildNextStickyMap(
  state: ComposerDraftStoreState,
  base: ComposerThreadDraftState,
  normalizedProvider: ProviderKind,
  providerOpts: ProviderModelOptions[ProviderKind] | undefined
): Partial<Record<ProviderKind, ModelSelection>> {
  const nextStickyMap = { ...state.stickyModelSelectionByProvider }
  const stickyBase =
    nextStickyMap[normalizedProvider] ??
    base.modelSelectionByProvider[normalizedProvider] ??
    ({
      provider: normalizedProvider,
      model: DEFAULT_MODEL_BY_PROVIDER[normalizedProvider],
    } as ModelSelection)
  if (providerOpts) {
    nextStickyMap[normalizedProvider] = {
      ...stickyBase,
      provider: normalizedProvider,
      options: providerOpts,
    } as ModelSelection
  } else if (stickyBase.options) {
    nextStickyMap[normalizedProvider] = stripModelSelectionOptions(stickyBase)
  }
  return nextStickyMap
}

export function actionSetRuntimeMode(
  set: SetState,
  threadId: ThreadId,
  runtimeMode: RuntimeMode | null | undefined
): void {
  if (threadId.length === 0) return
  const nextRuntimeMode =
    runtimeMode === 'approval-required' || runtimeMode === 'full-access' ? runtimeMode : null
  set(state => {
    const existing = state.draftsByThreadId[threadId]
    if (!existing && nextRuntimeMode === null) return state
    const base = existing ?? createEmptyThreadDraft()
    if (base.runtimeMode === nextRuntimeMode) return state
    return updateDraftByThreadId(state, threadId, { ...base, runtimeMode: nextRuntimeMode })
  })
}

export function actionSetInteractionMode(
  set: SetState,
  threadId: ThreadId,
  interactionMode: ProviderInteractionMode | null | undefined
): void {
  if (threadId.length === 0) return
  const nextInteractionMode =
    interactionMode === 'plan' || interactionMode === 'default' ? interactionMode : null
  set(state => {
    const existing = state.draftsByThreadId[threadId]
    if (!existing && nextInteractionMode === null) return state
    const base = existing ?? createEmptyThreadDraft()
    if (base.interactionMode === nextInteractionMode) return state
    return updateDraftByThreadId(state, threadId, {
      ...base,
      interactionMode: nextInteractionMode,
    })
  })
}

export function actionAddImages(
  set: SetState,
  threadId: ThreadId,
  images: ComposerImageAttachment[]
): void {
  if (threadId.length === 0 || images.length === 0) return
  set(state => {
    const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft()
    const existingIds = new Set(existing.images.map(image => image.id))
    const existingDedupKeys = new Set(existing.images.map(image => composerImageDedupKey(image)))
    const acceptedPreviewUrls = new Set(existing.images.map(image => image.previewUrl))
    const dedupedIncoming: ComposerImageAttachment[] = []
    for (const image of images) {
      const dedupKey = composerImageDedupKey(image)
      if (existingIds.has(image.id) || existingDedupKeys.has(dedupKey)) {
        if (!acceptedPreviewUrls.has(image.previewUrl)) {
          revokeObjectPreviewUrl(image.previewUrl)
        }
        continue
      }
      dedupedIncoming.push(image)
      existingIds.add(image.id)
      existingDedupKeys.add(dedupKey)
      acceptedPreviewUrls.add(image.previewUrl)
    }
    if (dedupedIncoming.length === 0) return state
    return {
      draftsByThreadId: {
        ...state.draftsByThreadId,
        [threadId]: {
          ...existing,
          images: [...existing.images, ...dedupedIncoming],
        },
      },
    }
  })
}

export function actionRemoveImage(
  set: SetState,
  get: GetState,
  threadId: ThreadId,
  imageId: string
): void {
  if (threadId.length === 0) return
  const existing = get().draftsByThreadId[threadId]
  if (!existing) return
  const removedImage = existing.images.find(image => image.id === imageId)
  if (removedImage) revokeObjectPreviewUrl(removedImage.previewUrl)
  set(state => {
    const current = state.draftsByThreadId[threadId]
    if (!current) return state
    const nextDraft: ComposerThreadDraftState = {
      ...current,
      images: current.images.filter(image => image.id !== imageId),
      nonPersistedImageIds: current.nonPersistedImageIds.filter(id => id !== imageId),
      persistedAttachments: current.persistedAttachments.filter(
        attachment => attachment.id !== imageId
      ),
    }
    return updateDraftByThreadId(state, threadId, nextDraft)
  })
}

export function actionInsertTerminalContext(
  set: SetState,
  threadId: ThreadId,
  prompt: string,
  context: TerminalContextDraft,
  index: number
): boolean {
  if (threadId.length === 0) return false
  let inserted = false
  set(state => {
    const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft()
    const normalizedContext = normalizeTerminalContextForThread(threadId, context)
    if (!normalizedContext) return state
    const dedupKey = terminalContextDedupKey(normalizedContext)
    if (
      existing.terminalContexts.some(entry => entry.id === normalizedContext.id) ||
      existing.terminalContexts.some(entry => terminalContextDedupKey(entry) === dedupKey)
    ) {
      return state
    }
    inserted = true
    const boundedIndex = Math.max(0, Math.min(existing.terminalContexts.length, index))
    const nextDraft: ComposerThreadDraftState = {
      ...existing,
      prompt,
      terminalContexts: [
        ...existing.terminalContexts.slice(0, boundedIndex),
        normalizedContext,
        ...existing.terminalContexts.slice(boundedIndex),
      ],
    }
    return {
      draftsByThreadId: {
        ...state.draftsByThreadId,
        [threadId]: nextDraft,
      },
    }
  })
  return inserted
}

export function actionAddTerminalContexts(
  set: SetState,
  threadId: ThreadId,
  contexts: TerminalContextDraft[]
): void {
  if (threadId.length === 0 || contexts.length === 0) return
  set(state => {
    const existing = state.draftsByThreadId[threadId] ?? createEmptyThreadDraft()
    const acceptedContexts = normalizeTerminalContextsForThread(threadId, [
      ...existing.terminalContexts,
      ...contexts,
    ]).slice(existing.terminalContexts.length)
    if (acceptedContexts.length === 0) return state
    return {
      draftsByThreadId: {
        ...state.draftsByThreadId,
        [threadId]: {
          ...existing,
          prompt: ensureInlineTerminalContextPlaceholders(
            existing.prompt,
            existing.terminalContexts.length + acceptedContexts.length
          ),
          terminalContexts: [...existing.terminalContexts, ...acceptedContexts],
        },
      },
    }
  })
}

export function actionRemoveTerminalContext(
  set: SetState,
  threadId: ThreadId,
  contextId: string
): void {
  if (threadId.length === 0 || contextId.length === 0) return
  set(state => {
    const current = state.draftsByThreadId[threadId]
    if (!current) return state
    const nextDraft: ComposerThreadDraftState = {
      ...current,
      terminalContexts: current.terminalContexts.filter(context => context.id !== contextId),
    }
    return updateDraftByThreadId(state, threadId, nextDraft)
  })
}

export function actionClearTerminalContexts(set: SetState, threadId: ThreadId): void {
  if (threadId.length === 0) return
  set(state => {
    const current = state.draftsByThreadId[threadId]
    if (!current || current.terminalContexts.length === 0) return state
    return updateDraftByThreadId(state, threadId, { ...current, terminalContexts: [] })
  })
}

export function actionClearPersistedAttachments(set: SetState, threadId: ThreadId): void {
  withCurrentDraft(set, threadId, (current, state) =>
    updateDraftByThreadId(state, threadId, {
      ...current,
      persistedAttachments: [],
      nonPersistedImageIds: [],
    })
  )
}

export function actionSyncPersistedAttachments(
  set: SetState,
  threadId: ThreadId,
  attachments: PersistedComposerImageAttachment[],
  verifyFn: (
    threadId: ThreadId,
    attachments: PersistedComposerImageAttachment[],
    set: SetState
  ) => void
): void {
  if (threadId.length === 0) return
  const attachmentIdSet = new Set(attachments.map(attachment => attachment.id))
  set(state => {
    const current = state.draftsByThreadId[threadId]
    if (!current) return state
    const nextDraft: ComposerThreadDraftState = {
      ...current,
      persistedAttachments: attachments,
      nonPersistedImageIds: current.nonPersistedImageIds.filter(id => !attachmentIdSet.has(id)),
    }
    return updateDraftByThreadId(state, threadId, nextDraft)
  })
  Promise.resolve().then(() => {
    verifyFn(threadId, attachments, set)
  })
}

export function actionClearComposerContent(set: SetState, threadId: ThreadId): void {
  withCurrentDraft(set, threadId, (current, state) =>
    updateDraftByThreadId(state, threadId, {
      ...current,
      prompt: '',
      images: [],
      nonPersistedImageIds: [],
      persistedAttachments: [],
      terminalContexts: [],
    })
  )
}
