/**
 * GitCore panel methods — diff, log, stage/unstage/restore per-path.
 *
 * Used by the right-side Git sidebar surface.
 *
 * @module GitCore.methods.panel
 */
import { Effect } from 'effect'

import type {
  GitDiffFile,
  GitDiffFileStatus,
  GitDiffHunk,
  GitDiffLine,
  GitDiffResult,
  GitDiffSectionKind,
  GitGetLogResult,
  GitLogEntry,
} from '@orxa-code/contracts'
import type { GitCoreShape } from '../Services/GitCore.ts'
import type { GitCoreInternalDeps } from './GitCore.deps.ts'

// ── Unified-diff parser ──────────────────────────────────────────────

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

interface RawFilePatch {
  path: string
  oldPath: string | undefined
  isBinary: boolean
  patch: string
  hunks: GitDiffHunk[]
  additions: number
  deletions: number
}

function parsePatchText(text: string): Map<string, RawFilePatch> {
  const files = new Map<string, RawFilePatch>()
  if (!text.trim()) return files

  // Split on "diff --git" blocks
  const blocks = text.split(/^(?=diff --git )/m)
  for (const block of blocks) {
    if (!block.startsWith('diff --git ')) continue
    const lines = block.split('\n')
    // Parse paths from "diff --git a/... b/..."
    const gitDiffLine = lines[0] ?? ''
    const headerMatch = /^diff --git a\/(.*?) b\/(.*)$/.exec(gitDiffLine)
    if (!headerMatch) continue

    let path = headerMatch[2] ?? ''
    let oldPath: string | undefined
    const isBinary = block.includes('Binary files ')

    // Check for rename
    for (const l of lines) {
      if (l.startsWith('rename from ')) {
        oldPath = l.slice('rename from '.length).trim()
      } else if (l.startsWith('rename to ')) {
        path = l.slice('rename to '.length).trim()
      } else if (l.startsWith('+++ b/')) {
        path = l.slice('+++ b/'.length).trim()
      }
    }

    // Find hunk body (lines after --- / +++, starting from @@)
    let hunkStart = 0
    for (let j = 0; j < lines.length; j++) {
      if (lines[j]!.startsWith('@@')) {
        hunkStart = j
        break
      }
    }

    const hunkLines = lines.slice(hunkStart)
    const hunks = isBinary ? [] : parseHunks(hunkLines)
    const patch = hunkLines.join('\n')

    let additions = 0
    let deletions = 0
    for (const h of hunks) {
      for (const l of h.lines) {
        if (l.type === 'add') additions++
        else if (l.type === 'del') deletions++
      }
    }

    files.set(path, { path, oldPath, isBinary, patch, hunks, additions, deletions })
  }
  return files
}

// ── Porcelain parser ─────────────────────────────────────────────────

interface PorcelainEntry {
  xy: string
  path: string
  origPath: string | undefined
}

function parsePorcelain(text: string): PorcelainEntry[] {
  const entries: PorcelainEntry[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.length < 3) continue
    const xy = line.slice(0, 2)
    const rest = line.slice(3)
    const arrowIdx = rest.indexOf(' -> ')
    if (arrowIdx !== -1) {
      entries.push({ xy, path: rest.slice(arrowIdx + 4), origPath: rest.slice(0, arrowIdx) })
    } else {
      entries.push({ xy, path: rest, origPath: undefined })
    }
  }
  return entries
}

const XY_STATUS_MAP: Record<string, GitDiffFileStatus | undefined> = {
  M: 'M',
  A: 'A',
  D: 'D',
  R: 'R',
  C: 'C',
  U: 'U',
  '?': '?',
}

function toStatus(ch: string): GitDiffFileStatus {
  return XY_STATUS_MAP[ch] ?? 'M'
}

function buildDiffFiles(
  porcelain: PorcelainEntry[],
  stagedPatches: Map<string, RawFilePatch>,
  unstagedPatches: Map<string, RawFilePatch>
): { staged: GitDiffFile[]; unstaged: GitDiffFile[]; untracked: GitDiffFile[] } {
  const staged: GitDiffFile[] = []
  const unstaged: GitDiffFile[] = []
  const untracked: GitDiffFile[] = []

  for (const entry of porcelain) {
    const x = entry.xy[0] ?? ' '
    const y = entry.xy[1] ?? ' '
    const { path, origPath } = entry

    const empty: Omit<RawFilePatch, 'path' | 'oldPath'> = {
      isBinary: false,
      patch: '',
      hunks: [],
      additions: 0,
      deletions: 0,
    }

    if (x !== ' ' && x !== '?') {
      const raw = stagedPatches.get(path) ?? { ...empty, path, oldPath: origPath }
      const f: GitDiffFile = {
        path,
        status: toStatus(x),
        section: 'staged' as GitDiffSectionKind,
        isBinary: raw.isBinary,
        patch: raw.patch,
        hunks: raw.hunks,
        additions: raw.additions,
        deletions: raw.deletions,
        ...(origPath ? { oldPath: origPath } : {}),
      }
      staged.push(f)
    }

    if (y === '?') {
      const f: GitDiffFile = {
        path,
        status: '?' as GitDiffFileStatus,
        section: 'untracked' as GitDiffSectionKind,
        isBinary: false,
        patch: '',
        hunks: [],
        additions: 0,
        deletions: 0,
      }
      untracked.push(f)
    } else if (y !== ' ') {
      const raw = unstagedPatches.get(path) ?? { ...empty, path, oldPath: origPath }
      const f: GitDiffFile = {
        path,
        status: toStatus(y),
        section: 'unstaged' as GitDiffSectionKind,
        isBinary: raw.isBinary,
        patch: raw.patch,
        hunks: raw.hunks,
        additions: raw.additions,
        deletions: raw.deletions,
        ...(origPath ? { oldPath: origPath } : {}),
      }
      unstaged.push(f)
    }
  }

  return { staged, unstaged, untracked }
}

