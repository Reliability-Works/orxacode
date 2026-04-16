/**
 * Per-tool-call file-patch extraction for the Claude adapter.
 *
 * Normalizes Claude's Edit/MultiEdit/Write tool inputs into synthetic unified
 * diffs so the UI can render a per-call inline diff without re-reading the
 * workspace. Bash-driven deletes are handled elsewhere (no patch text needed).
 */
import type { ToolFilePatch, ToolLifecycleAction } from '@orxa-code/contracts'

import { buildUnifiedPatch } from './UnifiedPatch.ts'

type MaybeRecord = Record<string, unknown> | undefined

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function patchesForEditTool(
  filePath: string,
  oldString: string,
  newString: string,
  action: ToolLifecycleAction
): ToolFilePatch[] {
  const mode = action === 'create' ? 'create' : 'edit'
  return [
    {
      path: filePath,
      action,
      patchText: buildUnifiedPatch(filePath, oldString, newString, mode),
    },
  ]
}

function patchesForMultiEdit(
  filePath: string,
  edits: ReadonlyArray<unknown>,
  action: ToolLifecycleAction
): ToolFilePatch[] {
  const oldParts: string[] = []
  const newParts: string[] = []
  for (const raw of edits) {
    const edit = asRecord(raw)
    if (!edit) continue
    const oldString = asString(edit.old_string) ?? ''
    const newString = asString(edit.new_string) ?? ''
    oldParts.push(oldString)
    newParts.push(newString)
  }
  if (oldParts.length === 0 && newParts.length === 0) return []
  const mode = action === 'create' ? 'create' : 'edit'
  return [
    {
      path: filePath,
      action,
      patchText: buildUnifiedPatch(filePath, oldParts.join('\n'), newParts.join('\n'), mode),
    },
  ]
}

function patchesForWriteTool(
  filePath: string,
  content: string,
  action: ToolLifecycleAction
): ToolFilePatch[] {
  return [
    {
      path: filePath,
      action,
      patchText: buildUnifiedPatch(filePath, '', content, 'create'),
    },
  ]
}

export function buildClaudeToolFilePatches(
  toolName: string,
  input: MaybeRecord,
  action: ToolLifecycleAction
): ToolFilePatch[] {
  if (!input) return []
  const normalized = toolName.toLowerCase()
  const filePath = asString(input.file_path) ?? asString(input.filePath) ?? asString(input.path)
  if (!filePath) return []

  if (normalized === 'edit') {
    const oldString = asString(input.old_string) ?? ''
    const newString = asString(input.new_string) ?? ''
    return patchesForEditTool(filePath, oldString, newString, action)
  }
  if (normalized === 'multiedit') {
    const edits = Array.isArray(input.edits) ? input.edits : []
    return patchesForMultiEdit(filePath, edits, action)
  }
  if (normalized === 'write') {
    const content = asString(input.content) ?? ''
    return patchesForWriteTool(filePath, content, action)
  }
  return []
}
