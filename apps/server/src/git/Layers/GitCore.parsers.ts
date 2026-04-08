import { Effect, FileSystem } from 'effect'

import { GitCommandError } from '@orxa-code/contracts'

export const DEFAULT_BASE_BRANCH_CANDIDATES = ['main', 'master'] as const
export const OUTPUT_TRUNCATED_MARKER = '\n\n[truncated]'
export const PREPARED_COMMIT_PATCH_MAX_OUTPUT_BYTES = 49_000
export const RANGE_COMMIT_SUMMARY_MAX_OUTPUT_BYTES = 19_000
export const RANGE_DIFF_SUMMARY_MAX_OUTPUT_BYTES = 19_000
export const RANGE_DIFF_PATCH_MAX_OUTPUT_BYTES = 59_000
export const WORKSPACE_FILES_MAX_OUTPUT_BYTES = 16 * 1024 * 1024
export const GIT_CHECK_IGNORE_MAX_STDIN_BYTES = 256 * 1024

export function parseBranchAb(value: string): { ahead: number; behind: number } {
  const match = value.match(/^\+(\d+)\s+-(\d+)$/)
  if (!match) return { ahead: 0, behind: 0 }
  return {
    ahead: Number(match[1] ?? '0'),
    behind: Number(match[2] ?? '0'),
  }
}

export function parseNumstatEntries(
  stdout: string
): Array<{ path: string; insertions: number; deletions: number }> {
  const entries: Array<{ path: string; insertions: number; deletions: number }> = []
  for (const line of stdout.split(/\r?\n/g)) {
    if (line.trim().length === 0) continue
    const [addedRaw, deletedRaw, ...pathParts] = line.split('\t')
    const rawPath =
      pathParts.length > 1 ? (pathParts.at(-1) ?? '').trim() : pathParts.join('\t').trim()
    if (rawPath.length === 0) continue
    const added = Number.parseInt(addedRaw ?? '0', 10)
    const deleted = Number.parseInt(deletedRaw ?? '0', 10)
    const renameArrowIndex = rawPath.indexOf(' => ')
    const normalizedPath =
      renameArrowIndex >= 0 ? rawPath.slice(renameArrowIndex + ' => '.length).trim() : rawPath
    entries.push({
      path: normalizedPath.length > 0 ? normalizedPath : rawPath,
      insertions: Number.isFinite(added) ? added : 0,
      deletions: Number.isFinite(deleted) ? deleted : 0,
    })
  }
  return entries
}

export function splitNullSeparatedPaths(input: string, truncated: boolean): string[] {
  const parts = input.split('\0')
  if (parts.length === 0) return []

  if (truncated && parts[parts.length - 1]?.length) {
    parts.pop()
  }

  return parts.filter(value => value.length > 0)
}

export function chunkPathsForGitCheckIgnore(relativePaths: readonly string[]): string[][] {
  const chunks: string[][] = []
  let chunk: string[] = []
  let chunkBytes = 0

  for (const relativePath of relativePaths) {
    const relativePathBytes = Buffer.byteLength(relativePath) + 1
    if (chunk.length > 0 && chunkBytes + relativePathBytes > GIT_CHECK_IGNORE_MAX_STDIN_BYTES) {
      chunks.push(chunk)
      chunk = []
      chunkBytes = 0
    }

    chunk.push(relativePath)
    chunkBytes += relativePathBytes

    if (chunkBytes >= GIT_CHECK_IGNORE_MAX_STDIN_BYTES) {
      chunks.push(chunk)
      chunk = []
      chunkBytes = 0
    }
  }

  if (chunk.length > 0) {
    chunks.push(chunk)
  }

  return chunks
}

function parsePorcelainPath(line: string): string | null {
  if (line.startsWith('? ') || line.startsWith('! ')) {
    const simple = line.slice(2).trim()
    return simple.length > 0 ? simple : null
  }

  if (!(line.startsWith('1 ') || line.startsWith('2 ') || line.startsWith('u '))) {
    return null
  }

  const tabIndex = line.indexOf('\t')
  if (tabIndex >= 0) {
    const fromTab = line.slice(tabIndex + 1)
    const [filePath] = fromTab.split('\t')
    return filePath?.trim().length ? filePath.trim() : null
  }

  const parts = line.trim().split(/\s+/g)
  const filePath = parts.at(-1) ?? ''
  return filePath.length > 0 ? filePath : null
}

