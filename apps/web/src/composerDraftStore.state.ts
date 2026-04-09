/**
 * Domain types, constants, and pure helper functions for composerDraftStore.
 *
 * Imported by composerDraftStore.ts and composerDraftStore.actions.ts.
 * All functions are pure. No Zustand or storage imports here.
 */
import {
  type ProviderKind,
  type ProjectId,
  type RuntimeMode,
  type ProviderInteractionMode,
  type ModelSelection,
  type ThreadId,
} from '@orxa-code/contracts'
import { type ChatImageAttachment } from './types'
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from './types'
import { type TerminalContextDraft, normalizeTerminalContextText } from './lib/terminalContext'
import { type PersistedComposerImageAttachment } from './composerDraftStore.normalize'

export { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE }
export type { PersistedComposerImageAttachment }

export type DraftThreadEnvMode = 'local' | 'worktree'

export interface ComposerImageAttachment extends Omit<ChatImageAttachment, 'previewUrl'> {
  previewUrl: string
  file: File
}

export interface ComposerThreadDraftState {
  prompt: string
  images: ComposerImageAttachment[]
  nonPersistedImageIds: string[]
  persistedAttachments: PersistedComposerImageAttachment[]
  terminalContexts: TerminalContextDraft[]
  modelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>
  activeProvider: ProviderKind | null
  runtimeMode: RuntimeMode | null
  interactionMode: ProviderInteractionMode | null
}

export interface DraftThreadState {
  projectId: ProjectId
  createdAt: string
  runtimeMode: RuntimeMode
  interactionMode: ProviderInteractionMode
  branch: string | null
  worktreePath: string | null
  envMode: DraftThreadEnvMode
}

export interface ComposerDraftStoreState {
  draftsByThreadId: Record<ThreadId, ComposerThreadDraftState>
  draftThreadsByThreadId: Record<ThreadId, DraftThreadState>
  projectDraftThreadIdByProjectId: Record<ProjectId, ThreadId>
  stickyModelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>
  stickyActiveProvider: ProviderKind | null
  getDraftThreadByProjectId: (projectId: ProjectId) =>
    | ({
        threadId: ThreadId
      } & DraftThreadState)
    | null
  getDraftThread: (threadId: ThreadId) => DraftThreadState | null
  setProjectDraftThreadId: (
    projectId: ProjectId,
    threadId: ThreadId,
    options?: {
      branch?: string | null
      worktreePath?: string | null
      createdAt?: string
      envMode?: DraftThreadEnvMode
      runtimeMode?: RuntimeMode
      interactionMode?: ProviderInteractionMode
    }
  ) => void
  setDraftThreadContext: (
    threadId: ThreadId,
    options: {
      branch?: string | null
      worktreePath?: string | null
      projectId?: ProjectId
      createdAt?: string
      envMode?: DraftThreadEnvMode
      runtimeMode?: RuntimeMode
      interactionMode?: ProviderInteractionMode
    }
  ) => void
  clearProjectDraftThreadId: (projectId: ProjectId) => void
  clearProjectDraftThreadById: (projectId: ProjectId, threadId: ThreadId) => void
  clearDraftThread: (threadId: ThreadId) => void
  setStickyModelSelection: (modelSelection: ModelSelection | null | undefined) => void
  setPrompt: (threadId: ThreadId, prompt: string) => void
  setTerminalContexts: (threadId: ThreadId, contexts: TerminalContextDraft[]) => void
  setModelSelection: (threadId: ThreadId, modelSelection: ModelSelection | null | undefined) => void
  setModelOptions: (
    threadId: ThreadId,
    modelOptions: ProviderModelOptions | null | undefined
  ) => void
  applyStickyState: (threadId: ThreadId) => void
  setProviderModelOptions: (
    threadId: ThreadId,
    provider: ProviderKind,
    nextProviderOptions: ProviderModelOptions[ProviderKind] | null | undefined,
    options?: {
      persistSticky?: boolean
    }
  ) => void
  setOpencodeAgentId: (threadId: ThreadId, agentId: string | null) => void
  setOpencodeVariant: (threadId: ThreadId, variant: string | null) => void
  setRuntimeMode: (threadId: ThreadId, runtimeMode: RuntimeMode | null | undefined) => void
  setInteractionMode: (
    threadId: ThreadId,
    interactionMode: ProviderInteractionMode | null | undefined
  ) => void
  addImage: (threadId: ThreadId, image: ComposerImageAttachment) => void
  addImages: (threadId: ThreadId, images: ComposerImageAttachment[]) => void
  removeImage: (threadId: ThreadId, imageId: string) => void
  insertTerminalContext: (
    threadId: ThreadId,
    prompt: string,
    context: TerminalContextDraft,
    index: number
  ) => boolean
  addTerminalContext: (threadId: ThreadId, context: TerminalContextDraft) => void
  addTerminalContexts: (threadId: ThreadId, contexts: TerminalContextDraft[]) => void
  removeTerminalContext: (threadId: ThreadId, contextId: string) => void
  clearTerminalContexts: (threadId: ThreadId) => void
  clearPersistedAttachments: (threadId: ThreadId) => void
  syncPersistedAttachments: (
    threadId: ThreadId,
    attachments: PersistedComposerImageAttachment[]
  ) => void
  clearComposerContent: (threadId: ThreadId) => void
}

