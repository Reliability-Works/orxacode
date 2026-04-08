/**
 * Composer draft Zustand store.
 *
 * Persistence logic (normalize/migrate) lives in composerDraftStore.migrate.ts
 * and composerDraftStore.normalize.ts.
 * State types and pure helpers live in composerDraftStore.state.ts.
 * Action implementations live in composerDraftStore.actions.ts and
 * composerDraftStore.actions.content.ts.
 */
import {
  type ModelSelection,
  type ProviderKind,
  type ServerProvider,
  type ThreadId,
} from '@orxa-code/contracts'
import { useMemo } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { type DeepMutable } from 'effect/Types'
import * as Schema from 'effect/Schema'
import { normalizeModelSlug } from '@orxa-code/shared/model'
import { getLocalStorageItem } from './hooks/useLocalStorage'
import { resolveAppModelSelection } from './modelSelection'
import { getDefaultServerModel } from './providerModels'
import { UnifiedSettings } from '@orxa-code/contracts/settings'
import { createDebouncedStorage, createMemoryStorage } from './lib/storage'
import {
  type PersistedComposerDraftStoreState,
  type PersistedComposerThreadDraftState,
  migratePersistedComposerDraftStoreState,
  normalizeCurrentPersistedComposerDraftStoreState,
} from './composerDraftStore.migrate'
import { normalizeProviderKind } from './composerDraftStore.normalize'
import {
  type ComposerDraftStoreState,
  type ComposerThreadDraftState,
  type ComposerImageAttachment,
  type PersistedComposerImageAttachment,
  type DraftThreadState,
  type DraftThreadEnvMode,
  type ProviderModelOptions,
  createEmptyThreadDraft,
  shouldRemoveDraft,
} from './composerDraftStore.state'
import {
  actionGetDraftThreadByProjectId,
  actionGetDraftThread,
  actionSetProjectDraftThreadId,
  actionSetDraftThreadContext,
  actionClearProjectDraftThreadId,
  actionClearProjectDraftThreadById,
  actionClearDraftThread,
  actionSetStickyModelSelection,
  actionApplyStickyState,
  type SetState,
} from './composerDraftStore.actions'
import {
  actionSetPrompt,
  actionSetTerminalContexts,
  actionSetModelSelection,
  actionSetModelOptions,
  actionSetProviderModelOptions,
  actionSetRuntimeMode,
  actionSetInteractionMode,
  actionAddImages,
  actionRemoveImage,
  actionInsertTerminalContext,
  actionAddTerminalContexts,
  actionRemoveTerminalContext,
  actionClearTerminalContexts,
  actionClearPersistedAttachments,
  actionSyncPersistedAttachments,
  actionClearComposerContent,
} from './composerDraftStore.actions.content'

export { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from './composerDraftStore.state'
export type {
  ComposerImageAttachment,
  ComposerThreadDraftState,
  DraftThreadState,
  DraftThreadEnvMode,
  PersistedComposerImageAttachment,
}

export const COMPOSER_DRAFT_STORAGE_KEY = 'orxa:composer-drafts:v1'
const COMPOSER_DRAFT_STORAGE_VERSION = 3
const COMPOSER_PERSIST_DEBOUNCE_MS = 300

const PersistedAttachmentSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  mimeType: Schema.String,
  sizeBytes: Schema.Number,
  dataUrl: Schema.String,
})
const PersistedComposerDraftStoreStorage = Schema.Struct({
  version: Schema.Number,
  state: Schema.Struct({
    draftsByThreadId: Schema.Record(
      Schema.String,
      Schema.Struct({ attachments: Schema.Array(PersistedAttachmentSchema) })
    ),
  }),
})

const composerDebouncedStorage = createDebouncedStorage(
  typeof localStorage !== 'undefined' ? localStorage : createMemoryStorage(),
  COMPOSER_PERSIST_DEBOUNCE_MS
)

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    composerDebouncedStorage.flush()
  })
}

export interface EffectiveComposerModelState {
  selectedModel: string
  modelOptions: ProviderModelOptions | null
}

function hydreatePersistedComposerImageAttachment(
  attachment: PersistedComposerImageAttachment
): File | null {
  const commaIndex = attachment.dataUrl.indexOf(',')
  const header = commaIndex === -1 ? attachment.dataUrl : attachment.dataUrl.slice(0, commaIndex)
  const payload = commaIndex === -1 ? '' : attachment.dataUrl.slice(commaIndex + 1)
  if (payload.length === 0) return null
  try {
    const isBase64 = header.includes(';base64')
    if (!isBase64) {
      const decodedText = decodeURIComponent(payload)
      const inferredMimeType =
        header.startsWith('data:') && header.includes(';')
          ? header.slice('data:'.length, header.indexOf(';'))
          : attachment.mimeType
      return new File([decodedText], attachment.name, {
        type: inferredMimeType || attachment.mimeType,
      })
    }
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return new File([bytes], attachment.name, { type: attachment.mimeType })
  } catch {
    return null
  }
}