export type ParsedStatusPorcelain = {
  branch: string | null
  upstreamRef: string | null
  aheadCount: number
  behindCount: number
  hasWorkingTreeChanges: boolean
  changedFilesWithoutNumstat: Set<string>
}

export function parseStatusPorcelain(statusStdout: string): ParsedStatusPorcelain {
  let branch: string | null = null
  let upstreamRef: string | null = null
  let aheadCount = 0
  let behindCount = 0
  let hasWorkingTreeChanges = false
  const changedFilesWithoutNumstat = new Set<string>()

  for (const line of statusStdout.split(/\r?\n/g)) {
    if (line.startsWith('# branch.head ')) {
      const value = line.slice('# branch.head '.length).trim()
      branch = value.startsWith('(') ? null : value
      continue
    }
    if (line.startsWith('# branch.upstream ')) {
      const value = line.slice('# branch.upstream '.length).trim()
      upstreamRef = value.length > 0 ? value : null
      continue
    }
    if (line.startsWith('# branch.ab ')) {
      const value = line.slice('# branch.ab '.length).trim()
      const parsed = parseBranchAb(value)
      aheadCount = parsed.ahead
      behindCount = parsed.behind
      continue
    }
    if (line.trim().length > 0 && !line.startsWith('#')) {
      hasWorkingTreeChanges = true
      const pathValue = parsePorcelainPath(line)
      if (pathValue) changedFilesWithoutNumstat.add(pathValue)
    }
  }

  return {
    branch,
    upstreamRef,
    aheadCount,
    behindCount,
    hasWorkingTreeChanges,
    changedFilesWithoutNumstat,
  }
}

export function toWorkingTreeStats(
  stagedNumstatStdout: string,
  unstagedNumstatStdout: string,
  changedFilesWithoutNumstat: ReadonlySet<string>
): {
  files: Array<{ path: string; insertions: number; deletions: number }>
  insertions: number
  deletions: number
} {
  const stagedEntries = parseNumstatEntries(stagedNumstatStdout)
  const unstagedEntries = parseNumstatEntries(unstagedNumstatStdout)
  const fileStatMap = new Map<string, { insertions: number; deletions: number }>()
  for (const entry of [...stagedEntries, ...unstagedEntries]) {
    const existing = fileStatMap.get(entry.path) ?? { insertions: 0, deletions: 0 }
    existing.insertions += entry.insertions
    existing.deletions += entry.deletions
    fileStatMap.set(entry.path, existing)
  }

  let insertions = 0
  let deletions = 0
  const files = Array.from(fileStatMap.entries())
    .map(([filePath, stat]) => {
      insertions += stat.insertions
      deletions += stat.deletions
      return { path: filePath, insertions: stat.insertions, deletions: stat.deletions }
    })
    .toSorted((a, b) => a.path.localeCompare(b.path))
  for (const filePath of changedFilesWithoutNumstat) {
    if (fileStatMap.has(filePath)) continue
    files.push({ path: filePath, insertions: 0, deletions: 0 })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))

  return {
    files,
    insertions,
    deletions,
  }
}

export function parseBranchLine(line: string): { name: string; current: boolean } | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null

  const name = trimmed.replace(/^[*+]\s+/, '')
  if (name.includes(' -> ') || name.startsWith('(')) return null

  return {
    name,
    current: trimmed.startsWith('* '),
  }
}

export function parseRemoteNames(stdout: string): ReadonlyArray<string> {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .toSorted((a, b) => b.length - a.length)
}

export function sanitizeRemoteName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return sanitized.length > 0 ? sanitized : 'fork'
}

export function normalizeRemoteUrl(value: string): string {
  return value
    .trim()
    .replace(/\/+$/g, '')
    .replace(/\.git$/i, '')
    .toLowerCase()
}

