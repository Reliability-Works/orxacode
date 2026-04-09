import type { ToolLifecycleItemType } from '@orxa-code/contracts'

import type { OpencodePart } from './OpencodeAdapter.types.ts'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function joinDetail(parts: ReadonlyArray<string | undefined>): string | undefined {
  const filtered = parts.filter((value): value is string => value !== undefined && value.length > 0)
  if (filtered.length === 0) return undefined
  return filtered.join(' ')
}

function summarizePathInput(pathLike: unknown): string | undefined {
  return asTrimmedString(pathLike)
}

function summarizeApplyPatchFiles(
  filesValue: unknown
): { readonly summary?: string; readonly changedFiles?: ReadonlyArray<string> } {
  if (!Array.isArray(filesValue)) {
    return {}
  }

  const changedFiles = filesValue
    .map(fileValue => {
      const file = asRecord(fileValue)
      return (
        asTrimmedString(file?.relativePath) ??
        asTrimmedString(file?.filePath) ??
        asTrimmedString(file?.movePath)
      )
    })
    .filter((value): value is string => value !== undefined)

  if (changedFiles.length === 0) {
    return {}
  }
  const firstChangedFile = changedFiles[0]
  if (!firstChangedFile) {
    return {}
  }
  if (changedFiles.length === 1) {
    return {
      summary: firstChangedFile,
      changedFiles,
    }
  }
  return {
    summary: `${firstChangedFile} +${changedFiles.length - 1} more`,
    changedFiles,
  }
}

function metadataForPart(part: Extract<OpencodePart, { type: 'tool' }>): Record<string, unknown> | null {
  return asRecord('metadata' in part.state ? part.state.metadata : undefined)
}

function titleForState(part: Extract<OpencodePart, { type: 'tool' }>): string | undefined {
  return asTrimmedString('title' in part.state ? part.state.title : undefined)
}

function inputForPart(part: Extract<OpencodePart, { type: 'tool' }>): Record<string, unknown> | null {
  return asRecord(part.state.input)
}

function readToolDetail(input: Record<string, unknown> | null): string | undefined {
  return joinDetail([
    summarizePathInput(input?.filePath),
    typeof input?.offset === 'number' ? `offset=${input.offset}` : undefined,
    typeof input?.limit === 'number' ? `limit=${input.limit}` : undefined,
  ])
}

function searchToolDetail(input: Record<string, unknown> | null, includeKey?: 'include'): string | undefined {
  return joinDetail([
    summarizePathInput(input?.path),
    asTrimmedString(input?.pattern) ? `pattern=${asTrimmedString(input?.pattern)}` : undefined,
    includeKey === 'include' && asTrimmedString(input?.include)
      ? `include=${asTrimmedString(input?.include)}`
      : undefined,
  ])
}

function countSummary(
  input: Record<string, unknown> | null,
  key: 'todos' | 'questions',
  singular: string
): string | undefined {
  const value = input?.[key]
  const count = Array.isArray(value) ? value.length : undefined
  if (typeof count !== 'number' || count <= 0) return undefined
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

type ToolPartSummary = Extract<OpencodePart, { type: 'tool' }>
type DetailResolver = (part: ToolPartSummary) => string | undefined

const toolDetailResolvers: Partial<Record<ToolPartSummary['tool'], DetailResolver>> = {
  bash: part => {
    const input = inputForPart(part)
    return asTrimmedString(input?.description) ?? asTrimmedString(input?.command) ?? titleForState(part)
  },
  read: part => readToolDetail(inputForPart(part)),
  list: part => summarizePathInput(inputForPart(part)?.path),
  glob: part => searchToolDetail(inputForPart(part)),
  grep: part => searchToolDetail(inputForPart(part), 'include'),
  webfetch: part => asTrimmedString(inputForPart(part)?.url),
  websearch: part => asTrimmedString(inputForPart(part)?.query),
  codesearch: part => asTrimmedString(inputForPart(part)?.query),
  edit: part => summarizePathInput(inputForPart(part)?.filePath),
  write: part => summarizePathInput(inputForPart(part)?.filePath),
  apply_patch: part => summarizeApplyPatchFiles(metadataForPart(part)?.files).summary ?? titleForState(part),
  task: part => asTrimmedString(inputForPart(part)?.description) ?? titleForState(part),
  todowrite: part => countSummary(inputForPart(part), 'todos', 'todo'),
  question: part => countSummary(inputForPart(part), 'questions', 'question'),
  skill: part => asTrimmedString(inputForPart(part)?.name),
}

export function toolLifecycleItemTypeForTool(tool: string): ToolLifecycleItemType {
  switch (tool) {
    case 'bash':
      return 'command_execution'
    case 'edit':
    case 'write':
    case 'apply_patch':
      return 'file_change'
    case 'task':
      return 'collab_agent_tool_call'
    case 'webfetch':
    case 'websearch':
    case 'codesearch':
      return 'web_search'
    default:
      return 'mcp_tool_call'
  }
}

export function toolTitleForPart(part: ToolPartSummary): string {
  switch (part.tool) {
    case 'bash':
      return 'Shell'
    case 'read':
      return 'Read'
    case 'list':
      return 'List'
    case 'glob':
      return 'Glob'
    case 'grep':
      return 'Grep'
    case 'webfetch':
      return 'Web fetch'
    case 'websearch':
      return 'Web search'
    case 'codesearch':
      return 'Code search'
    case 'edit':
      return 'Edit'
    case 'write':
      return 'Write'
    case 'apply_patch':
      return 'Patch'
    case 'task':
      return 'Subagent task'
    case 'todowrite':
      return 'Todos'
    case 'question':
      return 'Questions'
    case 'skill':
      return 'Skill'
    default:
      return part.tool
  }
}

export function toolDetailForPart(part: ToolPartSummary): string | undefined {
  return toolDetailResolvers[part.tool]?.(part) ?? titleForState(part)
}

export function toolDataForPart(part: ToolPartSummary): Record<string, unknown> | undefined {
  const input = inputForPart(part)
  const metadata = metadataForPart(part)
  const result: Record<string, unknown> = {}

  if (input && Object.keys(input).length > 0) {
    result.input = part.state.input
    if (typeof input.command === 'string' && input.command.trim().length > 0) {
      result.command = input.command
    }
  }

  const toolResult: Record<string, unknown> = {}
  for (const key of ['files', 'filediff', 'diagnostics', 'loaded', 'matches', 'count', 'sessionId']) {
    if (metadata?.[key] !== undefined) {
      toolResult[key] = metadata[key]
    }
  }

  const stateTitle = titleForState(part)
  if (stateTitle) {
    toolResult.title = stateTitle
  }
  if (Object.keys(toolResult).length > 0) {
    result.result = toolResult
  }

  return Object.keys(result).length > 0 ? result : undefined
}
