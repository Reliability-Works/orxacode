import type { SessionMessageBundle, SessionRuntimeSnapshot } from '@shared/ipc'
import type { GitDiffFile } from './git-diff'
import type { ClaudeChatMessageItem } from '../hooks/useClaudeChatSession'
import {
  buildChangedFilesFromProvenance,
  buildProvenanceByTurn,
  buildSessionDiffLookup,
} from './opencode-session-presentation-diff'
export {
  buildClaudeCompactionState,
  buildCodexCompactionState,
  buildOpencodeCompactionState,
  getOpencodeObservedTokenTotal,
} from './session-controls-compaction'

export const DEFAULT_SESSION_TOKEN_BUDGET = 120_000
export const DEFAULT_SESSION_RUNTIME_BUDGET_MINUTES = 45

export type SessionCompactionState = {
  progress: number
  hint: string
  compacted: boolean
  estimated: boolean
  lastCompactedAt?: number
}

export type SessionGuardrailPreferences = {
  enabled: boolean
  tokenBudget: number
  runtimeBudgetMinutes: number
}

export type SessionGuardrailState = {
  enabled: boolean
  tokenTotal: number
  tokenBudget: number
  runtimeMinutes: number
  runtimeBudgetMinutes: number
  tokenRatio: number
  runtimeRatio: number
  progress: number
  status: 'normal' | 'warning' | 'hard-stop' | 'disabled'
  disabledForSession: boolean
  continueOnceArmed: boolean
  detail: string
}

export type SessionGuardrailPrompt = {
  level: 'warning' | 'hard-stop'
  title: string
  detail: string
}

export type SessionRevertFile = {
  id: string
  path: string
  type: string
  diff?: string
  insertions?: number
  deletions?: number
}

export type SessionRevertTarget = {
  id: string
  label: string
  timestamp: number
  files: SessionRevertFile[]
  canRevert: boolean
  disabledReason?: string
}

export type TurnTokenSample = {
  turnId: string
  total: number
  timestamp: number
}

