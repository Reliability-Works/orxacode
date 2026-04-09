/**
 * Normalization and migration helpers for composerDraftStore.
 *
 * Extracted from composerDraftStore.ts to keep per-file line counts within
 * lint limits. All functions are pure — no Zustand set/get, no side-effects.
 */
import {
  CODEX_REASONING_EFFORT_OPTIONS,
  type ClaudeCodeEffort,
  type CodexReasoningEffort,
  DEFAULT_MODEL_BY_PROVIDER,
  type ModelSelection,
  type ProviderKind,
  type ProviderModelOptions,
  type RuntimeMode,
  type ProviderInteractionMode,
} from '@orxa-code/contracts'
import { normalizeModelSlug } from '@orxa-code/shared/model'
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from './types'

// ── Re-exported local types ──────────────────────────────────────────────

export type { ProviderKind, ModelSelection, ProviderModelOptions }

// ── Internal legacy field types ──────────────────────────────────────────

export interface LegacyCodexFields {
  effort?: (typeof CODEX_REASONING_EFFORT_OPTIONS)[number]
  codexFastMode?: boolean
  serviceTier?: string
}

export interface LegacyStickyModelFields {
  stickyProvider?: ProviderKind
  stickyModel?: string
  stickyModelOptions?: ProviderModelOptions | null
}

export interface LegacyV2StoreFields {
  stickyModelSelection?: ModelSelection | null
  stickyModelOptions?: ProviderModelOptions | null
}

export interface LegacyThreadModelFields {
  provider?: ProviderKind
  model?: string
  modelOptions?: ProviderModelOptions | null
}

export interface LegacyV2ThreadDraftFields {
  modelSelection?: ModelSelection | null
  modelOptions?: ProviderModelOptions | null
}

// ── Persisted schema types ───────────────────────────────────────────────

export interface PersistedDraftThreadState {
  projectId: string
  createdAt: string
  runtimeMode: RuntimeMode
  interactionMode: ProviderInteractionMode
  branch: string | null
  worktreePath: string | null
  envMode: 'local' | 'worktree'
}

export interface PersistedTerminalContextDraft {
  id: string
  threadId: string
  createdAt: string
  terminalId: string
  terminalLabel: string
  lineStart: number
  lineEnd: number
}

export interface PersistedComposerImageAttachment {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  dataUrl: string
}

export interface PersistedComposerThreadDraftState {
  prompt: string
  attachments: PersistedComposerImageAttachment[]
  terminalContexts?: PersistedTerminalContextDraft[]
  modelSelectionByProvider?: Partial<Record<ProviderKind, ModelSelection>>
  activeProvider?: ProviderKind | null
  runtimeMode?: RuntimeMode
  interactionMode?: ProviderInteractionMode
}

export type LegacyPersistedComposerThreadDraftState = PersistedComposerThreadDraftState &
  LegacyCodexFields &
  LegacyThreadModelFields &
  LegacyV2ThreadDraftFields

export interface PersistedComposerDraftStoreState {
  draftsByThreadId: Record<string, PersistedComposerThreadDraftState>
  draftThreadsByThreadId: Record<string, PersistedDraftThreadState>
  projectDraftThreadIdByProjectId: Record<string, string>
  stickyModelSelectionByProvider?: Partial<Record<ProviderKind, ModelSelection>>
  stickyActiveProvider?: ProviderKind | null
}

export type LegacyPersistedComposerDraftStoreState = PersistedComposerDraftStoreState &
  LegacyStickyModelFields &
  LegacyV2StoreFields

// ── Normalization helpers ────────────────────────────────────────────────

const VALID_CODEX_REASONING_EFFORTS = new Set<string>(['low', 'medium', 'high', 'xhigh'])
const VALID_CLAUDE_EFFORTS = new Set<string>(['low', 'medium', 'high', 'max', 'ultrathink'])

export function normalizeProviderKind(value: unknown): ProviderKind | null {
  return value === 'codex' || value === 'claudeAgent' || value === 'opencode' ? value : null
}