function hydrateImagesFromPersisted(
  attachments: ReadonlyArray<PersistedComposerImageAttachment>
): ComposerImageAttachment[] {
  return attachments.flatMap(attachment => {
    const file = hydreatePersistedComposerImageAttachment(attachment)
    if (!file) return []
    return [
      {
        type: 'image' as const,
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        previewUrl: attachment.dataUrl,
        file,
      } satisfies ComposerImageAttachment,
    ]
  })
}

function toHydratedThreadDraft(
  persistedDraft: PersistedComposerThreadDraftState
): ComposerThreadDraftState {
  const modelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>> =
    persistedDraft.modelSelectionByProvider ?? {}
  const activeProvider = normalizeProviderKind(persistedDraft.activeProvider) ?? null
  return {
    prompt: persistedDraft.prompt,
    images: hydrateImagesFromPersisted(persistedDraft.attachments),
    nonPersistedImageIds: [],
    persistedAttachments: [...persistedDraft.attachments],
    terminalContexts: (persistedDraft.terminalContexts?.map(context => ({
      ...context,
      text: '',
    })) ?? []) as ReturnType<typeof createEmptyThreadDraft>['terminalContexts'],
    modelSelectionByProvider,
    activeProvider,
    runtimeMode: persistedDraft.runtimeMode ?? null,
    interactionMode: persistedDraft.interactionMode ?? null,
  }
}

// ── Persist helpers ──────────────────────────────────────────────────

function partializeComposerDraftStoreState(
  state: ComposerDraftStoreState
): PersistedComposerDraftStoreState {
  const persistedDraftsByThreadId: DeepMutable<
    PersistedComposerDraftStoreState['draftsByThreadId']
  > = {}
  for (const [threadId, draft] of Object.entries(state.draftsByThreadId)) {
    if (typeof threadId !== 'string' || threadId.length === 0) continue
    const hasModelData =
      Object.keys(draft.modelSelectionByProvider).length > 0 || draft.activeProvider !== null
    if (
      draft.prompt.length === 0 &&
      draft.persistedAttachments.length === 0 &&
      draft.terminalContexts.length === 0 &&
      !hasModelData &&
      draft.runtimeMode === null &&
      draft.interactionMode === null
    ) {
      continue
    }
    persistedDraftsByThreadId[threadId as Parameters<typeof String>[0]] = {
      prompt: draft.prompt,
      attachments: draft.persistedAttachments,
      ...(draft.terminalContexts.length > 0
        ? {
            terminalContexts: draft.terminalContexts.map(context => ({
              id: context.id,
              threadId: context.threadId,
              createdAt: context.createdAt,
              terminalId: context.terminalId,
              terminalLabel: context.terminalLabel,
              lineStart: context.lineStart,
              lineEnd: context.lineEnd,
            })),
          }
        : {}),
      ...(hasModelData
        ? {
            modelSelectionByProvider: draft.modelSelectionByProvider,
            activeProvider: draft.activeProvider,
          }
        : {}),
      ...(draft.runtimeMode ? { runtimeMode: draft.runtimeMode } : {}),
      ...(draft.interactionMode ? { interactionMode: draft.interactionMode } : {}),
    }
  }
  return {
    draftsByThreadId: persistedDraftsByThreadId,
    draftThreadsByThreadId: state.draftThreadsByThreadId,
    projectDraftThreadIdByProjectId: state.projectDraftThreadIdByProjectId,
    stickyModelSelectionByProvider: state.stickyModelSelectionByProvider,
    stickyActiveProvider: state.stickyActiveProvider,
  }
}

function readPersistedAttachmentIdsFromStorage(threadId: ThreadId): string[] {
  if (threadId.length === 0) return []
  try {
    const persisted = getLocalStorageItem(
      COMPOSER_DRAFT_STORAGE_KEY,
      PersistedComposerDraftStoreStorage
    )
    if (!persisted || persisted.version !== COMPOSER_DRAFT_STORAGE_VERSION) return []
    return (persisted.state.draftsByThreadId[threadId]?.attachments ?? []).map(
      attachment => attachment.id
    )
  } catch {
    return []
  }
}

