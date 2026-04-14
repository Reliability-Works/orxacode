import { Effect } from 'effect'

import type { GitCoreInternalDeps } from './GitCore.deps.ts'
import type { GitDiffFile, GitDiffScopeSummary } from '@orxa-code/contracts'
import { parsePatchText, type RawFilePatch } from './GitCore.methods.panel.patch.ts'

function parseRemoteNames(stdout: string): string[] {
  return stdout
    .split(/\r?\n/g)
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

function parseSymbolicRefTarget(stdout: string): string | null {
  const trimmed = stdout.trim()
  if (trimmed.length === 0) return null
  const prefix = 'refs/remotes/'
  if (!trimmed.startsWith(prefix)) return trimmed
  const remainder = trimmed.slice(prefix.length)
  const slash = remainder.indexOf('/')
  if (slash <= 0) return null
  const remoteName = remainder.slice(0, slash).trim()
  const branchName = remainder.slice(slash + 1).trim()
  if (remoteName.length === 0 || branchName.length === 0) return null
  return `${remoteName}/${branchName}`
}

function buildScopeSummary(input: {
  scope: 'unstaged' | 'staged' | 'branch'
  label: string
  files: ReadonlyArray<{ additions: number; deletions: number }>
  available: boolean
  baseRef: string | null
  compareLabel: string | null
}): GitDiffScopeSummary {
  let additions = 0
  let deletions = 0
  for (const file of input.files) {
    additions += file.additions
    deletions += file.deletions
  }
  return {
    scope: input.scope,
    label: input.label,
    available: input.available,
    additions,
    deletions,
    fileCount: input.files.length,
    baseRef: input.baseRef,
    compareLabel: input.compareLabel,
  }
}

function toCompareFile(raw: RawFilePatch): GitDiffFile {
  return {
    path: raw.path,
    ...(raw.oldPath ? { oldPath: raw.oldPath } : {}),
    status: raw.status,
    section: 'branch',
    isBinary: raw.isBinary,
    patch: raw.patch,
    hunks: raw.hunks,
    additions: raw.additions,
    deletions: raw.deletions,
  }
}

function buildResolveBranchCompareBaseRef(deps: GitCoreInternalDeps) {
  return Effect.fn('GitCore.resolveBranchCompareBaseRef')(function* (cwd: string, branch: string) {
    const upstreamRef = yield* deps
      .runGitStdout(
        'GitCore.resolveBranchCompareBaseRef.upstream',
        cwd,
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
        true
      )
      .pipe(Effect.map(stdout => stdout.trim()))
    if (upstreamRef.length > 0 && upstreamRef !== '@{upstream}') {
      return upstreamRef
    }

    const configuredBase = yield* deps
      .runGitStdout(
        'GitCore.resolveBranchCompareBaseRef.configured',
        cwd,
        ['config', '--get', `branch.${branch}.gh-merge-base`],
        true
      )
      .pipe(Effect.map(stdout => stdout.trim()))
    if (configuredBase.length > 0) {
      return configuredBase
    }

    const remoteNames = yield* deps
      .runGitStdout('GitCore.resolveBranchCompareBaseRef.remotes', cwd, ['remote'], true)
      .pipe(Effect.map(parseRemoteNames))
    const primaryRemote = remoteNames.includes('origin') ? 'origin' : (remoteNames[0] ?? null)
    if (!primaryRemote) return null

    const remoteHead = yield* deps
      .runGitStdout(
        'GitCore.resolveBranchCompareBaseRef.remoteHead',
        cwd,
        ['symbolic-ref', `refs/remotes/${primaryRemote}/HEAD`],
        true
      )
      .pipe(Effect.map(stdout => parseSymbolicRefTarget(stdout)))
    if (!remoteHead) return null
    return remoteHead
  })
}

export function buildBranchCompareResult(deps: GitCoreInternalDeps) {
  const resolveBaseRef = buildResolveBranchCompareBaseRef(deps)
  return Effect.fn('GitCore.buildBranchCompareResult')(function* (cwd: string, branch: string) {
    const baseRef = yield* resolveBaseRef(cwd, branch)
    if (!baseRef) return null

    // Diff the working tree (including staged + unstaged + committed changes)
    // against the upstream base. Previously this used `base...HEAD` (three-dot)
    // which only surfaces committed divergence and returns 0 when HEAD matches
    // the upstream — even when there are uncommitted edits on the branch. For
    // the sidebar, "Branch" should always include everything that diverges
    // from the upstream, so it's at least >= Unstaged.
    const patchText = yield* deps.runGitStdoutWithOptions(
      'GitCore.getDiff.branch',
      cwd,
      ['diff', baseRef, '-U3'],
      { allowNonZeroExit: true }
    )

    const rawFiles = Array.from(parsePatchText(patchText).values())
    const files = rawFiles.map(toCompareFile)
    let additions = 0
    let deletions = 0
    for (const file of files) {
      additions += file.additions
      deletions += file.deletions
    }

    return {
      headRef: branch,
      baseRef,
      compareLabel: `${branch} -> ${baseRef}`,
      files,
      additions,
      deletions,
    } satisfies {
      headRef: string
      baseRef: string
      compareLabel: string
      files: GitDiffFile[]
      additions: number
      deletions: number
    }
  })
}

export function makeScopeSummaries(input: {
  unstaged: ReadonlyArray<{ additions: number; deletions: number }>
  untracked?: ReadonlyArray<{ additions: number; deletions: number }>
  staged: ReadonlyArray<{ additions: number; deletions: number }>
  branch: {
    baseRef: string
    compareLabel: string
    files: ReadonlyArray<{ additions: number; deletions: number }>
  } | null
}): GitDiffScopeSummary[] {
  return [
    buildScopeSummary({
      scope: 'unstaged',
      label: 'Unstaged',
      files: input.unstaged,
      available: true,
      baseRef: null,
      compareLabel: null,
    }),
    buildScopeSummary({
      scope: 'staged',
      label: 'Staged',
      files: input.staged,
      available: true,
      baseRef: null,
      compareLabel: null,
    }),
    buildScopeSummary({
      scope: 'branch',
      label: 'Branch',
      files: input.branch?.files ?? [],
      available: input.branch !== null,
      baseRef: input.branch?.baseRef ?? null,
      compareLabel: input.branch?.compareLabel ?? null,
    }),
  ]
}
