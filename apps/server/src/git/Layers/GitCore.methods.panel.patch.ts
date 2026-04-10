import type { GitDiffFileStatus, GitDiffHunk, GitDiffLine } from '@orxa-code/contracts'

export interface RawFilePatch {
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

export function parsePatchText(text: string): Map<string, RawFilePatch> {
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

    for (const line of lines) {
      if (line.startsWith('rename from ')) {
        oldPath = line.slice('rename from '.length).trim()
      } else if (line.startsWith('rename to ')) {
        path = line.slice('rename to '.length).trim()
      } else if (line.startsWith('+++ b/')) {
        path = line.slice('+++ b/'.length).trim()
      }
      status = inferPatchStatus(status, line)
    }

    let hunkStart = 0
    for (let j = 0; j < lines.length; j += 1) {
      if (lines[j]!.startsWith('@@')) {
        hunkStart = j
        break
      }
    }

    const hunks = isBinary ? [] : parseHunks(lines.slice(hunkStart))
    let additions = 0
    let deletions = 0
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') additions += 1
        else if (line.type === 'del') deletions += 1
      }
    }

    files.set(path, {
      path,
      oldPath,
      status,
      isBinary,
      patch: block.trimEnd(),
      hunks,
      additions,
      deletions,
    })
  }
  return files
}
