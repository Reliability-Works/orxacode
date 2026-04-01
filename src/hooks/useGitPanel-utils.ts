import type { GitDiffStats } from './useGitPanel-impl'

export const EMPTY_GIT_DIFF_STATS: GitDiffStats = {
  additions: 0,
  deletions: 0,
  filesChanged: 0,
  hasChanges: false,
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export { formatError }

function trimCommandErrorPrefix(message: string) {
  const cleaned = message.replace(/\s+/g, ' ').trim()
  const marker = cleaned.match(/\bexited with code\s+\d+:\s+/i)
  if (!marker) {
    return cleaned
  }
  const index = marker.index ?? -1
  if (index < 0) {
    return cleaned
  }
  return cleaned.slice(index + marker[0].length).trim()
}

export function formatCheckoutBranchError(error: unknown, branch: string) {
  const raw = formatError(error)
  const message = trimCommandErrorPrefix(raw)
  const normalized = message.toLowerCase()

  if (normalized.includes('would be overwritten by checkout')) {
    return `Cannot switch to "${branch}" because local changes would be overwritten. Commit, stash, or discard those files first.`
  }
  if (normalized.includes('is already checked out at')) {
    return `Cannot switch to "${branch}" because it is already checked out in another worktree.`
  }
  if (normalized.includes('pathspec') && normalized.includes('did not match any file')) {
    return `Branch "${branch}" was not found locally or on origin.`
  }
  if (normalized.includes('a branch named') && normalized.includes('already exists')) {
    return `Branch "${branch}" already exists. Try selecting it again to switch.`
  }
  if (normalized.includes('invalid branch name')) {
    return 'Invalid branch name.'
  }

  return message
}

export function pickDefaultBaseBranch(branches: string[], currentValue: string) {
  if (currentValue && branches.includes(currentValue)) {
    return currentValue
  }
  if (branches.includes('main')) {
    return 'main'
  }
  if (branches.includes('master')) {
    return 'master'
  }
  return branches[0] ?? ''
}

export async function refreshActiveGitPanel(
  gitPanelTab: 'diff' | 'log' | 'issues' | 'prs',
  loadGitDiff: () => Promise<void>,
  loadGitLog: () => Promise<void>,
  loadGitIssues: () => Promise<void>,
  loadGitPrs: () => Promise<void>
) {
  if (gitPanelTab === 'diff') {
    await loadGitDiff()
    return
  }
  if (gitPanelTab === 'log') {
    await loadGitLog()
    return
  }
  if (gitPanelTab === 'issues') {
    await loadGitIssues()
    return
  }
  await loadGitPrs()
}

export function openBranchCreateDialog(
  branchQuery: string,
  setBranchCreateName: (value: string) => void,
  setBranchCreateError: (value: string | null) => void,
  setBranchActionError: (value: string | null) => void,
  setBranchCreateModalOpen: (open: boolean) => void,
  setBranchMenuOpen: (open: boolean) => void
) {
  const query = branchQuery.trim()
  setBranchCreateName(query)
  setBranchCreateError(null)
  setBranchActionError(null)
  setBranchCreateModalOpen(true)
  setBranchMenuOpen(false)
}

export function validateBranchCreateCandidate(candidate: string, branches: string[] | undefined) {
  if (!candidate) {
    return 'Branch name is required'
  }
  if (new Set(branches ?? []).has(candidate)) {
    return `Branch "${candidate}" already exists`
  }
  return null
}

export function parseGitDiffStats(output: string): GitDiffStats {
  const trimmed = output.trim()
  if (
    !trimmed ||
    trimmed === 'No local changes.' ||
    trimmed === 'Not a git repository.' ||
    trimmed.startsWith('Loading diff')
  ) {
    return EMPTY_GIT_DIFF_STATS
  }

  const totals = { additions: 0, deletions: 0, changedFiles: new Set<string>() }

  for (const line of output.split(/\r?\n/)) {
    processGitDiffLine(line, totals)
  }

  return {
    additions: totals.additions,
    deletions: totals.deletions,
    filesChanged: totals.changedFiles.size,
    hasChanges:
      totals.changedFiles.size > 0 || totals.additions > 0 || totals.deletions > 0,
  }
}

function processGitDiffLine(
  line: string,
  totals: { additions: number; deletions: number; changedFiles: Set<string> }
) {
  const diffHeaderMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/)
  if (diffHeaderMatch) {
    const path = diffHeaderMatch[2] ?? diffHeaderMatch[1]
    if (path) {
      totals.changedFiles.add(path)
    }
    return
  }

  const untrackedMatch = line.match(/^\?\?\s+(.+)$/)
  if (untrackedMatch) {
    const path = untrackedMatch[1]?.trim()
    if (path) {
      totals.changedFiles.add(path)
      totals.additions += 1
    }
    return
  }

  const inlineUntracked = [...line.matchAll(/\?\?\s+([^?]+?)(?=\s+\?\?|$)/g)]
  if (inlineUntracked.length > 0) {
    for (const match of inlineUntracked) {
      const path = (match[1] ?? '').trim()
      if (!path) {
        continue
      }
      totals.changedFiles.add(path)
      totals.additions += 1
    }
    return
  }

  if (line.startsWith('+++') || line.startsWith('---')) {
    return
  }
  if (line.startsWith('+')) {
    totals.additions += 1
    return
  }
  if (line.startsWith('-')) {
    totals.deletions += 1
  }
}