function verifyPersistedAttachments(
  threadId: ThreadId,
  attachments: PersistedComposerImageAttachment[],
  set: SetState
): void {
  let persistedIdSet = new Set<string>()
  try {
    composerDebouncedStorage.flush()
    persistedIdSet = new Set(readPersistedAttachmentIdsFromStorage(threadId))
  } catch {
    persistedIdSet = new Set()
  }
  set(state => {
    const current = state.draftsByThreadId[threadId]
    if (!current) return state
    const imageIdSet = new Set(current.images.map(image => image.id))
    const persistedAttachments = attachments.filter(
      attachment => imageIdSet.has(attachment.id) && persistedIdSet.has(attachment.id)
    )
    const nonPersistedImageIds = current.images
      .map(image => image.id)
      .filter(imageId => !persistedIdSet.has(imageId))
    const nextDraft: ComposerThreadDraftState = {
      ...current,
      persistedAttachments,
      nonPersistedImageIds,
    }
    const nextDraftsByThreadId = { ...state.draftsByThreadId }
    if (shouldRemoveDraft(nextDraft)) {
      delete nextDraftsByThreadId[threadId]
    } else {
      nextDraftsByThreadId[threadId] = nextDraft
    }
    return { draftsByThreadId: nextDraftsByThreadId }
  })
}

// ── Model state derivation ───────────────────────────────────────────

function providerModelOptionsFromSelection(
  modelSelection: ModelSelection | null | undefined
): ProviderModelOptions | null {
  if (!modelSelection?.options) return null
  return { [modelSelection.provider]: modelSelection.options }
}

function modelSelectionByProviderToOptions(
  map: Partial<Record<ProviderKind, ModelSelection>> | null | undefined
): ProviderModelOptions | null {
  if (!map) return null
  const result: Record<string, unknown> = {}
  for (const [provider, selection] of Object.entries(map)) {
    if (selection?.options) result[provider] = selection.options
  }
  return Object.keys(result).length > 0 ? (result as ProviderModelOptions) : null
}

export function deriveEffectiveComposerModelState(input: {
  draft:
    | Pick<ComposerThreadDraftState, 'modelSelectionByProvider' | 'activeProvider'>
    | null
    | undefined
  providers: ReadonlyArray<ServerProvider>
  selectedProvider: ProviderKind
  threadModelSelection: ModelSelection | null | undefined
  projectModelSelection: ModelSelection | null | undefined
  settings: UnifiedSettings
}): EffectiveComposerModelState {
  const baseModel =
    normalizeModelSlug(
      input.threadModelSelection?.model ?? input.projectModelSelection?.model,
      input.selectedProvider
    ) ?? getDefaultServerModel(input.providers, input.selectedProvider)
  const activeSelection = input.draft?.modelSelectionByProvider?.[input.selectedProvider]
  const selectedModel = activeSelection?.model
    ? resolveAppModelSelection(
        input.selectedProvider,
        input.settings,
        input.providers,
        activeSelection.model
      )
    : baseModel
  const modelOptions =
    modelSelectionByProviderToOptions(input.draft?.modelSelectionByProvider) ??
    providerModelOptionsFromSelection(input.threadModelSelection) ??
    providerModelOptionsFromSelection(input.projectModelSelection) ??
    null
  return { selectedModel, modelOptions }
}

// ── Zustand store ────────────────────────────────────────────────────

const EMPTY_THREAD_DRAFT = Object.freeze<ComposerThreadDraftState>(createEmptyThreadDraft())

