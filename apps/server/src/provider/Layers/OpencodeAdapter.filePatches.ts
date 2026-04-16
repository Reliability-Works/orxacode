/**
 * Per-tool-call file-patch extraction for the Opencode adapter.
 *
 * Handles edit / write / apply_patch tool parts. Opencode's tool metadata
 * usually carries a unified diff string; when it doesn't we synthesize one
 * from the tool input (edit's oldString/newString, write's content) so the
 * renderer can show an inline diff without re-reading the workspace.
 */
import type { ToolFilePatch, ToolLifecycleAction } from '@orxa-code/contracts'

import {
  buildUnifiedPatch,
  classifyChangeMode,
  ensureUnifiedHeaders,
  type ChangeMode,
} from './UnifiedPatch.ts'
import type { OpencodePart } from './OpencodeAdapter.types.ts'

type ToolPart = Extract<OpencodePart, { type: 'tool' }>

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function metadataRecord(part: ToolPart): Record<string, unknown> | null {
  return 'metadata' in part.state ? asRecord(part.state.metadata) : null
}

function inputRecord(part: ToolPart): Record<string, unknown> | null {
  return asRecord(part.state.input)
}

function readDiffFromMetadata(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  return (
    asString(metadata.diff) ??
    asString(metadata.unifiedDiff) ??
    asString(metadata.unified_diff) ??
    asString(metadata.patch)
  )
}

function inputFilePath(input: Record<string, unknown> | null): string | null {
  return asString(input?.filePath) ?? asString(input?.file_path) ?? asString(input?.path)
}

function metadataDiffPatch(
  part: ToolPart,
  filePath: string,
  action: ToolLifecycleAction,
  mode: 'edit' | 'create'
): ToolFilePatch | null {
  const metadataDiff = readDiffFromMetadata(metadataRecord(part))
  if (!metadataDiff) return null
  return { path: filePath, action, patchText: ensureUnifiedHeaders(metadataDiff, filePath, mode) }
}

function patchForEdit(part: ToolPart): ToolFilePatch[] {
  const input = inputRecord(part)
  const filePath = inputFilePath(input)
  if (!filePath) return []
  const fromMetadata = metadataDiffPatch(part, filePath, 'edit', 'edit')
  if (fromMetadata) return [fromMetadata]
  const oldString = asString(input?.oldString) ?? asString(input?.old_string) ?? ''
  const newString = asString(input?.newString) ?? asString(input?.new_string) ?? ''
  if (oldString.length === 0 && newString.length === 0) return []
  return [
    {
      path: filePath,
      action: 'edit',
      patchText: buildUnifiedPatch(filePath, oldString, newString, 'edit'),
    },
  ]
}

function patchForWrite(part: ToolPart): ToolFilePatch[] {
  const input = inputRecord(part)
  const filePath = inputFilePath(input)
  if (!filePath) return []
  const fromMetadata = metadataDiffPatch(part, filePath, 'create', 'create')
  if (fromMetadata) return [fromMetadata]
  const content = asString(input?.content) ?? ''
  return [
    {
      path: filePath,
      action: 'create',
      patchText: buildUnifiedPatch(filePath, '', content, 'create'),
    },
  ]
}

function readFileEntryPath(entry: Record<string, unknown>): string | null {
  return (
    asString(entry.relativePath) ??
    asString(entry.filePath) ??
    asString(entry.file_path) ??
    asString(entry.path) ??
    asString(entry.movePath) ??
    asString(entry.newPath) ??
    null
  )
}

function readFileEntryDiff(entry: Record<string, unknown>): string | null {
  return (
    asString(entry.diff) ??
    asString(entry.unifiedDiff) ??
    asString(entry.unified_diff) ??
    asString(entry.patch) ??
    null
  )
}

function readEntryKind(entry: Record<string, unknown>): string | null {
  return (
    asString(entry.status) ??
    asString(entry.changeType) ??
    asString(entry.operation) ??
    asString(entry.type) ??
    asString(entry.kind)
  )
}

function readEntryBefore(entry: Record<string, unknown>): string {
  return (
    asString(entry.oldContent) ??
    asString(entry.old_content) ??
    asString(entry.originalContent) ??
    asString(entry.original_content) ??
    ''
  )
}

function readEntryAfter(entry: Record<string, unknown>): string {
  return asString(entry.newContent) ?? asString(entry.new_content) ?? ''
}

function patchFromEntryContent(
  path: string,
  action: ToolLifecycleAction,
  entry: Record<string, unknown>,
  mode: ChangeMode
): ToolFilePatch | null {
  if (mode === 'create') {
    const content = readEntryAfter(entry) || (asString(entry.content) ?? '')
    return { path, action, patchText: buildUnifiedPatch(path, '', content, 'create') }
  }
  if (mode === 'delete') {
    const content = readEntryBefore(entry) || (asString(entry.content) ?? '')
    return { path, action, patchText: buildUnifiedPatch(path, content, '', 'delete') }
  }
  const before = readEntryBefore(entry)
  const after = readEntryAfter(entry)
  if (before.length === 0 && after.length === 0) return null
  return { path, action, patchText: buildUnifiedPatch(path, before, after, 'edit') }
}

function extractApplyPatchEntry(entry: Record<string, unknown>): ToolFilePatch | null {
  const path = readFileEntryPath(entry)
  if (!path) return null
  const mode = classifyChangeMode(readEntryKind(entry))
  const action: ToolLifecycleAction = mode
  const diff = readFileEntryDiff(entry)
  if (diff) {
    return { path, action, patchText: ensureUnifiedHeaders(diff, path, mode) }
  }
  return patchFromEntryContent(path, action, entry, mode)
}

function patchForApplyPatch(part: ToolPart): ToolFilePatch[] {
  const metadata = metadataRecord(part)
  const files = metadata?.files
  if (!Array.isArray(files)) return []
  const patches: ToolFilePatch[] = []
  for (const raw of files) {
    const entry = asRecord(raw)
    if (!entry) continue
    const patch = extractApplyPatchEntry(entry)
    if (patch) patches.push(patch)
  }
  return patches
}

export function buildOpencodeToolFilePatches(part: ToolPart): ToolFilePatch[] {
  if (part.state.status !== 'completed') return []
  switch (part.tool) {
    case 'edit':
      return patchForEdit(part)
    case 'write':
      return patchForWrite(part)
    case 'apply_patch':
      return patchForApplyPatch(part)
    default:
      return []
  }
}
