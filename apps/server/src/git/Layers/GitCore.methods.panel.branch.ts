import { Effect } from 'effect'

import type { GitCoreInternalDeps } from './GitCore.deps.ts'
import type {
  GitDiffFile,
  GitDiffFileStatus,
  GitDiffHunk,
  GitDiffLine,
  GitDiffScopeSummary,
} from '@orxa-code/contracts'

interface RawFilePatch {
  path: string
  oldPath: string | undefined
  status: GitDiffFileStatus
  isBinary: boolean
  patch: string
  hunks: GitDiffHunk[]
  additions: number
  deletions: number
}

function parseDiffLines(lines: string[]): GitDiffLine[] {
  const result: GitDiffLine[] = []
  let oldNum = 0
  let newNum = 0
  for (const line of lines) {
    const ch = line[0]
    if (ch === '-') {
      result.push({ type: 'del', content: line.slice(1), oldLineNumber: oldNum })
      oldNum++
    } else if (ch === '+') {
      result.push({ type: 'add', content: line.slice(1), newLineNumber: newNum })
      newNum++
    } else {
      result.push({
        type: 'context',
        content: ch === '\\' ? line : line.slice(1),
        oldLineNumber: oldNum,
        newLineNumber: newNum,
      })
      oldNum++
      newNum++
    }
  }
  return result
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/

function parseHunks(lines: string[]): GitDiffHunk[] {
  const hunks: GitDiffHunk[] = []
  let i = 0
  while (i < lines.length) {
    const m = HUNK_HEADER_RE.exec(lines[i]!)
    if (!m) {
      i++
      continue
    }
    const oldStart = parseInt(m[1]!, 10)
    const oldLines = m[2] !== undefined ? parseInt(m[2]!, 10) : 1
    const newStart = parseInt(m[3]!, 10)
    const newLines = m[4] !== undefined ? parseInt(m[4]!, 10) : 1
    const header = lines[i]!
    i++
    const bodyLines: string[] = []
    while (i < lines.length && !lines[i]!.startsWith('@@') && !lines[i]!.startsWith('diff ')) {
      bodyLines.push(lines[i]!)
      i++
    }
    const parsedLines = parseDiffLines(bodyLines)
    hunks.push({ oldStart, oldLines, newStart, newLines, header, lines: parsedLines })
  }
  return hunks
}

function inferPatchStatus(status: GitDiffFileStatus, line: string): GitDiffFileStatus {
  if (line.startsWith('rename from ')) return 'R'
  if (line.startsWith('new file mode')) return 'A'
  if (line.startsWith('deleted file mode')) return 'D'
  if (line.startsWith('copy from ')) return 'C'
  return status
}

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

function parsePatchText(text: string): Map<string, RawFilePatch> {
  const files = new Map<string, RawFilePatch>()
  if (!text.trim()) return files

  const blocks = text.split(/^(?=diff --git )/m)
  for (const block of blocks) {
    if (!block.startsWith('diff --git ')) continue
    const lines = block.split('\n')
    const gitDiffLine = lines[0] ?? ''
    const headerMatch = /^diff --git a\/(.*?) b\/(.*)$/.exec(gitDiffLine)
    if (!headerMatch) continue

    let path = headerMatch[2] ?? ''
    let oldPath: string | undefined
    let status: GitDiffFileStatus = 'M'
    const isBinary = block.includes('Binary files ')

    for (const l of lines) {
      if (l.startsWith('rename from ')) {
        oldPath = l.slice('rename from '.length).trim()
      } else if (l.startsWith('rename to ')) {
        path = l.slice('rename to '.length).trim()
      } else if (l.startsWith('+++ b/')) {
        path = l.slice('+++ b/'.length).trim()
      }
      status = inferPatchStatus(status, l)
    }

    let hunkStart = 0
    for (let j = 0; j < lines.length; j++) {
      if (lines[j]!.startsWith('@@')) {
        hunkStart = j
        break
      }
    }

    const hunkLines = lines.slice(hunkStart)
    const hunks: RawFilePatch['hunks'] = isBinary ? [] : parseHunks(hunkLines)
    const patch = block.trimEnd()

    let additions = 0
    let deletions = 0
    for (const h of hunks) {
      for (const l of h.lines) {
        if (l.type === 'add') additions++
        else if (l.type === 'del') deletions++
      }
    }

    files.set(path, { path, oldPath, status, isBinary, patch, hunks, additions, deletions })
  }
  return files
}

function buildResolveBranchCompareBaseRef(deps: GitCoreInternalDeps) {
  return Effect.fn('GitCore.resolveBranchCompareBaseRef')(function* (
    cwd: string,
    branch: string
  ) {
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
    const primaryRemote = remoteNames.includes('origin') ? 'origin' : remoteNames[0] ?? null
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

    const patchText = yield* deps.runGitStdoutWithOptions(
      'GitCore.getDiff.branch',
      cwd,
      ['diff', `${baseRef}...HEAD`, '-U3'],
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
  branch:
    | {
        baseRef: string
        compareLabel: string
        files: ReadonlyArray<{ additions: number; deletions: number }>
      }
    | null
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
