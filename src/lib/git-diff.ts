export type GitDiffSection = 'unstaged' | 'staged'
export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed'
export type GitStatusFile = {
  key: string
  path: string
  oldPath?: string
  status: GitFileStatus
}

type ParsedDiffChunk = {
  section: GitDiffSection
  path: string
  oldPath?: string
  status: GitFileStatus
  added: number
  removed: number
  lines: string[]
}

export type GitDiffFile = {
  key: string
  path: string
  oldPath?: string
  status: GitFileStatus
  added: number
  removed: number
  hasUnstaged: boolean
  hasStaged: boolean
  diffLines: string[]
  unstagedDiffLines?: string[]
  stagedDiffLines?: string[]
}

export type GitDiffViewSection = {
  key: string
  label: string
  patch: string
}

function mergeDiffLines(existing: string[] | undefined, next: string[]) {
  if (!existing || existing.length === 0) {
    return [...next]
  }
  if (next.length === 0) {
    return [...existing]
  }
  if (existing[existing.length - 1] === '' || next[0] === '') {
    return [...existing, ...next]
  }
  return [...existing, '', ...next]
}

function toPatch(lines: string[]) {
  if (lines.length === 0) {
    return ''
  }
  return lines.join('\n')
}

function statusPriority(status: GitFileStatus) {
  if (status === 'renamed') {
    return 4
  }
  if (status === 'deleted') {
    return 3
  }
  if (status === 'added') {
    return 2
  }
  return 1
}

export function inferStatusTag(status: GitFileStatus) {
  if (status === 'added') {
    return 'A'
  }
  if (status === 'deleted') {
    return 'D'
  }
  if (status === 'renamed') {
    return 'R'
  }
  return 'M'
}

function normalizeStatusPath(pathValue: string) {
  const trimmed = pathValue.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function inferStatusFromPorcelainCode(code: string): GitFileStatus {
  if (code === 'A' || code === '?') {
    return 'added'
  }
  if (code === 'D') {
    return 'deleted'
  }
  if (code === 'R') {
    return 'renamed'
  }
  return 'modified'
}

function parseGitStatusEntry(line: string): GitStatusFile | null {
  if (line.startsWith('?? ')) {
    const path = normalizeStatusPath(line.slice(3))
    return path ? { key: path, path, status: 'added' } : null
  }
  if (line.length < 4) {
    return null
  }

  const xy = line.slice(0, 2)
  const pathPart = line.slice(3).trim()
  if (!pathPart) {
    return null
  }

  const significantCode = (xy[0] && xy[0] !== ' ' ? xy[0] : xy[1]) || 'M'
  const status = inferStatusFromPorcelainCode(significantCode)

  if ((status === 'renamed' || significantCode === 'C') && pathPart.includes(' -> ')) {
    const [oldPathRaw, newPathRaw] = pathPart.split(/\s+->\s+/, 2)
    const oldPath = normalizeStatusPath(oldPathRaw ?? '')
    const path = normalizeStatusPath(newPathRaw ?? '')
    if (!path) {
      return null
    }
    return {
      key: oldPath ? `${oldPath}->${path}` : path,
      path,
      oldPath: oldPath || undefined,
      status: significantCode === 'C' ? 'added' : 'renamed',
    }
  }

  const path = normalizeStatusPath(pathPart)
  return path ? { key: path, path, status } : null
}

function buildParsedDiffChunks(lines: string[]) {
  const chunks: ParsedDiffChunk[] = []
  let section: GitDiffSection = 'unstaged'
  let current: ParsedDiffChunk | null = null

  const flushCurrent = () => {
    if (current) {
      chunks.push(current)
      current = null
    }
  }

  for (const line of lines) {
    if (line === '## Unstaged' || line === '## Untracked') {
      flushCurrent()
      section = 'unstaged'
      continue
    }
    if (line === '## Staged') {
      flushCurrent()
      section = 'staged'
      continue
    }

    const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/)
    if (diffMatch) {
      flushCurrent()
      current = {
        section,
        path: diffMatch[2] ?? diffMatch[1] ?? '',
        oldPath: undefined,
        status: 'modified',
        added: 0,
        removed: 0,
        lines: [line],
      }
      continue
    }

    if (!current) {
      continue
    }

    current.lines.push(line)

    if (line.startsWith('new file mode ')) {
      current.status = 'added'
    } else if (line.startsWith('deleted file mode ')) {
      current.status = 'deleted'
    } else if (line.startsWith('rename from ')) {
      current.status = 'renamed'
      current.oldPath = line.replace('rename from ', '').trim()
    } else if (line.startsWith('rename to ')) {
      current.status = 'renamed'
      current.path = line.replace('rename to ', '').trim()
    } else if (line.startsWith('--- /dev/null')) {
      current.status = 'added'
    } else if (line.startsWith('+++ /dev/null')) {
      current.status = 'deleted'
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      current.added += 1
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.removed += 1
    }
  }

  flushCurrent()
  return chunks
}

