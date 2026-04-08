/**
 * Migration and per-draft normalization helpers for composerDraftStore.
 *
 * Imported by composerDraftStore.ts for the Zustand persist middleware
 * `migrate` and `merge` callbacks. All functions are pure.
 */
import { type DeepMutable } from 'effect/Types'
import { ensureInlineTerminalContextPlaceholders } from './lib/terminalContext'
import {
  type PersistedComposerDraftStoreState,
  type PersistedComposerThreadDraftState,
  type PersistedDraftThreadState,
  type LegacyPersistedComposerDraftStoreState,
  type LegacyPersistedComposerThreadDraftState,
  type LegacyCodexFields,
  type PersistedComposerImageAttachment,
  type PersistedTerminalContextDraft,
  type ProviderKind,
  type ModelSelection,
  normalizeProviderKind,
  normalizeProviderModelOptions,
  normalizeModelSelection,
  normalizePersistedAttachment,
  normalizePersistedTerminalContextDraft,
  normalizePersistedDraftThreads,
  legacyMergeModelSelectionIntoProviderModelOptions,
  legacySyncModelSelectionOptions,
  legacyToModelSelectionByProvider,
} from './composerDraftStore.normalize'

export type {
  PersistedComposerDraftStoreState,
  PersistedComposerThreadDraftState,
  PersistedDraftThreadState,
  PersistedComposerImageAttachment,
  PersistedTerminalContextDraft,
}

function normalizeDraftModelSelectionByProvider(
  draftCandidate: PersistedComposerThreadDraftState,
  legacyDraftCandidate: LegacyPersistedComposerThreadDraftState
): {
  modelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>
  activeProvider: ProviderKind | null
} {
  if (
    draftCandidate.modelSelectionByProvider &&
    typeof draftCandidate.modelSelectionByProvider === 'object'
  ) {
    return {
      modelSelectionByProvider: draftCandidate.modelSelectionByProvider as Partial<
        Record<ProviderKind, ModelSelection>
      >,
      activeProvider: normalizeProviderKind(draftCandidate.activeProvider),
    }
  }
  const normalizedModelOptions =
    normalizeProviderModelOptions(
      legacyDraftCandidate.modelOptions,
      undefined,
      legacyDraftCandidate as LegacyCodexFields
    ) ?? null
  const normalizedModelSelection = normalizeModelSelection(legacyDraftCandidate.modelSelection, {
    provider: legacyDraftCandidate.provider,
    model: legacyDraftCandidate.model,
    modelOptions: normalizedModelOptions ?? legacyDraftCandidate.modelOptions,
    legacyCodex: legacyDraftCandidate as LegacyCodexFields,
  })
  const mergedModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
    normalizedModelSelection,
    normalizedModelOptions
  )
  const modelSelection = legacySyncModelSelectionOptions(
    normalizedModelSelection,
    mergedModelOptions
  )
  return {
    modelSelectionByProvider: legacyToModelSelectionByProvider(modelSelection, mergedModelOptions),
    activeProvider: modelSelection?.provider ?? null,
  }
}

function normalizeSinglePersistedDraft(
  draftValue: object
): PersistedComposerThreadDraftState | null {
  const draftCandidate = draftValue as PersistedComposerThreadDraftState
  const legacyDraftCandidate = draftValue as LegacyPersistedComposerThreadDraftState
  const promptCandidate = typeof draftCandidate.prompt === 'string' ? draftCandidate.prompt : ''
  const attachments = Array.isArray(draftCandidate.attachments)
    ? draftCandidate.attachments.flatMap(entry => {
        const normalized = normalizePersistedAttachment(entry)
        return normalized ? [normalized] : []
      })
    : []
  const terminalContexts = Array.isArray(draftCandidate.terminalContexts)
    ? draftCandidate.terminalContexts.flatMap(entry => {
        const normalized = normalizePersistedTerminalContextDraft(entry)
        return normalized ? [normalized] : []
      })
    : []
  const runtimeMode =
    draftCandidate.runtimeMode === 'approval-required' ||
    draftCandidate.runtimeMode === 'full-access'
      ? draftCandidate.runtimeMode
      : null
  const interactionMode =
    draftCandidate.interactionMode === 'plan' || draftCandidate.interactionMode === 'default'
      ? draftCandidate.interactionMode
      : null
  const { modelSelectionByProvider, activeProvider } = normalizeDraftModelSelectionByProvider(
    draftCandidate,
    legacyDraftCandidate
  )
  const hasModelData = Object.keys(modelSelectionByProvider).length > 0 || activeProvider !== null
  if (
    promptCandidate.length === 0 &&
    attachments.length === 0 &&
    terminalContexts.length === 0 &&
    !hasModelData &&
    !runtimeMode &&
    !interactionMode
  ) {
    return null
  }
  const prompt = ensureInlineTerminalContextPlaceholders(promptCandidate, terminalContexts.length)
  return {
    prompt,
    attachments,
    ...(terminalContexts.length > 0 ? { terminalContexts } : {}),
    ...(hasModelData ? { modelSelectionByProvider, activeProvider } : {}),
    ...(runtimeMode ? { runtimeMode } : {}),
    ...(interactionMode ? { interactionMode } : {}),
  }
}

