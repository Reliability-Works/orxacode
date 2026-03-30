import { compactText, extractStringByKeys } from './text-utils'
import { formatTarget, toWorkspaceRelativePath } from './path-utils'

type PatchFileStat = {
  filePath: string
  additions: number
  deletions: number
}

export type ChangedFileDetail = {
  path: string
  type: 'modified' | 'added' | 'deleted'
  insertions?: number
  deletions?: number
  diff?: string
}

type MutablePatchFileDetail = {
  rawPath: string
  type: 'modified' | 'added' | 'deleted'
  lines: string[]
  additions: number
  deletions: number
}

type WriteFileSummary = {
  verb: 'Created' | 'Edited'
  summary: string
}

function normalizeTarget(target: string, workspaceDirectory?: string | null) {
  return toWorkspaceRelativePath(target, workspaceDirectory)
}

function toObjectRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null
  }
  return input as Record<string, unknown>
}

function isLikelyPatchText(value: string) {
  return /(?:\*\*\*\s+(?:Begin Patch|Update|Add|Delete)\s+File:|diff --git\s+a\/|@@)/.test(value)
}

function extractPatchText(input: unknown, output: unknown) {
  const candidates: string[] = []
  if (typeof input === 'string' && input.trim()) {
    candidates.push(input)
  }
  const nestedPatchText = extractStringByKeys(input, [
    'patch',
    'content',
    'text',
    'diff',
    'cmd',
    'command',
  ])
  if (nestedPatchText) {
    candidates.push(nestedPatchText)
  }
  if (typeof output === 'string' && output.trim()) {
    candidates.push(output)
  }
  const nestedOutputPatchText = extractStringByKeys(output, [
    'patch',
    'content',
    'text',
    'diff',
    'cmd',
    'command',
  ])
  if (nestedOutputPatchText) {
    candidates.push(nestedOutputPatchText)
  }
  return candidates.find(candidate => isLikelyPatchText(candidate)) ?? null
}