function resolveCodexReasoningEffort(
  codexCandidate: Record<string, unknown> | null,
  provider: ProviderKind | null | undefined,
  legacy: LegacyCodexFields | undefined
): CodexReasoningEffort | undefined {
  const raw = codexCandidate?.reasoningEffort
  if (typeof raw === 'string' && VALID_CODEX_REASONING_EFFORTS.has(raw)) {
    return raw as CodexReasoningEffort
  }
  const legacyEffort = legacy?.effort
  if (
    provider === 'codex' &&
    typeof legacyEffort === 'string' &&
    VALID_CODEX_REASONING_EFFORTS.has(legacyEffort)
  ) {
    return legacyEffort as CodexReasoningEffort
  }
  return undefined
}

function resolveCodexFastMode(
  codexCandidate: Record<string, unknown> | null,
  provider: ProviderKind | null | undefined,
  legacy: LegacyCodexFields | undefined
): boolean | undefined {
  if (codexCandidate?.fastMode === true) return true
  if (codexCandidate?.fastMode === false) return false
  if (provider === 'codex' && legacy?.codexFastMode === true) return true
  if (typeof legacy?.serviceTier === 'string' && legacy.serviceTier === 'fast') return true
  return undefined
}

function normalizeCodexOptions(
  codexCandidate: Record<string, unknown> | null,
  provider: ProviderKind | null | undefined,
  legacy: LegacyCodexFields | undefined
): ProviderModelOptions['codex'] | undefined {
  const reasoningEffort = resolveCodexReasoningEffort(codexCandidate, provider, legacy)
  const fastMode = resolveCodexFastMode(codexCandidate, provider, legacy)
  if (reasoningEffort === undefined && fastMode === undefined) {
    return undefined
  }
  return {
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
  }
}

function resolveBoolean(value: unknown): boolean | undefined {
  if (value === true) return true
  if (value === false) return false
  return undefined
}