export function normalizePersistedDraftsByThreadId(
  rawDraftMap: unknown
): PersistedComposerDraftStoreState['draftsByThreadId'] {
  if (!rawDraftMap || typeof rawDraftMap !== 'object') {
    return {}
  }
  const nextDraftsByThreadId: DeepMutable<PersistedComposerDraftStoreState['draftsByThreadId']> = {}
  for (const [threadId, draftValue] of Object.entries(rawDraftMap as Record<string, unknown>)) {
    if (typeof threadId !== 'string' || threadId.length === 0) continue
    if (!draftValue || typeof draftValue !== 'object') continue
    const normalized = normalizeSinglePersistedDraft(draftValue)
    if (normalized) {
      nextDraftsByThreadId[threadId] = normalized
    }
  }
  return nextDraftsByThreadId
}

function normalizeLegacyStickyModelState(candidate: LegacyPersistedComposerDraftStoreState): {
  stickyModelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>>
  stickyActiveProvider: ProviderKind | null
} {
  const stickyModelOptions = normalizeProviderModelOptions(candidate.stickyModelOptions) ?? {}
  const normalizedStickyModelSelection = normalizeModelSelection(candidate.stickyModelSelection, {
    provider: candidate.stickyProvider,
    model: candidate.stickyModel,
    modelOptions: stickyModelOptions,
  })
  const nextStickyModelOptions = legacyMergeModelSelectionIntoProviderModelOptions(
    normalizedStickyModelSelection,
    stickyModelOptions
  )
  const stickyModelSelection = legacySyncModelSelectionOptions(
    normalizedStickyModelSelection,
    nextStickyModelOptions
  )
  return {
    stickyModelSelectionByProvider: legacyToModelSelectionByProvider(
      stickyModelSelection,
      nextStickyModelOptions
    ),
    stickyActiveProvider: normalizeProviderKind(candidate.stickyProvider),
  }
}

export function migratePersistedComposerDraftStoreState(
  persistedState: unknown,
  emptyState: PersistedComposerDraftStoreState
): PersistedComposerDraftStoreState {
  if (!persistedState || typeof persistedState !== 'object') {
    return emptyState
  }
  const candidate = persistedState as LegacyPersistedComposerDraftStoreState
  const { stickyModelSelectionByProvider, stickyActiveProvider } =
    normalizeLegacyStickyModelState(candidate)
  const { draftThreadsByThreadId, projectDraftThreadIdByProjectId } =
    normalizePersistedDraftThreads(
      candidate.draftThreadsByThreadId,
      candidate.projectDraftThreadIdByProjectId
    )
  const draftsByThreadId = normalizePersistedDraftsByThreadId(candidate.draftsByThreadId)
  return {
    draftsByThreadId,
    draftThreadsByThreadId,
    projectDraftThreadIdByProjectId,
    stickyModelSelectionByProvider,
    stickyActiveProvider,
  }
}

export function normalizeCurrentPersistedComposerDraftStoreState(
  persistedState: unknown,
  emptyState: PersistedComposerDraftStoreState
): PersistedComposerDraftStoreState {
  if (!persistedState || typeof persistedState !== 'object') {
    return emptyState
  }
  const normalizedPersistedState = persistedState as LegacyPersistedComposerDraftStoreState
  const { draftThreadsByThreadId, projectDraftThreadIdByProjectId } =
    normalizePersistedDraftThreads(
      normalizedPersistedState.draftThreadsByThreadId,
      normalizedPersistedState.projectDraftThreadIdByProjectId
    )
  let stickyModelSelectionByProvider: Partial<Record<ProviderKind, ModelSelection>> = {}
  let stickyActiveProvider: ProviderKind | null = null
  if (
    normalizedPersistedState.stickyModelSelectionByProvider &&
    typeof normalizedPersistedState.stickyModelSelectionByProvider === 'object'
  ) {
    stickyModelSelectionByProvider =
      normalizedPersistedState.stickyModelSelectionByProvider as Partial<
        Record<ProviderKind, ModelSelection>
      >
    stickyActiveProvider = normalizeProviderKind(normalizedPersistedState.stickyActiveProvider)
  } else {
    const migrated = normalizeLegacyStickyModelState(normalizedPersistedState)
    stickyModelSelectionByProvider = migrated.stickyModelSelectionByProvider
    stickyActiveProvider = migrated.stickyActiveProvider
  }
  return {
    draftsByThreadId: normalizePersistedDraftsByThreadId(normalizedPersistedState.draftsByThreadId),
    draftThreadsByThreadId,
    projectDraftThreadIdByProjectId,
    stickyModelSelectionByProvider,
    stickyActiveProvider,
  }
}