// ── Log parser ───────────────────────────────────────────────────────

const NUL = String.fromCodePoint(0)
const LOG_SEP = `${NUL}LOG_COMMIT_SEP${NUL}`
const LOG_FORMAT = `${LOG_SEP}%H%n%h%n%an%n%ae%n%aI%n%s%n%b${LOG_SEP}END`

function parseLogEntry(chunk: string): GitLogEntry | null {
  const parts = chunk.split('\n')
  const hash = parts[0]?.trim()
  const shortHash = parts[1]?.trim()
  const author = parts[2]?.trim()
  const email = parts[3]?.trim()
  const date = parts[4]?.trim()
  const subject = parts[5]?.trim()
  if (!hash || !shortHash || !author || !date || !subject) return null
  const body = parts.slice(6).join('\n').trim()
  return { hash, shortHash, author: author || 'Unknown', email: email ?? '', date, subject, body }
}

// ── Method implementations ───────────────────────────────────────────

function buildGetDiff(deps: GitCoreInternalDeps): GitCoreShape['getDiff'] {
  return input =>
    Effect.gen(function* () {
      const [statusText, stagedText, unstagedText] = yield* Effect.all([
        deps.runGitStdout('GitCore.getDiff.status', input.cwd, ['status', '--porcelain'], true),
        deps.runGitStdoutWithOptions(
          'GitCore.getDiff.staged',
          input.cwd,
          ['diff', '--cached', '-U3'],
          { allowNonZeroExit: true }
        ),
        deps.runGitStdoutWithOptions('GitCore.getDiff.unstaged', input.cwd, ['diff', '-U3'], {
          allowNonZeroExit: true,
        }),
      ])

      const porcelain = parsePorcelain(statusText)
      const stagedPatches = parsePatchText(stagedText)
      const unstagedPatches = parsePatchText(unstagedText)
      const { staged, unstaged, untracked } = buildDiffFiles(
        porcelain,
        stagedPatches,
        unstagedPatches
      )

      let totalAdditions = 0
      let totalDeletions = 0
      for (const f of [...staged, ...unstaged]) {
        totalAdditions += f.additions
        totalDeletions += f.deletions
      }

      return { staged, unstaged, untracked, totalAdditions, totalDeletions } satisfies GitDiffResult
    })
}

function buildGetLog(deps: GitCoreInternalDeps): GitCoreShape['getLog'] {
  return input =>
    Effect.gen(function* () {
      const limit = input.limit ?? 50
      const text = yield* deps.runGitStdout(
        'GitCore.getLog',
        input.cwd,
        ['log', `-n${limit}`, `--pretty=format:${LOG_FORMAT}`],
        true
      )

      const entries: GitLogEntry[] = []
      const chunks = text.split(LOG_SEP)
      for (const chunk of chunks) {
        const withoutPrefix = chunk.startsWith(`LOG_COMMIT_SEP${NUL}`)
          ? chunk.slice(`LOG_COMMIT_SEP${NUL}`.length)
          : chunk
        const trimmed = withoutPrefix.endsWith(`${NUL}END`)
          ? withoutPrefix.slice(0, -`${NUL}END`.length).trim()
          : withoutPrefix.trim()
        if (!trimmed || trimmed === 'END') continue
        const entry = parseLogEntry(trimmed)
        if (entry) entries.push(entry)
      }

      return { entries } satisfies GitGetLogResult
    })
}

function buildStagePath(deps: GitCoreInternalDeps): GitCoreShape['stagePath'] {
  return input => deps.runGit('GitCore.stagePath', input.cwd, ['add', '--', input.path])
}

function buildUnstagePath(deps: GitCoreInternalDeps): GitCoreShape['unstagePath'] {
  return input =>
    deps.runGit('GitCore.unstagePath', input.cwd, ['restore', '--staged', '--', input.path], true)
}

function buildRestorePath(deps: GitCoreInternalDeps): GitCoreShape['restorePath'] {
  return input => {
    const args = input.staged
      ? ['restore', '--staged', '--', input.path]
      : ['restore', '--', input.path]
    return deps.runGit('GitCore.restorePath', input.cwd, args, true)
  }
}

export function makePanelMethods(deps: GitCoreInternalDeps): {
  getDiff: GitCoreShape['getDiff']
  getLog: GitCoreShape['getLog']
  stagePath: GitCoreShape['stagePath']
  unstagePath: GitCoreShape['unstagePath']
  restorePath: GitCoreShape['restorePath']
} {
  return {
    getDiff: buildGetDiff(deps),
    getLog: buildGetLog(deps),
    stagePath: buildStagePath(deps),
    unstagePath: buildUnstagePath(deps),
    restorePath: buildRestorePath(deps),
  }
}