function normalizeClaudeAgentOptions(
  claudeCandidate: Record<string, unknown> | null
): ProviderModelOptions['claudeAgent'] | undefined {
  const thinking = resolveBoolean(claudeCandidate?.thinking)
  const rawEffort = claudeCandidate?.effort
  const effort: ClaudeCodeEffort | undefined =
    typeof rawEffort === 'string' && VALID_CLAUDE_EFFORTS.has(rawEffort)
      ? (rawEffort as ClaudeCodeEffort)
      : undefined
  const fastMode = resolveBoolean(claudeCandidate?.fastMode)
  const contextWindow =
    typeof claudeCandidate?.contextWindow === 'string' && claudeCandidate.contextWindow.length > 0
      ? claudeCandidate.contextWindow
      : undefined
  if (
    thinking === undefined &&
    effort === undefined &&
    fastMode === undefined &&
    contextWindow === undefined
  ) {
    return undefined
  }
  return {
    ...(thinking !== undefined ? { thinking } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(fastMode !== undefined ? { fastMode } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  }
}

export function normalizeProviderModelOptions(
  value: unknown,
  provider?: ProviderKind | null,
  legacy?: LegacyCodexFields
): ProviderModelOptions | null {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  const codexCandidate =
    candidate?.codex && typeof candidate.codex === 'object'
      ? (candidate.codex as Record<string, unknown>)
      : null
  const claudeCandidate =
    candidate?.claudeAgent && typeof candidate.claudeAgent === 'object'
      ? (candidate.claudeAgent as Record<string, unknown>)
      : null
  const codex = normalizeCodexOptions(codexCandidate, provider, legacy)
  const claude = normalizeClaudeAgentOptions(claudeCandidate)
  if (!codex && !claude) {
    return null
  }
  return {
    ...(codex ? { codex } : {}),
    ...(claude ? { claudeAgent: claude } : {}),
  }
}

interface ModelSelectionLegacy {
  provider?: unknown
  model?: unknown
  modelOptions?: unknown
  legacyCodex?: LegacyCodexFields
}

function extractModelSelectionOptions(
  provider: ProviderKind,
  modelOptions: ProviderModelOptions | null
): ModelSelection['options'] | undefined {
  if (provider === 'codex') return modelOptions?.codex
  if (provider === 'opencode') return modelOptions?.opencode
  return modelOptions?.claudeAgent
}

export function normalizeModelSelection(
  value: unknown,
  legacy?: ModelSelectionLegacy
): ModelSelection | null {
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
  const provider = normalizeProviderKind(candidate?.provider ?? legacy?.provider)
  if (provider === null) return null
  const rawModel = candidate?.model ?? legacy?.model
  if (typeof rawModel !== 'string') return null
  const model = normalizeModelSlug(rawModel, provider)
  if (!model) return null
  const optionsInput = candidate?.options ? { [provider]: candidate.options } : legacy?.modelOptions
  const legacyCodex = provider === 'codex' ? legacy?.legacyCodex : undefined
  const modelOptions = normalizeProviderModelOptions(optionsInput, provider, legacyCodex)
  const options = extractModelSelectionOptions(provider, modelOptions)
  return { provider, model, ...(options ? { options } : {}) } as ModelSelection
}

// ── Legacy sync helpers ──────────────────────────────────────────────────

export function legacySyncModelSelectionOptions(
  modelSelection: ModelSelection | null,
  modelOptions: ProviderModelOptions | null | undefined
): ModelSelection | null {
  if (modelSelection === null) {
    return null
  }
  const options = modelOptions?.[modelSelection.provider]
  return {
    provider: modelSelection.provider,
    model: modelSelection.model,
    ...(options ? { options } : {}),
  } as ModelSelection
}

export function legacyMergeModelSelectionIntoProviderModelOptions(
  modelSelection: ModelSelection | null,
  currentModelOptions: ProviderModelOptions | null | undefined
): ProviderModelOptions | null {
  if (modelSelection?.options === undefined) {
    return normalizeProviderModelOptions(currentModelOptions)
  }
  return legacyReplaceProviderModelOptions(
    normalizeProviderModelOptions(currentModelOptions),
    modelSelection.provider,
    modelSelection.options
  )
}

export function legacyReplaceProviderModelOptions(
  currentModelOptions: ProviderModelOptions | null | undefined,
  provider: ProviderKind,
  nextProviderOptions: ProviderModelOptions[ProviderKind] | null | undefined
): ProviderModelOptions | null {
  const otherProviderModelOptions = Object.fromEntries(
    Object.entries(currentModelOptions ?? {}).filter(([key]) => key !== provider)
  ) as ProviderModelOptions
  const normalizedNextProviderOptions = normalizeProviderModelOptions(
    { [provider]: nextProviderOptions },
    provider
  )
  return normalizeProviderModelOptions({
    ...otherProviderModelOptions,
    ...(normalizedNextProviderOptions ? normalizedNextProviderOptions : {}),
  })
}

export function legacyToModelSelectionByProvider(
  modelSelection: ModelSelection | null,
  modelOptions: ProviderModelOptions | null | undefined
): Partial<Record<ProviderKind, ModelSelection>> {
  const result: Partial<Record<ProviderKind, ModelSelection>> = {}
  if (modelOptions) {
    for (const provider of ['codex', 'claudeAgent'] as const) {
      const options = modelOptions[provider]
      if (options && Object.keys(options).length > 0) {
        result[provider] = {
          provider,
          model:
            modelSelection?.provider === provider
              ? modelSelection.model
              : DEFAULT_MODEL_BY_PROVIDER[provider],
          options,
        }
      }
    }
  }
  if (modelSelection) {
    result[modelSelection.provider] = modelSelection
  }
  return result
}

// ── Persisted attachment normalization ───────────────────────────────────

export function normalizePersistedAttachment(
  value: unknown
): PersistedComposerImageAttachment | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Record<string, unknown>
  const { id, name, mimeType, sizeBytes, dataUrl } = candidate
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof mimeType !== 'string' ||
    typeof sizeBytes !== 'number' ||
    !Number.isFinite(sizeBytes) ||
    typeof dataUrl !== 'string' ||
    id.length === 0 ||
    dataUrl.length === 0
  ) {
    return null
  }
  return { id, name, mimeType, sizeBytes, dataUrl }
}