// Re-export ProviderModelOptions so actions.ts can import it from here
import type { ProviderModelOptions } from '@orxa-code/contracts'
export type { ProviderModelOptions }

// ── Pure helpers ─────────────────────────────────────────────────────

export function createEmptyThreadDraft(): ComposerThreadDraftState {
  return {
    prompt: '',
    images: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    terminalContexts: [],
    modelSelectionByProvider: {},
    activeProvider: null,
    runtimeMode: null,
    interactionMode: null,
  }
}

export function shouldRemoveDraft(draft: ComposerThreadDraftState): boolean {
  return (
    draft.prompt.length === 0 &&
    draft.images.length === 0 &&
    draft.persistedAttachments.length === 0 &&
    draft.terminalContexts.length === 0 &&
    Object.keys(draft.modelSelectionByProvider).length === 0 &&
    draft.activeProvider === null &&
    draft.runtimeMode === null &&
    draft.interactionMode === null
  )
}

export function stripModelSelectionOptions(selection: ModelSelection): ModelSelection {
  return {
    provider: selection.provider,
    model: selection.model,
  }
}

export function composerImageDedupKey(image: ComposerImageAttachment): string {
  // Keep this independent from File.lastModified so dedupe is stable for hydrated
  // images reconstructed from localStorage (which get a fresh lastModified value).
  return `${image.mimeType}\u0000${image.sizeBytes}\u0000${image.name}`
}

export function terminalContextDedupKey(context: TerminalContextDraft): string {
  return `${context.terminalId}\u0000${context.lineStart}\u0000${context.lineEnd}`
}

export function normalizeTerminalContextForThread(
  threadId: ThreadId,
  context: TerminalContextDraft
): TerminalContextDraft | null {
  const terminalId = context.terminalId.trim()
  const terminalLabel = context.terminalLabel.trim()
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null
  }
  const lineStart = Math.max(1, Math.floor(context.lineStart))
  const lineEnd = Math.max(lineStart, Math.floor(context.lineEnd))
  return {
    ...context,
    threadId,
    terminalId,
    terminalLabel,
    lineStart,
    lineEnd,
    text: normalizeTerminalContextText(context.text),
  }
}

export function normalizeTerminalContextsForThread(
  threadId: ThreadId,
  contexts: ReadonlyArray<TerminalContextDraft>
): TerminalContextDraft[] {
  const existingIds = new Set<string>()
  const existingDedupKeys = new Set<string>()
  const normalizedContexts: TerminalContextDraft[] = []

  for (const context of contexts) {
    const normalizedContext = normalizeTerminalContextForThread(threadId, context)
    if (!normalizedContext) {
      continue
    }
    const dedupKey = terminalContextDedupKey(normalizedContext)
    if (existingIds.has(normalizedContext.id) || existingDedupKeys.has(dedupKey)) {
      continue
    }
    normalizedContexts.push(normalizedContext)
    existingIds.add(normalizedContext.id)
    existingDedupKeys.add(dedupKey)
  }

  return normalizedContexts
}

export function revokeObjectPreviewUrl(previewUrl: string): void {
  if (typeof URL === 'undefined') {
    return
  }
  if (!previewUrl.startsWith('blob:')) {
    return
  }
  URL.revokeObjectURL(previewUrl)
}

export function updateDraftByThreadId(
  state: ComposerDraftStoreState,
  threadId: ThreadId,
  nextDraft: ComposerThreadDraftState
): Partial<ComposerDraftStoreState> {
  const nextDraftsByThreadId = { ...state.draftsByThreadId }
  if (shouldRemoveDraft(nextDraft)) {
    delete nextDraftsByThreadId[threadId]
  } else {
    nextDraftsByThreadId[threadId] = nextDraft
  }
  return { draftsByThreadId: nextDraftsByThreadId }
}