function parsePatchFileStats(
  patchText: string,
  workspaceDirectory?: string | null
): PatchFileStat[] {
  const lines = patchText.split(/\r?\n/)
  const stats = new Map<string, PatchFileStat>()
  let currentFilePath: string | null = null

  const normalizePath = (rawPath: string) => {
    const cleaned = rawPath.trim().replace(/^a\//, '').replace(/^b\//, '')
    return normalizeTarget(cleaned, workspaceDirectory)
  }

  const startFile = (rawPath: string) => {
    const nextPath = normalizePath(rawPath)
    if (!nextPath) {
      return
    }
    if (currentFilePath === nextPath) {
      return
    }
    currentFilePath = nextPath
    if (!stats.has(nextPath)) {
      stats.set(nextPath, { filePath: nextPath, additions: 0, deletions: 0 })
    }
  }

  for (const line of lines) {
    const applyPatchMatch = line.match(/^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$/i)
    if (applyPatchMatch?.[1]) {
      startFile(applyPatchMatch[1])
      continue
    }
    const gitDiffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (gitDiffMatch?.[2]) {
      startFile(gitDiffMatch[2])
      continue
    }
    const plusPlusPlusMatch = line.match(/^\+\+\+\s+(.+)$/)
    if (plusPlusPlusMatch?.[1] && plusPlusPlusMatch[1] !== '/dev/null') {
      startFile(plusPlusPlusMatch[1])
      continue
    }
    if (!currentFilePath) {
      continue
    }
    const active = stats.get(currentFilePath)
    if (!active) {
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      active.additions += 1
      continue
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      active.deletions += 1
    }
  }
  return [...stats.values()]
}

function parsePatchFileDetails(
  patchText: string,
  workspaceDirectory?: string | null
): ChangedFileDetail[] {
  const lines = patchText.split(/\r?\n/)
  const details: ChangedFileDetail[] = []
  let current: MutablePatchFileDetail | null = null

  const flush = () => {
    if (!current) {
      return
    }
    const path = normalizeTarget(current.rawPath, workspaceDirectory)
    if (!path) {
      current = null
      return
    }
    const diff = current.lines.join('\n').trim()
    details.push({
      path,
      type: current.type,
      insertions: current.additions,
      deletions: current.deletions,
      diff: diff.length > 0 ? diff : undefined,
    })
    current = null
  }

  const start = (rawPath: string, type: 'modified' | 'added' | 'deleted', firstLine?: string) => {
    flush()
    current = {
      rawPath,
      type,
      lines: firstLine ? [firstLine] : [],
      additions: 0,
      deletions: 0,
    }
  }

  for (const line of lines) {
    const applyPatchMatch = line.match(/^\*\*\*\s+(Update|Add|Delete)\s+File:\s+(.+)$/i)
    if (applyPatchMatch?.[2]) {
      const action = (applyPatchMatch[1] ?? 'Update').toLowerCase()
      start(
        applyPatchMatch[2],
        action === 'add' ? 'added' : action === 'delete' ? 'deleted' : 'modified',
        line
      )
      continue
    }

    const gitDiffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (gitDiffMatch?.[2]) {
      start(gitDiffMatch[2], 'modified', line)
      continue
    }

    const active = current as MutablePatchFileDetail | null
    if (!active) {
      continue
    }

    active.lines.push(line)

    if (line.startsWith('+++ /dev/null')) {
      active.type = 'deleted'
      continue
    }
    if (line.startsWith('--- /dev/null')) {
      active.type = 'added'
      continue
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      active.additions += 1
      continue
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      active.deletions += 1
    }
  }

  flush()
  return details
}

function summarizePatchFileStats(stats: PatchFileStat[]) {
  if (stats.length === 0) {
    return null
  }
  const [first] = stats
  const base = `${compactText(first.filePath, 96)} +${first.additions} | -${first.deletions}`
  if (stats.length === 1) {
    return base
  }
  return `${base} (+${stats.length - 1} more file${stats.length - 1 === 1 ? '' : 's'})`
}

function countContentLines(value: string) {
  const normalized = value.replace(/\r/g, '')
  if (!normalized) {
    return 0
  }
  return normalized.split('\n').length
}

function collectMetadataFileDiffStats(
  value: unknown,
  workspaceDirectory: string | null | undefined,
  depth = 0
): PatchFileStat[] {
  if (!value || depth > 4) {
    return []
  }
  const toStat = (record: Record<string, unknown>): PatchFileStat | null => {
    const rawFile = ['file', 'filepath', 'filePath', 'path']
      .map(key => record[key])
      .find((item): item is string => typeof item === 'string' && item.trim().length > 0)
    if (!rawFile) {
      return null
    }
    const additionsRaw = ['additions', 'added', 'insertions']
      .map(key => record[key])
      .find(item => typeof item === 'number')
    const deletionsRaw = ['deletions', 'removed', 'removals']
      .map(key => record[key])
      .find(item => typeof item === 'number')
    return {
      filePath: normalizeTarget(rawFile, workspaceDirectory),
      additions: typeof additionsRaw === 'number' ? Math.max(0, Math.round(additionsRaw)) : 0,
      deletions: typeof deletionsRaw === 'number' ? Math.max(0, Math.round(deletionsRaw)) : 0,
    }
  }

  if (Array.isArray(value)) {
    return value.flatMap(entry =>
      collectMetadataFileDiffStats(entry, workspaceDirectory, depth + 1)
    )
  }
  if (typeof value !== 'object') {
    return []
  }
  const record = value as Record<string, unknown>
  const found: PatchFileStat[] = []
  const direct = toStat(record)
  if (direct) {
    found.push(direct)
  }
  for (const nestedKey of [
    'filediff',
    'filediffs',
    'files',
    'changes',
    'diff',
    'result',
    'output',
    'metadata',
  ]) {
    if (nestedKey in record) {
      found.push(...collectMetadataFileDiffStats(record[nestedKey], workspaceDirectory, depth + 1))
    }
  }
  return found
}

function collectMetadataFileDiffDetails(
  value: unknown,
  workspaceDirectory: string | null | undefined,
  depth = 0
): ChangedFileDetail[] {
  return collectMetadataFileDiffStats(value, workspaceDirectory, depth).map(stat => ({
    path: stat.filePath,
    type: 'modified',
    insertions: stat.additions,
    deletions: stat.deletions,
  }))
}

export function extractMetaFileDiffSummary(metadata: unknown, workspaceDirectory?: string | null) {
  const stats = collectMetadataFileDiffStats(metadata, workspaceDirectory)
  if (stats.length === 0) {
    return null
  }
  const merged = new Map<string, PatchFileStat>()
  for (const stat of stats) {
    const existing = merged.get(stat.filePath)
    if (!existing) {
      merged.set(stat.filePath, { ...stat })
      continue
    }
    existing.additions += stat.additions
    existing.deletions += stat.deletions
  }
  return summarizePatchFileStats([...merged.values()])
}

export function extractMetaFileDiffDetails(metadata: unknown, workspaceDirectory?: string | null) {
  const entries = collectMetadataFileDiffDetails(metadata, workspaceDirectory)
  if (entries.length === 0) {
    return []
  }
  const merged = new Map<string, ChangedFileDetail>()
  for (const entry of entries) {
    const existing = merged.get(entry.path)
    if (!existing) {
      merged.set(entry.path, { ...entry })
      continue
    }
    existing.insertions = (existing.insertions ?? 0) + (entry.insertions ?? 0)
    existing.deletions = (existing.deletions ?? 0) + (entry.deletions ?? 0)
  }
  return [...merged.values()]
}

export function extractWriteFileSummary(
  input: unknown,
  metadata: unknown,
  workspaceDirectory?: string | null
): WriteFileSummary | null {
  const inputRecord = toObjectRecord(input)
  const metadataRecord = toObjectRecord(metadata)
  const filepath =
    (metadataRecord && typeof metadataRecord.filepath === 'string'
      ? metadataRecord.filepath
      : undefined) ??
    (inputRecord && typeof inputRecord.filePath === 'string' ? inputRecord.filePath : undefined) ??
    (inputRecord && typeof inputRecord.path === 'string' ? inputRecord.path : undefined)
  if (!filepath) {
    return null
  }
  const exists =
    metadataRecord && typeof metadataRecord.exists === 'boolean' ? metadataRecord.exists : undefined
  const target = formatTarget(filepath, workspaceDirectory, 96)
  if (exists === false) {
    const content =
      inputRecord && typeof inputRecord.content === 'string' ? inputRecord.content : ''
    const additions = countContentLines(content)
    return {
      verb: 'Created',
      summary: `${target} +${additions} | -0`,
    }
  }
  return {
    verb: 'Edited',
    summary: target,
  }
}

export function extractPatchSummary(
  input: unknown,
  output: unknown,
  workspaceDirectory?: string | null
) {
  const patchText = extractPatchText(input, output)
  if (!patchText) {
    return null
  }
  return summarizePatchFileStats(parsePatchFileStats(patchText, workspaceDirectory))
}

export function extractPatchFileDetails(
  input: unknown,
  output: unknown,
  workspaceDirectory?: string | null
) {
  const patchText = extractPatchText(input, output)
  if (!patchText) {
    return []
  }
  return parsePatchFileDetails(patchText, workspaceDirectory)
}

export function extractWriteFileDetail(
  input: unknown,
  metadata: unknown,
  workspaceDirectory?: string | null
): ChangedFileDetail | null {
  const inputRecord = toObjectRecord(input)
  const metadataRecord = toObjectRecord(metadata)
  const filepath =
    (metadataRecord && typeof metadataRecord.filepath === 'string'
      ? metadataRecord.filepath
      : undefined) ??
    (inputRecord && typeof inputRecord.filePath === 'string' ? inputRecord.filePath : undefined) ??
    (inputRecord && typeof inputRecord.path === 'string' ? inputRecord.path : undefined)
  if (!filepath) {
    return null
  }
  const exists =
    metadataRecord && typeof metadataRecord.exists === 'boolean' ? metadataRecord.exists : undefined
  const content = inputRecord && typeof inputRecord.content === 'string' ? inputRecord.content : ''
  const path = normalizeTarget(filepath, workspaceDirectory)
  if (!path) {
    return null
  }
  if (exists === false) {
    return {
      path,
      type: 'added',
      insertions: countContentLines(content),
      deletions: 0,
    }
  }
  return {
    path,
    type: 'modified',
  }
}

export function mergeChangedFileDetails(...sources: ChangedFileDetail[][]) {
  const merged = new Map<string, ChangedFileDetail>()
  for (const source of sources) {
    for (const entry of source) {
      const key = entry.path
      const existing = merged.get(key)
      if (!existing) {
        merged.set(key, { ...entry })
        continue
      }
      existing.type = existing.type === 'modified' ? entry.type : existing.type
      existing.insertions = entry.insertions ?? existing.insertions
      existing.deletions = entry.deletions ?? existing.deletions
      existing.diff = existing.diff ?? entry.diff
    }
  }
  return [...merged.values()]
}