export function normalizePersistedTerminalContextDraft(
  value: unknown
): PersistedTerminalContextDraft | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Record<string, unknown>
  const { id, threadId, createdAt, lineStart, lineEnd } = candidate
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    typeof threadId !== 'string' ||
    threadId.length === 0 ||
    typeof createdAt !== 'string' ||
    createdAt.length === 0 ||
    typeof lineStart !== 'number' ||
    !Number.isFinite(lineStart) ||
    typeof lineEnd !== 'number' ||
    !Number.isFinite(lineEnd)
  ) {
    return null
  }
  const terminalId = typeof candidate.terminalId === 'string' ? candidate.terminalId.trim() : ''
  const terminalLabel =
    typeof candidate.terminalLabel === 'string' ? candidate.terminalLabel.trim() : ''
  if (terminalId.length === 0 || terminalLabel.length === 0) {
    return null
  }
  const normalizedLineStart = Math.max(1, Math.floor(lineStart))
  const normalizedLineEnd = Math.max(normalizedLineStart, Math.floor(lineEnd))
  return {
    id,
    threadId,
    createdAt,
    terminalId,
    terminalLabel,
    lineStart: normalizedLineStart,
    lineEnd: normalizedLineEnd,
  }
}

export function normalizeDraftThreadEnvMode(
  value: unknown,
  fallbackWorktreePath: string | null
): 'local' | 'worktree' {
  if (value === 'local' || value === 'worktree') {
    return value
  }
  return fallbackWorktreePath ? 'worktree' : 'local'
}

// ── Draft thread normalization ───────────────────────────────────────────

function normalizeSinglePersistedDraftThread(
  threadId: string,
  rawDraftThread: Record<string, unknown>
): PersistedDraftThreadState | null {
  const { projectId, createdAt, branch, worktreePath } = rawDraftThread
  const normalizedWorktreePath = typeof worktreePath === 'string' ? worktreePath : null
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return null
  }
  return {
    projectId,
    createdAt:
      typeof createdAt === 'string' && createdAt.length > 0 ? createdAt : new Date().toISOString(),
    runtimeMode:
      rawDraftThread.runtimeMode === 'approval-required' ||
      rawDraftThread.runtimeMode === 'full-access'
        ? rawDraftThread.runtimeMode
        : DEFAULT_RUNTIME_MODE,
    interactionMode:
      rawDraftThread.interactionMode === 'plan' || rawDraftThread.interactionMode === 'default'
        ? rawDraftThread.interactionMode
        : DEFAULT_INTERACTION_MODE,
    branch: typeof branch === 'string' ? branch : null,
    worktreePath: normalizedWorktreePath,
    envMode: normalizeDraftThreadEnvMode(rawDraftThread.envMode, normalizedWorktreePath),
  }
}

export function normalizePersistedDraftThreads(
  rawDraftThreadsByThreadId: unknown,
  rawProjectDraftThreadIdByProjectId: unknown
): Pick<
  PersistedComposerDraftStoreState,
  'draftThreadsByThreadId' | 'projectDraftThreadIdByProjectId'
> {
  const draftThreadsByThreadId: Record<string, PersistedDraftThreadState> = {}
  if (rawDraftThreadsByThreadId && typeof rawDraftThreadsByThreadId === 'object') {
    for (const [threadId, rawDraftThread] of Object.entries(
      rawDraftThreadsByThreadId as Record<string, unknown>
    )) {
      if (typeof threadId !== 'string' || threadId.length === 0) continue
      if (!rawDraftThread || typeof rawDraftThread !== 'object') continue
      const normalized = normalizeSinglePersistedDraftThread(
        threadId,
        rawDraftThread as Record<string, unknown>
      )
      if (normalized) {
        draftThreadsByThreadId[threadId] = normalized
      }
    }
  }

  const projectDraftThreadIdByProjectId: Record<string, string> = {}
  if (
    rawProjectDraftThreadIdByProjectId &&
    typeof rawProjectDraftThreadIdByProjectId === 'object'
  ) {
    for (const [projectId, threadId] of Object.entries(
      rawProjectDraftThreadIdByProjectId as Record<string, unknown>
    )) {
      if (
        typeof projectId === 'string' &&
        projectId.length > 0 &&
        typeof threadId === 'string' &&
        threadId.length > 0
      ) {
        projectDraftThreadIdByProjectId[projectId] = threadId
        if (!draftThreadsByThreadId[threadId]) {
          draftThreadsByThreadId[threadId] = {
            projectId,
            createdAt: new Date().toISOString(),
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            envMode: 'local',
          }
        } else if (draftThreadsByThreadId[threadId]?.projectId !== projectId) {
          draftThreadsByThreadId[threadId] = {
            ...draftThreadsByThreadId[threadId]!,
            projectId,
          }
        }
      }
    }
  }

  return { draftThreadsByThreadId, projectDraftThreadIdByProjectId }
}