export function parseRemoteFetchUrls(stdout: string): Map<string, string> {
  const remotes = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed)
    if (!match) continue
    const [, remoteName = '', remoteUrl = '', direction = ''] = match
    if (direction !== 'fetch' || remoteName.length === 0 || remoteUrl.length === 0) {
      continue
    }
    remotes.set(remoteName, remoteUrl)
  }
  return remotes
}

export function parseRemoteRefWithRemoteNames(
  branchName: string,
  remoteNames: ReadonlyArray<string>
): { remoteRef: string; remoteName: string; localBranch: string } | null {
  const trimmedBranchName = branchName.trim()
  if (trimmedBranchName.length === 0) return null

  for (const remoteName of remoteNames) {
    const remotePrefix = `${remoteName}/`
    if (!trimmedBranchName.startsWith(remotePrefix)) {
      continue
    }
    const localBranch = trimmedBranchName.slice(remotePrefix.length).trim()
    if (localBranch.length === 0) {
      return null
    }
    return {
      remoteRef: trimmedBranchName,
      remoteName,
      localBranch,
    }
  }

  return null
}

export function parseTrackingBranchByUpstreamRef(
  stdout: string,
  upstreamRef: string
): string | null {
  for (const line of stdout.split('\n')) {
    const trimmedLine = line.trim()
    if (trimmedLine.length === 0) {
      continue
    }
    const [branchNameRaw, upstreamBranchRaw = ''] = trimmedLine.split('\t')
    const branchName = branchNameRaw?.trim() ?? ''
    const upstreamBranch = upstreamBranchRaw.trim()
    if (branchName.length === 0 || upstreamBranch.length === 0) {
      continue
    }
    if (upstreamBranch === upstreamRef) {
      return branchName
    }
  }

  return null
}

export type GitBranchListEntry = {
  name: string
  current: boolean
  isRemote: boolean
  remoteName?: string
  isDefault: boolean
  worktreePath: string | null
}

export function compareBranchRecency(
  branchLastCommit: ReadonlyMap<string, number>,
  aName: string,
  bName: string
): number {
  const aLastCommit = branchLastCommit.get(aName) ?? 0
  const bLastCommit = branchLastCommit.get(bName) ?? 0
  if (aLastCommit !== bLastCommit) return bLastCommit - aLastCommit
  return aName.localeCompare(bName)
}

function parseBranchLines(stdout: string): Array<{ name: string; current: boolean }> {
  return stdout
    .split('\n')
    .map(parseBranchLine)
    .filter((branch): branch is { name: string; current: boolean } => branch !== null)
}

export function buildLocalBranchEntries(input: {
  stdout: string
  defaultBranch: string | null
  worktreeMap: ReadonlyMap<string, string>
  branchLastCommit: ReadonlyMap<string, number>
}): Array<GitBranchListEntry> {
  return parseBranchLines(input.stdout)
    .map(branch => ({
      name: branch.name,
      current: branch.current,
      isRemote: false,
      isDefault: branch.name === input.defaultBranch,
      worktreePath: input.worktreeMap.get(branch.name) ?? null,
    }))
    .toSorted((a, b) => {
      const aPriority = a.current ? 0 : a.isDefault ? 1 : 2
      const bPriority = b.current ? 0 : b.isDefault ? 1 : 2
      if (aPriority !== bPriority) return aPriority - bPriority
      return compareBranchRecency(input.branchLastCommit, a.name, b.name)
    })
}

export function buildRemoteBranchEntries(input: {
  stdout: string
  remoteNames: ReadonlyArray<string>
  branchLastCommit: ReadonlyMap<string, number>
}): Array<GitBranchListEntry> {
  return parseBranchLines(input.stdout)
    .map(branch => {
      const parsedRemoteRef = parseRemoteRefWithRemoteNames(branch.name, input.remoteNames)
      const remoteBranch: GitBranchListEntry = {
        name: branch.name,
        current: false,
        isRemote: true,
        isDefault: false,
        worktreePath: null,
      }
      if (parsedRemoteRef) {
        remoteBranch.remoteName = parsedRemoteRef.remoteName
      }
      return remoteBranch
    })
    .toSorted((a, b) => compareBranchRecency(input.branchLastCommit, a.name, b.name))
}

