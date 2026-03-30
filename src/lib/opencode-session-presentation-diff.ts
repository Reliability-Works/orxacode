import type { FileDiff } from '@opencode-ai/sdk/v2/client'
import type { ChangeProvenanceRecord } from '@shared/ipc'
import type { UnifiedTimelineRenderRow } from '../components/chat/unified-timeline-model'
import type { SessionDiffLookup } from './opencode-session-presentation-types'

function normalizeFileLookupPath(value: string) {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
}

function buildPseudoUnifiedDiff(diff: FileDiff) {
  const beforeLines = diff.before.split('\n')
  const afterLines = diff.after.split('\n')

  let prefix = 0
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1
  }

  let beforeEnd = beforeLines.length - 1
  let afterEnd = afterLines.length - 1
  while (
    beforeEnd >= prefix &&
    afterEnd >= prefix &&
    beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1
    afterEnd -= 1
  }

  const removedLines = beforeLines.slice(prefix, beforeEnd + 1)
  const addedLines = afterLines.slice(prefix, afterEnd + 1)

  if (removedLines.length === 0 && addedLines.length === 0) {
    return ''
  }

  const contextSize = 3
  const contextStart = Math.max(0, prefix - contextSize)
  const contextEnd = Math.min(afterLines.length, afterEnd + 1 + contextSize)
  const contextBefore = beforeLines.slice(contextStart, prefix)
  const contextAfter = afterLines.slice(afterEnd + 1, contextEnd)

  const oldStart = contextStart + 1
  const oldCount = contextBefore.length + removedLines.length + contextAfter.length
  const newStart = contextStart + 1
  const newCount = contextBefore.length + addedLines.length + contextAfter.length

  const lines = [
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
    ...contextBefore.map(line => ` ${line}`),
    ...removedLines.map(line => `-${line}`),
    ...addedLines.map(line => `+${line}`),
    ...contextAfter.map(line => ` ${line}`),
  ]
  return lines.join('\n')
}

export function buildSessionDiffLookup(sessionDiff?: FileDiff[]): SessionDiffLookup | null {
  if (!sessionDiff || sessionDiff.length === 0) {
    return null
  }
  const byPath = new Map<string, FileDiff[]>()
  const register = (map: Map<string, FileDiff[]>, key: string, file: FileDiff) => {
    const normalized = normalizeFileLookupPath(key)
    if (!normalized) {
      return
    }
    const existing = map.get(normalized)
    if (existing) {
      existing.push(file)
    } else {
      map.set(normalized, [file])
    }
  }

  for (const file of sessionDiff) {
    register(byPath, file.file, file)
  }

  return { all: sessionDiff, byPath }
}

export function resolveSessionDiffEntry(path: string, lookup: SessionDiffLookup | null) {
  if (!lookup) {
    return null
  }
  const normalized = normalizeFileLookupPath(path)
  const exact = lookup.byPath.get(normalized)
  if (exact?.length === 1) {
    return exact[0]
  }
  if (exact && exact.length > 1) {
    return exact[exact.length - 1] ?? null
  }

  const suffixMatches = lookup.all.filter(file => {
    const candidatePath = normalizeFileLookupPath(file.file)
    return normalized.endsWith(`/${candidatePath}`) || candidatePath.endsWith(`/${normalized}`)
  })
  if (suffixMatches.length === 1) {
    return suffixMatches[0] ?? null
  }

  return null
}

function isLikelyDirectoryPlaceholderPath(path: string, lookup: SessionDiffLookup | null) {
  const normalized = normalizeFileLookupPath(path)
  if (!normalized) {
    return true
  }
  if (resolveSessionDiffEntry(normalized, lookup)) {
    return false
  }
  const basename = normalized.split('/').pop() ?? normalized
  if (normalized.includes('/')) {
    return false
  }
  if (basename.includes('.')) {
    return false
  }
  const extensionlessFileNames = new Set([
    'Dockerfile',
    'Makefile',
    'Procfile',
    'Gemfile',
    'Rakefile',
    'README',
    'LICENSE',
  ])
  return !extensionlessFileNames.has(basename)
}

export function hydrateChangedFilesWithSessionDiff(
  files: Array<Extract<UnifiedTimelineRenderRow, { kind: 'diff' }>>,
  lookup: SessionDiffLookup | null
) {
  return files
    .filter(file => !isLikelyDirectoryPlaceholderPath(file.path, lookup))
    .map(file => {
      const match = resolveSessionDiffEntry(file.path, lookup)
      if (!match) {
        return file
      }

      const hasMeaningfulOwnStats = (file.insertions ?? 0) > 0 || (file.deletions ?? 0) > 0
      const shouldPreferSessionDiffStats = !file.diff && !hasMeaningfulOwnStats

      return {
        ...file,
        diff: file.diff ?? buildPseudoUnifiedDiff(match),
        insertions: shouldPreferSessionDiffStats ? match.additions : (file.insertions ?? match.additions),
        deletions: shouldPreferSessionDiffStats ? match.deletions : (file.deletions ?? match.deletions),
        type: file.type || match.status || 'modified',
      }
    })
}

export function mapProvenanceOperationToDiffType(operation: ChangeProvenanceRecord['operation']) {
  if (operation === 'create') {
    return 'added'
  }
  if (operation === 'delete') {
    return 'deleted'
  }
  return 'edited'
}

export function dedupeChangedFiles(files: Array<Extract<UnifiedTimelineRenderRow, { kind: 'diff' }>>) {
  const seen = new Set<string>()
  return files.filter(file => {
    const key = `${file.type}:${file.path}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function buildChangedFilesFromProvenance(
  records: ChangeProvenanceRecord[],
  lookup: SessionDiffLookup | null
) {
  const latestByPath = new Map<string, ChangeProvenanceRecord>()
  for (const record of records) {
    const existing = latestByPath.get(record.filePath)
    if (!existing || existing.timestamp <= record.timestamp) {
      latestByPath.set(record.filePath, record)
    }
  }
  return hydrateChangedFilesWithSessionDiff(
    [...latestByPath.values()]
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
      .map((record, index) => ({
        id: `provenance:${record.eventID}:${index}`,
        kind: 'diff' as const,
        path: record.filePath,
        type: mapProvenanceOperationToDiffType(record.operation),
      })),
    lookup
  )
}

export function buildProvenanceByTurn(records: ChangeProvenanceRecord[]) {
  const grouped = new Map<string, ChangeProvenanceRecord[]>()
  for (const record of records) {
    if (!record.turnID) {
      continue
    }
    const existing = grouped.get(record.turnID)
    if (existing) {
      existing.push(record)
    } else {
      grouped.set(record.turnID, [record])
    }
  }
  return grouped
}