function mergeParsedDiffChunks(chunks: ParsedDiffChunk[]) {
  const grouped = new Map<string, GitDiffFile>()

  for (const chunk of chunks) {
    const key = chunk.oldPath ? `${chunk.oldPath}->${chunk.path}` : chunk.path
    const existing = grouped.get(key)
    const chunkLines = [...chunk.lines]
    const nextDiffLines = mergeDiffLines(existing?.diffLines, chunkLines)

    if (!existing) {
      grouped.set(key, {
        key,
        path: chunk.path,
        oldPath: chunk.oldPath,
        status: chunk.status,
        added: chunk.added,
        removed: chunk.removed,
        hasUnstaged: chunk.section === 'unstaged',
        hasStaged: chunk.section === 'staged',
        diffLines: nextDiffLines,
        unstagedDiffLines: chunk.section === 'unstaged' ? [...chunkLines] : undefined,
        stagedDiffLines: chunk.section === 'staged' ? [...chunkLines] : undefined,
      })
      continue
    }

    existing.added += chunk.added
    existing.removed += chunk.removed
    existing.hasUnstaged = existing.hasUnstaged || chunk.section === 'unstaged'
    existing.hasStaged = existing.hasStaged || chunk.section === 'staged'
    existing.diffLines = nextDiffLines
    if (chunk.section === 'unstaged') {
      existing.unstagedDiffLines = mergeDiffLines(existing.unstagedDiffLines, chunkLines)
    }
    if (chunk.section === 'staged') {
      existing.stagedDiffLines = mergeDiffLines(existing.stagedDiffLines, chunkLines)
    }

    if (statusPriority(chunk.status) > statusPriority(existing.status)) {
      existing.status = chunk.status
    }
    if (!existing.oldPath && chunk.oldPath) {
      existing.oldPath = chunk.oldPath
    }
    existing.path = chunk.path
  }

  return Array.from(grouped.values()).sort((left, right) => left.path.localeCompare(right.path))
}

export function parseGitStatusOutput(output: string): { files: GitStatusFile[]; message?: string } {
  const trimmed = output.trim()
  if (!trimmed) {
    return { files: [] }
  }
  if (trimmed === 'Not a git repository.') {
    return { files: [], message: trimmed }
  }

  const files = output
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(parseGitStatusEntry)
    .filter((file): file is GitStatusFile => Boolean(file))
  return { files }
}

export function parseGitDiffOutput(output: string): { files: GitDiffFile[]; message?: string } {
  if (!output.trim()) {
    return { files: [], message: 'No local changes.' }
  }
  if (output.startsWith('Loading diff')) {
    return { files: [], message: 'Loading diff...' }
  }
  if (output === 'No local changes.' || output === 'Not a git repository.') {
    return { files: [], message: output }
  }

  const chunks = buildParsedDiffChunks(output.split(/\r?\n/))
  if (chunks.length === 0) {
    return { files: [], message: output.trim() }
  }
  const files = mergeParsedDiffChunks(chunks)
  return { files }
}

export function toDiffSections(file: GitDiffFile | null): GitDiffViewSection[] {
  if (!file) {
    return []
  }
  const sections: GitDiffViewSection[] = []
  if (file.unstagedDiffLines && file.unstagedDiffLines.length > 0) {
    sections.push({
      key: `${file.key}:unstaged`,
      label: 'Unstaged',
      patch: toPatch(file.unstagedDiffLines),
    })
  }
  if (file.stagedDiffLines && file.stagedDiffLines.length > 0) {
    sections.push({
      key: `${file.key}:staged`,
      label: 'Staged',
      patch: toPatch(file.stagedDiffLines),
    })
  }
  if (sections.length === 0 && file.diffLines.length > 0) {
    sections.push({
      key: `${file.key}:diff`,
      label: 'Changes',
      patch: toPatch(file.diffLines),
    })
  }
  return sections
}