export const EMPTY_LIST_BRANCH_LOOKUP_RESULT = {
  code: 1,
  stdout: '',
  stderr: '',
} as const

export function listBranchLookupFailureMessage(input: {
  cwd: string
  lookup: 'remote branch' | 'remote name'
  errorMessage: string
}): string {
  return `GitCore.listBranches: ${input.lookup} lookup failed for ${input.cwd}: ${input.errorMessage}. Falling back to an empty ${input.lookup} list.`
}

export function listBranchLookupFailureEffect(input: {
  cwd: string
  lookup: 'remote branch' | 'remote name'
  errorMessage: string
}): Effect.Effect<typeof EMPTY_LIST_BRANCH_LOOKUP_RESULT, never> {
  return Effect.logWarning(listBranchLookupFailureMessage(input)).pipe(
    Effect.as(EMPTY_LIST_BRANCH_LOOKUP_RESULT)
  )
}

export const logListBranchLookupWarnings = Effect.fn('logListBranchLookupWarnings')(
  function* (input: {
    cwd: string
    remoteBranchResult: { code: number; stderr: string }
    remoteNamesResult: { code: number; stderr: string }
  }) {
    if (input.remoteBranchResult.code !== 0 && input.remoteBranchResult.stderr.trim().length > 0) {
      yield* Effect.logWarning(
        `GitCore.listBranches: remote branch lookup returned code ${input.remoteBranchResult.code} for ${input.cwd}: ${input.remoteBranchResult.stderr.trim()}. Falling back to an empty remote branch list.`
      )
    }
    if (input.remoteNamesResult.code !== 0 && input.remoteNamesResult.stderr.trim().length > 0) {
      yield* Effect.logWarning(
        `GitCore.listBranches: remote name lookup returned code ${input.remoteNamesResult.code} for ${input.cwd}: ${input.remoteNamesResult.stderr.trim()}. Falling back to an empty remote name list.`
      )
    }
  }
)

export const readWorktreeMap = Effect.fn('readWorktreeMap')(function* (
  fileSystem: FileSystem.FileSystem,
  stdout: string
) {
  const worktreeMap = new Map<string, string>()
  let currentPath: string | null = null

  for (const line of stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      const candidatePath = line.slice('worktree '.length)
      const exists = yield* fileSystem.stat(candidatePath).pipe(
        Effect.map(() => true),
        Effect.catch(() => Effect.succeed(false))
      )
      currentPath = exists ? candidatePath : null
      continue
    }
    if (line.startsWith('branch refs/heads/') && currentPath) {
      worktreeMap.set(line.slice('branch refs/heads/'.length), currentPath)
      continue
    }
    if (line === '') {
      currentPath = null
    }
  }

  return worktreeMap
})

export function deriveLocalBranchNameFromRemoteRef(branchName: string): string | null {
  const separatorIndex = branchName.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === branchName.length - 1) {
    return null
  }
  const localBranch = branchName.slice(separatorIndex + 1).trim()
  return localBranch.length > 0 ? localBranch : null
}

export function commandLabel(args: readonly string[]): string {
  return `git ${args.join(' ')}`
}

export function parseDefaultBranchFromRemoteHeadRef(
  value: string,
  remoteName: string
): string | null {
  const trimmed = value.trim()
  const prefix = `refs/remotes/${remoteName}/`
  if (!trimmed.startsWith(prefix)) {
    return null
  }
  const branch = trimmed.slice(prefix.length).trim()
  return branch.length > 0 ? branch : null
}

export function createGitCommandError(
  operation: string,
  cwd: string,
  args: readonly string[],
  detail: string,
  cause?: unknown
): GitCommandError {
  return new GitCommandError({
    operation,
    command: commandLabel(args),
    cwd,
    detail,
    ...(cause !== undefined ? { cause } : {}),
  })
}