export const useComposerDraftStore = create<ComposerDraftStoreState>()(
  persist(
    (set, get) => ({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
      getDraftThreadByProjectId: projectId => actionGetDraftThreadByProjectId(get, projectId),
      getDraftThread: threadId => actionGetDraftThread(get, threadId),
      setProjectDraftThreadId: (projectId, threadId, options) =>
        actionSetProjectDraftThreadId(set, projectId, threadId, options),
      setDraftThreadContext: (threadId, options) =>
        actionSetDraftThreadContext(set, threadId, options),
      clearProjectDraftThreadId: projectId => actionClearProjectDraftThreadId(set, projectId),
      clearProjectDraftThreadById: (projectId, threadId) =>
        actionClearProjectDraftThreadById(set, projectId, threadId),
      clearDraftThread: threadId => actionClearDraftThread(set, get, threadId),
      setStickyModelSelection: modelSelection => actionSetStickyModelSelection(set, modelSelection),
      applyStickyState: threadId => actionApplyStickyState(set, threadId),
      setPrompt: (threadId, prompt) => actionSetPrompt(set, threadId, prompt),
      setTerminalContexts: (threadId, contexts) =>
        actionSetTerminalContexts(set, threadId, contexts),
      setModelSelection: (threadId, modelSelection) =>
        actionSetModelSelection(set, threadId, modelSelection),
      setModelOptions: (threadId, modelOptions) =>
        actionSetModelOptions(set, threadId, modelOptions),
      setProviderModelOptions: (threadId, provider, nextProviderOptions, options) =>
        actionSetProviderModelOptions(set, threadId, provider, nextProviderOptions, options),
      setRuntimeMode: (threadId, runtimeMode) => actionSetRuntimeMode(set, threadId, runtimeMode),
      setInteractionMode: (threadId, interactionMode) =>
        actionSetInteractionMode(set, threadId, interactionMode),
      addImage: (threadId, image) => actionAddImages(set, threadId, [image]),
      addImages: (threadId, images) => actionAddImages(set, threadId, images),
      removeImage: (threadId, imageId) => actionRemoveImage(set, get, threadId, imageId),
      insertTerminalContext: (threadId, prompt, context, index) =>
        actionInsertTerminalContext(set, threadId, prompt, context, index),
      addTerminalContext: (threadId, context) =>
        actionAddTerminalContexts(set, threadId, [context]),
      addTerminalContexts: (threadId, contexts) =>
        actionAddTerminalContexts(set, threadId, contexts),
      removeTerminalContext: (threadId, contextId) =>
        actionRemoveTerminalContext(set, threadId, contextId),
      clearTerminalContexts: threadId => actionClearTerminalContexts(set, threadId),
      clearPersistedAttachments: threadId => actionClearPersistedAttachments(set, threadId),
      syncPersistedAttachments: (threadId, attachments) =>
        actionSyncPersistedAttachments(set, threadId, attachments, verifyPersistedAttachments),
      clearComposerContent: threadId => actionClearComposerContent(set, threadId),
    }),
    {
      name: COMPOSER_DRAFT_STORAGE_KEY,
      version: COMPOSER_DRAFT_STORAGE_VERSION,
      storage: createJSONStorage(() => composerDebouncedStorage),
      migrate: persistedState =>
        migratePersistedComposerDraftStoreState(persistedState, {
          draftsByThreadId: {},
          draftThreadsByThreadId: {},
          projectDraftThreadIdByProjectId: {},
          stickyModelSelectionByProvider: {},
          stickyActiveProvider: null,
        }),
      partialize: partializeComposerDraftStoreState,
      merge: (persistedState, currentState): ComposerDraftStoreState => {
        const normalizedPersisted = normalizeCurrentPersistedComposerDraftStoreState(
          persistedState,
          {
            draftsByThreadId: {},
            draftThreadsByThreadId: {},
            projectDraftThreadIdByProjectId: {},
            stickyModelSelectionByProvider: {},
            stickyActiveProvider: null,
          }
        )
        const draftsByThreadId = Object.fromEntries(
          Object.entries(normalizedPersisted.draftsByThreadId).map(([tid, draft]) => [
            tid,
            toHydratedThreadDraft(draft),
          ])
        ) as ComposerDraftStoreState['draftsByThreadId']
        return {
          ...currentState,
          draftsByThreadId,
          draftThreadsByThreadId:
            normalizedPersisted.draftThreadsByThreadId as ComposerDraftStoreState['draftThreadsByThreadId'],
          projectDraftThreadIdByProjectId:
            normalizedPersisted.projectDraftThreadIdByProjectId as ComposerDraftStoreState['projectDraftThreadIdByProjectId'],
          stickyModelSelectionByProvider: normalizedPersisted.stickyModelSelectionByProvider ?? {},
          stickyActiveProvider: normalizedPersisted.stickyActiveProvider ?? null,
        }
      },
    }
  )
)

// ── Hooks ────────────────────────────────────────────────────────────

export function useComposerThreadDraft(threadId: ThreadId): ComposerThreadDraftState {
  return useComposerDraftStore(state => state.draftsByThreadId[threadId] ?? EMPTY_THREAD_DRAFT)
}

export function useEffectiveComposerModelState(input: {
  threadId: ThreadId
  providers: ReadonlyArray<ServerProvider>
  selectedProvider: ProviderKind
  threadModelSelection: ModelSelection | null | undefined
  projectModelSelection: ModelSelection | null | undefined
  settings: UnifiedSettings
}): EffectiveComposerModelState {
  const draft = useComposerThreadDraft(input.threadId)
  return useMemo(
    () =>
      deriveEffectiveComposerModelState({
        draft,
        providers: input.providers,
        selectedProvider: input.selectedProvider,
        threadModelSelection: input.threadModelSelection,
        projectModelSelection: input.projectModelSelection,
        settings: input.settings,
      }),
    [
      draft,
      input.providers,
      input.settings,
      input.projectModelSelection,
      input.selectedProvider,
      input.threadModelSelection,
    ]
  )
}

// ── Imperative helpers ───────────────────────────────────────────────

export function clearPromotedDraftThread(threadId: ThreadId): void {
  if (!useComposerDraftStore.getState().getDraftThread(threadId)) return
  useComposerDraftStore.getState().clearDraftThread(threadId)
}

export function clearPromotedDraftThreads(serverThreadIds: Iterable<ThreadId>): void {
  for (const threadId of serverThreadIds) {
    clearPromotedDraftThread(threadId)
  }
}
