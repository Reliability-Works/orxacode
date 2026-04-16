/**
 * Shared unified-diff synthesis used by every provider's per-tool-call
 * file-patch extractor. Each adapter normalizes its native file-change
 * payload into `ChangeMode` + before/after text, then calls
 * `buildUnifiedPatch` or `ensureUnifiedHeaders` to produce a patch string
 * the renderer can feed to `@pierre/diffs`.
 */

export type ChangeMode = 'edit' | 'create' | 'delete'

const ADD_KINDS = new Set(['add', 'added', 'create', 'created', 'new'])
const DELETE_KINDS = new Set(['delete', 'deleted', 'remove', 'removed'])

function splitLines(text: string): string[] {
  if (text.length === 0) return []
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  return body.split('\n')
}

export function classifyChangeMode(kind: string | null | undefined): ChangeMode {
  const normalized = kind?.toLowerCase() ?? ''
  if (ADD_KINDS.has(normalized)) return 'create'
  if (DELETE_KINDS.has(normalized)) return 'delete'
  return 'edit'
}

export function buildUnifiedPatch(
  path: string,
  beforeText: string,
  afterText: string,
  mode: ChangeMode
): string {
  const beforeLines = splitLines(beforeText)
  const afterLines = splitLines(afterText)
  const oldHeader = mode === 'create' ? '/dev/null' : `a/${path}`
  const newHeader = mode === 'delete' ? '/dev/null' : `b/${path}`
  const oldStart = beforeLines.length === 0 ? 0 : 1
  const newStart = afterLines.length === 0 ? 0 : 1
  const hunkHeader = `@@ -${oldStart},${beforeLines.length} +${newStart},${afterLines.length} @@`
  const bodyLines = [...beforeLines.map(line => `-${line}`), ...afterLines.map(line => `+${line}`)]
  return `${[`--- ${oldHeader}`, `+++ ${newHeader}`, hunkHeader, ...bodyLines].join('\n')}\n`
}

export function ensureUnifiedHeaders(diff: string, path: string, mode: ChangeMode): string {
  const trimmed = diff.trimStart()
  if (trimmed.startsWith('---') || trimmed.startsWith('diff ')) return diff
  const oldHeader = mode === 'create' ? '/dev/null' : `a/${path}`
  const newHeader = mode === 'delete' ? '/dev/null' : `b/${path}`
  const tail = diff.endsWith('\n') ? diff : `${diff}\n`
  return `--- ${oldHeader}\n+++ ${newHeader}\n${tail}`
}