type SessionRevertDraftTarget = {
  id: string
  label: string
  timestamp: number
  files: SessionRevertFile[]
}

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function summarizePromptLabel(value: string | undefined, fallback: string) {
  const normalized = compactWhitespace(value ?? '')
  if (!normalized) {
    return fallback
  }
  return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}...` : normalized
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\.\/+/, '')
}

function dedupeFiles(files: SessionRevertFile[]) {
  const latestByPath = new Map<string, SessionRevertFile>()
  for (const file of files) {
    latestByPath.set(normalizePath(file.path), file)
  }
  return [...latestByPath.values()].sort((left, right) => left.path.localeCompare(right.path))
}

function getGitFileMap(gitFiles: GitDiffFile[]) {
  const byPath = new Map<string, GitDiffFile>()
  for (const file of gitFiles) {
    byPath.set(normalizePath(file.path), file)
    if (file.oldPath) {
      byPath.set(normalizePath(file.oldPath), file)
    }
  }
  return byPath
}

export function finalizeSessionRevertTargets(
  targets: SessionRevertDraftTarget[],
  gitFiles: GitDiffFile[]
): SessionRevertTarget[] {
  if (targets.length === 0) {
    return []
  }

  const normalizedTargets = targets
    .map(target => ({
      ...target,
      files: dedupeFiles(target.files),
    }))
    .filter(target => target.files.length > 0)
    .sort((left, right) => right.timestamp - left.timestamp)

  const latestTargetByPath = new Map<string, string>()
  for (const target of normalizedTargets) {
    for (const file of target.files) {
      const path = normalizePath(file.path)
      if (!latestTargetByPath.has(path)) {
        latestTargetByPath.set(path, target.id)
      }
    }
  }

  const gitFileMap = getGitFileMap(gitFiles)

  return normalizedTargets.map(target => {
    let disabledReason: string | undefined
    for (const file of target.files) {
      const normalizedPath = normalizePath(file.path)
      if (latestTargetByPath.get(normalizedPath) !== target.id) {
        disabledReason = 'A later turn also changed one or more of these files.'
        break
      }
      const gitFile = gitFileMap.get(normalizedPath)
      if (!gitFile?.hasUnstaged) {
        disabledReason = 'These files no longer have unstaged working-tree changes.'
        break
      }
      if (gitFile.hasStaged) {
        disabledReason = 'One or more files already have staged changes.'
        break
      }
    }

    return {
      ...target,
      canRevert: !disabledReason,
      disabledReason,
    }
  })
}

function readOpencodeTextParts(bundle: SessionMessageBundle) {
  return bundle.parts
    .filter(
      (part): part is Extract<SessionMessageBundle['parts'][number], { type: 'text' }> =>
        part.type === 'text'
    )
    .map(part => part.text)
    .filter((text): text is string => typeof text === 'string' && text.trim().length > 0)
    .join('\n')
}

export function buildOpencodeRevertTargets(
  messages: SessionMessageBundle[],
  runtimeSnapshot: SessionRuntimeSnapshot | null | undefined,
  gitFiles: GitDiffFile[]
) {
  if (!runtimeSnapshot?.changeProvenance.records?.length) {
    return []
  }

  const sessionDiffLookup = buildSessionDiffLookup(runtimeSnapshot.sessionDiff)
  const provenanceByTurn = buildProvenanceByTurn(runtimeSnapshot.changeProvenance.records)
  let lastUserPrompt = ''
  const drafts: SessionRevertDraftTarget[] = []

  for (const bundle of messages) {
    if (bundle.info.role === 'user') {
      lastUserPrompt = readOpencodeTextParts(bundle)
      continue
    }
    if (bundle.info.role !== 'assistant') {
      continue
    }
    const turnFiles = buildChangedFilesFromProvenance(
      provenanceByTurn.get(bundle.info.id) ?? [],
      sessionDiffLookup
    ).map(file => ({
      id: file.id,
      path: file.path,
      type: file.type,
      diff: file.diff,
      insertions: file.insertions,
      deletions: file.deletions,
    }))
    if (turnFiles.length === 0) {
      continue
    }
    drafts.push({
      id: bundle.info.id,
      label: summarizePromptLabel(lastUserPrompt, 'OpenCode turn'),
      timestamp:
        typeof (bundle.info.time as Record<string, unknown>).updated === 'number'
          ? ((bundle.info.time as Record<string, unknown>).updated as number)
          : bundle.info.time.created,
      files: turnFiles,
    })
  }

  return finalizeSessionRevertTargets(drafts, gitFiles)
}

function pushMessageDiffTarget(
  grouped: Map<string, SessionRevertDraftTarget>,
  targetId: string,
  label: string,
  timestamp: number,
  file: SessionRevertFile
) {
  const existing = grouped.get(targetId)
  if (existing) {
    existing.timestamp = Math.max(existing.timestamp, timestamp)
    existing.files.push(file)
    return
  }
  grouped.set(targetId, {
    id: targetId,
    label,
    timestamp,
    files: [file],
  })
}

export function buildCodexRevertTargets(
  messages: import('../hooks/codex-session-types').CodexMessageItem[],
  gitFiles: GitDiffFile[]
) {
  const grouped = new Map<string, SessionRevertDraftTarget>()
  let lastUserId = 'initial'
  let lastUserPrompt = ''

  for (const item of messages) {
    if (item.kind === 'message' && item.role === 'user') {
      lastUserId = item.id
      lastUserPrompt = item.content
      continue
    }
    if (item.kind !== 'diff') {
      continue
    }
    pushMessageDiffTarget(
      grouped,
      `codex:${lastUserId}`,
      summarizePromptLabel(lastUserPrompt, 'Codex turn'),
      item.timestamp,
      {
        id: item.id,
        path: item.path,
        type: item.type,
        diff: item.diff,
        insertions: item.insertions,
        deletions: item.deletions,
      }
    )
  }

  return finalizeSessionRevertTargets([...grouped.values()], gitFiles)
}

export function buildClaudeRevertTargets(
  messages: ClaudeChatMessageItem[],
  gitFiles: GitDiffFile[]
) {
  const grouped = new Map<string, SessionRevertDraftTarget>()
  let lastUserId = 'initial'
  let lastUserPrompt = ''

  for (const item of messages) {
    if (item.kind === 'message' && item.role === 'user') {
      lastUserId = item.id
      lastUserPrompt = item.content
      continue
    }
    if (item.kind !== 'diff') {
      continue
    }
    pushMessageDiffTarget(
      grouped,
      `claude:${lastUserId}`,
      summarizePromptLabel(lastUserPrompt, 'Claude turn'),
      item.timestamp,
      {
        id: item.id,
        path: item.path,
        type: item.type,
        diff: item.diff,
        insertions: item.insertions,
        deletions: item.deletions,
      }
    )
  }

  return finalizeSessionRevertTargets([...grouped.values()], gitFiles)
}

export function buildSessionGuardrailState(input: {
  preferences: SessionGuardrailPreferences
  observedTokenTotal: number
  runtimeMinutes: number
  disabledForSession: boolean
  continueOnceArmed: boolean
}) {
  const tokenBudget = Math.max(1, input.preferences.tokenBudget)
  const runtimeBudgetMinutes = Math.max(1, input.preferences.runtimeBudgetMinutes)
  const tokenTotal = Math.max(0, Math.round(input.observedTokenTotal))
  const runtimeMinutes = Math.max(0, input.runtimeMinutes)
  const tokenRatio = tokenTotal / tokenBudget
  const runtimeRatio = runtimeMinutes / runtimeBudgetMinutes
  const progress = Math.max(tokenRatio, runtimeRatio)

  if (!input.preferences.enabled) {
    return {
      enabled: false,
      tokenTotal,
      tokenBudget,
      runtimeMinutes,
      runtimeBudgetMinutes,
      tokenRatio,
      runtimeRatio,
      progress,
      status: 'disabled',
      disabledForSession: false,
      continueOnceArmed: false,
      detail: 'Session guardrails are disabled globally.',
    } satisfies SessionGuardrailState
  }

  if (input.disabledForSession) {
    return {
      enabled: true,
      tokenTotal,
      tokenBudget,
      runtimeMinutes,
      runtimeBudgetMinutes,
      tokenRatio,
      runtimeRatio,
      progress,
      status: 'disabled',
      disabledForSession: true,
      continueOnceArmed: input.continueOnceArmed,
      detail: 'Session guardrails are disabled for this session.',
    } satisfies SessionGuardrailState
  }

  const hardStop = tokenRatio >= 1 || runtimeRatio >= 1
  const warning = !hardStop && (tokenRatio >= 0.8 || runtimeRatio >= 0.8)
  const status = hardStop ? 'hard-stop' : warning ? 'warning' : 'normal'
  const tokenDetail = `${tokenTotal.toLocaleString()} / ${tokenBudget.toLocaleString()} tokens`
  const runtimeDetail = `${Math.round(runtimeMinutes)} / ${runtimeBudgetMinutes} min`

  return {
    enabled: true,
    tokenTotal,
    tokenBudget,
    runtimeMinutes,
    runtimeBudgetMinutes,
    tokenRatio,
    runtimeRatio,
    progress,
    status,
    disabledForSession: false,
    continueOnceArmed: input.continueOnceArmed,
    detail: `Usage: ${tokenDetail} · Runtime: ${runtimeDetail}`,
  } satisfies SessionGuardrailState
}
