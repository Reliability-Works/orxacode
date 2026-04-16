/**
 * Per-tool-call file-patch extraction for the Codex adapter.
 *
 * Codex's `fileChange` item emits a `changes` map (or array) of per-file
 * entries. When the SDK provides a unified diff we pass it through; otherwise
 * we synthesize one from the before/after content so the renderer can show an
 * inline diff without re-reading the workspace.
 */
import type { ToolFilePatch, ToolLifecycleAction } from '@orxa-code/contracts'

import { asObject, asString } from './CodexRuntimeEventUtils.ts'
import { buildUnifiedPatch, classifyChangeMode, ensureUnifiedHeaders } from './UnifiedPatch.ts'

function readUnifiedDiff(change: Record<string, unknown>): string | null {
  return (
    asString(change.unifiedDiff) ?? asString(change.unified_diff) ?? asString(change.diff) ?? null
  )
}

function readBeforeText(change: Record<string, unknown>): string {
  return (
    asString(change.originalContent) ??
    asString(change.original_content) ??
    asString(change.oldContent) ??
    asString(change.old_content) ??
    ''
  )
}

function readAfterText(change: Record<string, unknown>): string {
  return (
    asString(change.newContent) ?? asString(change.new_content) ?? asString(change.content) ?? ''
  )
}

function extractChangePatch(path: string, change: Record<string, unknown>): ToolFilePatch | null {
  const kind =
    asString(change.kind) ??
    asString(change.type) ??
    asString(change.changeType) ??
    asString(change.operation)
  const mode = classifyChangeMode(kind)
  const action: ToolLifecycleAction = mode
  const unified = readUnifiedDiff(change)
  if (unified && unified.length > 0) {
    return { path, action, patchText: ensureUnifiedHeaders(unified, path, mode) }
  }
  if (mode === 'create') {
    return { path, action, patchText: buildUnifiedPatch(path, '', readAfterText(change), 'create') }
  }
  if (mode === 'delete') {
    return {
      path,
      action,
      patchText: buildUnifiedPatch(path, readBeforeText(change), '', 'delete'),
    }
  }
  const before = readBeforeText(change)
  const after = readAfterText(change)
  if (before.length === 0 && after.length === 0) return null
  return { path, action, patchText: buildUnifiedPatch(path, before, after, 'edit') }
}

function extractFromArray(changes: ReadonlyArray<unknown>): ToolFilePatch[] {
  const patches: ToolFilePatch[] = []
  for (const raw of changes) {
    const record = asObject(raw)
    if (!record) continue
    const path =
      asString(record.path) ??
      asString(record.filePath) ??
      asString(record.newPath) ??
      asString(record.oldPath)
    if (!path) continue
    const patch = extractChangePatch(path, record)
    if (patch) patches.push(patch)
  }
  return patches
}

function extractFromObject(changes: Record<string, unknown>): ToolFilePatch[] {
  const patches: ToolFilePatch[] = []
  for (const [path, rawChange] of Object.entries(changes)) {
    const record = asObject(rawChange)
    if (!record) continue
    const patch = extractChangePatch(path, record)
    if (patch) patches.push(patch)
  }
  return patches
}

export function buildCodexFileChangePatches(
  item: Record<string, unknown>,
  payload: Record<string, unknown> | undefined
): ToolFilePatch[] {
  const rawChanges = item.changes ?? payload?.changes
  if (Array.isArray(rawChanges)) return extractFromArray(rawChanges)
  const changesObj = asObject(rawChanges)
  if (changesObj) return extractFromObject(changesObj)
  return []
}
