/* eslint-disable complexity, max-lines */
import type { TimelineKind } from './message-feed-timeline'
import {
  isLikelyTelemetryJson,
  isLikelyThinkingText,
  isProgressUpdateText,
  parseJsonObject,
  shouldHideAssistantText,
  summarizeOrxaBrowserActionText,
} from './message-feed-visibility'
import type { TaskDelegationInfo } from './opencode-session-presentation-types'

export function getRoleLabel(role: string, assistantLabel: string) {
  if (role === 'assistant') {
    return assistantLabel
  }
  if (role === 'user') {
    return 'User'
  }
  return role
}

export function compactText(value: string, maxLength = 58) {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) {
    return singleLine
  }
  return `${singleLine.slice(0, maxLength - 3).trimEnd()}...`
}

export function compactPathPreservingBasename(value: string, maxLength = 58) {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) {
    return singleLine
  }
  const normalized = singleLine.replace(/\\/g, '/')
  const slashIndex = normalized.lastIndexOf('/')
  if (slashIndex < 0) {
    return compactText(singleLine, maxLength)
  }
  const basename = normalized.slice(slashIndex + 1)
  if (!basename) {
    return compactText(singleLine, maxLength)
  }
  const reserved = basename.length + 4
  if (reserved >= maxLength) {
    return `...${basename.slice(-(maxLength - 3))}`
  }
  const prefixBudget = maxLength - reserved
  const prefix = normalized.slice(0, prefixBudget).replace(/[/. -]+$/g, '')
  return `${prefix}.../${basename}`
}

export function toWorkspaceRelativePath(target: string, workspaceDirectory?: string | null) {
  const normalizedTarget = target.replace(/\\/g, '/').replace(/\/+$/g, '')
  const normalizedWorkspace = (workspaceDirectory ?? '').replace(/\\/g, '/').replace(/\/+$/g, '')
  if (!normalizedWorkspace) {
    return normalizedTarget
  }
  if (normalizedTarget === normalizedWorkspace) {
    return '.'
  }
  if (normalizedTarget.startsWith(`${normalizedWorkspace}/`)) {
    return normalizedTarget.slice(normalizedWorkspace.length + 1)
  }
  const embeddedWorkspaceIndex = normalizedTarget.indexOf(`${normalizedWorkspace}/`)
  if (embeddedWorkspaceIndex >= 0) {
    return normalizedTarget.slice(embeddedWorkspaceIndex + normalizedWorkspace.length + 1)
  }
  return normalizedTarget
}

export function formatTarget(target: string, workspaceDirectory?: string | null, maxLength = 58) {
  return compactPathPreservingBasename(
    toWorkspaceRelativePath(target, workspaceDirectory),
    maxLength
  )
}

export function isCommandToolName(toolName: string) {
  const normalized = toolName.trim().toLowerCase()
  return (
    normalized.includes('exec_command') || normalized.includes('bash') || normalized.includes('run')
  )
}

export function deriveTargetFromCommand(command: string, workspaceDirectory?: string | null) {
  const quotedPath = command.match(/["']([^"']+\.[^"']+)["']/)?.[1]
  if (quotedPath) {
    return formatTarget(quotedPath, workspaceDirectory)
  }
  const redirectPath = command.match(/(?:>|>>)\s*([~./][^\s"'`]+)/)?.[1]
  if (redirectPath) {
    return formatTarget(redirectPath, workspaceDirectory)
  }
  const slashPath = command.match(/(?:^|\s)([~./][^\s"'`]+)/)?.[1]
  if (slashPath) {
    return formatTarget(slashPath, workspaceDirectory)
  }
  const extensionPath = command.match(/(?:^|\s)([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?=\s|$)/)?.[1]
  if (extensionPath) {
    return formatTarget(extensionPath, workspaceDirectory)
  }
  return null
}

export function extractStringByKeys(input: unknown, keys: string[]): string | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      const nested = extractStringByKeys(value, keys)
      if (nested) {
        return nested
      }
    }
    return null
  }
  const record = input as Record<string, unknown>
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  for (const value of Object.values(record)) {
    const nested = extractStringByKeys(value, keys)
    if (nested) {
      return nested
    }
  }
  return null
}

export function isLikelyShellCommand(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  if (/^loaded skill:/i.test(trimmed)) {
    return false
  }
  if (/[;&|><`$]/.test(trimmed)) {
    return true
  }
  if (/^[A-Z][a-z]+ [a-z]/.test(trimmed) && !trimmed.includes('/') && !trimmed.includes('-')) {
    return false
  }
  if (/^[a-z@._/][^\s]*\s/.test(trimmed) || /^[a-z@._/][^\s]*$/.test(trimmed)) {
    return true
  }
  return false
}

export function isTaskToolName(toolName: string) {
  const normalized = toolName.trim().toLowerCase()
  return normalized === 'task' || normalized.endsWith('/task')
}

export function isToolStatusActive(status: string) {
  return status === 'pending' || status === 'running'
}

export function toObjectRecord(input: unknown): Record<string, unknown> | null {
  if (!input) {
    return null
  }
  if (typeof input === 'string') {
    return parseJsonObject(input.trim())
  }
  if (typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>
  }
  return null
}

export function extractCommand(input: unknown) {
  return extractStringByKeys(input, ['cmd', 'command'])
}

export function extractCommandPreview(input: unknown, maxLength = 92) {
  const command = extractCommand(input)
  if (!command) {
    return null
  }
  const firstLine = command
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0)
  if (!firstLine) {
    return null
  }
  return compactText(firstLine, maxLength)
}

export function extractShellCommandForTool(input: unknown, stateTitle?: string) {
  const explicitCommand = extractCommand(input)
  if (explicitCommand && isLikelyShellCommand(explicitCommand)) {
    return explicitCommand
  }
  const normalizedTitle = stateTitle?.trim() ?? ''
  if (normalizedTitle && isLikelyShellCommand(normalizedTitle)) {
    return normalizedTitle
  }
  return undefined
}

export function extractPatchTarget(
  input: unknown,
  workspaceDirectory?: string | null
): { verb: 'Edited' | 'Created' | 'Deleted'; target: string } | null {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) {
      return null
    }
    const patchMatch = trimmed.match(/\*\*\*\s+(Update|Add|Delete)\s+File:\s+([^\n]+)/i)
    if (patchMatch) {
      const action = patchMatch[1]?.toLowerCase()
      const filePath = patchMatch[2]?.trim()
      if (!filePath) {
        return null
      }
      return {
        verb: action === 'add' ? 'Created' : action === 'delete' ? 'Deleted' : 'Edited',
        target: formatTarget(filePath, workspaceDirectory, 64),
      }
    }
    const parsed = parseJsonObject(trimmed)
    return parsed ? extractPatchTarget(parsed, workspaceDirectory) : null
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      const patch = extractPatchTarget(value, workspaceDirectory)
      if (patch) {
        return patch
      }
    }
    return null
  }
  if (!input || typeof input !== 'object') {
    return null
  }
  const directPatch = extractStringByKeys(input, ['patch', 'content', 'text'])
  if (directPatch) {
    const patch = extractPatchTarget(directPatch, workspaceDirectory)
    if (patch) {
      return patch
    }
  }
  return null
}

export function extractModelLabel(input: unknown) {
  const record = toObjectRecord(input)
  if (!record) {
    return undefined
  }
  const modelCandidate = record.model
  const modelRecord = toObjectRecord(modelCandidate)
  if (!modelRecord) {
    return undefined
  }
  const providerID = typeof modelRecord.providerID === 'string' ? modelRecord.providerID : undefined
  const modelID = typeof modelRecord.modelID === 'string' ? modelRecord.modelID : undefined
  if (!providerID || !modelID) {
    return undefined
  }
  return `${providerID}/${modelID}`
}

export function extractTaskDelegationInfo(input: unknown, metadata?: unknown): TaskDelegationInfo | null {
  const record = toObjectRecord(input)
  if (!record) {
    return null
  }
  const agent =
    extractStringByKeys(record, ['subagent_type', 'subagentType', 'agent', 'subagent']) ??
    'subagent'
  const description = extractStringByKeys(record, ['description']) ?? 'Delegated task'
  const prompt = extractStringByKeys(record, ['prompt']) ?? ''
  const command = extractStringByKeys(record, ['command']) ?? undefined
  const modelLabel = extractModelLabel(metadata)
  const metadataRecord = toObjectRecord(metadata)
  const sessionID = metadataRecord
    ? (extractStringByKeys(metadataRecord, ['sessionId', 'sessionID']) ?? undefined)
    : undefined
  return {
    agent,
    description,
    prompt,
    command,
    modelLabel,
    sessionID,
  }
}

export function extractTaskSessionIDFromOutput(output: unknown) {
  const objectRecord = toObjectRecord(output)
  const fromRecord = objectRecord
    ? extractStringByKeys(objectRecord, [
        'sessionId',
        'sessionID',
        'task_id',
        'taskId',
        'session_id',
      ])
    : null
  if (fromRecord) {
    return fromRecord
  }
  if (typeof output !== 'string') {
    return undefined
  }
  const trimmed = output.trim()
  if (!trimmed) {
    return undefined
  }
  const fromTag = trimmed.match(/<task_id>\s*([A-Za-z0-9._:-]+)\s*<\/task_id>/i)?.[1]
  if (fromTag) {
    return fromTag.trim()
  }
  const fromLine = trimmed.match(
    /\b(?:task[_-]?id|session[_-]?id|taskId|sessionId)\b\s*[:=]\s*([A-Za-z0-9._:-]+)/i
  )?.[1]
  if (fromLine) {
    return fromLine.trim()
  }
  return undefined
}

export function isBareCommandLabel(label: string) {
  const normalized = label.trim().toLowerCase()
  return normalized === 'ran command' || normalized.startsWith('ran command on ')
}

export function isLowSignalCompletedLabel(label: string) {
  const normalized = label.trim().toLowerCase()
  return normalized === 'completed action' || normalized.startsWith('completed action on ')
}

export function isLowSignalActiveLabel(label: string) {
  const normalized = label.trim().toLowerCase()
  return normalized === 'working...' || normalized.startsWith('working on ')
}

export function mapPatchVerbToKind(verb: 'Edited' | 'Created' | 'Deleted'): TimelineKind {
  if (verb === 'Created') {
    return 'create'
  }
  if (verb === 'Deleted') {
    return 'delete'
  }
  return 'edit'
}

export function classifyCommandKind(command: string, workspaceDirectory?: string | null): TimelineKind {
  const patch = extractPatchTarget(command, workspaceDirectory)
  if (patch) {
    return mapPatchVerbToKind(patch.verb)
  }
  if (/\b(rg|grep|find)\b/.test(command)) {
    return 'search'
  }
  if (/\b(cat|sed|head|tail|bat)\b/.test(command)) {
    return 'read'
  }
  if (/\b(ls|tree|fd)\b/.test(command)) {
    return 'list'
  }
  if (/\bgit\b/.test(command)) {
    return 'git'
  }
  if (/\brm\b/.test(command)) {
    return 'delete'
  }
  if (/\b(mkdir|touch)\b/.test(command)) {
    return 'create'
  }
  if (/\b(mv|cp|echo|printf)\b/.test(command)) {
    return 'edit'
  }
  return 'run'
}

export function toToolReason(toolName: string) {
  const normalized = toolName.trim().toLowerCase()
  if (normalized.includes('read')) {
    return 'read'
  }
  if (
    normalized.includes('rg') ||
    normalized.includes('grep') ||
    normalized.includes('search') ||
    normalized.includes('find')
  ) {
    return 'search'
  }
  if (normalized.includes('write') || normalized.includes('edit') || normalized.includes('replace')) {
    return 'edit'
  }
  if (normalized.includes('delete') || normalized.includes('remove')) {
    return 'delete'
  }
  if (
    normalized.includes('create') ||
    normalized.includes('mkdir') ||
    normalized.includes('touch')
  ) {
    return 'create'
  }
  if (normalized.includes('git')) {
    return 'git check'
  }
  return normalized.replace(/[_-]+/g, ' ')
}

export function inferTimelineKind(
  toolName: string,
  input: unknown,
  workspaceDirectory?: string | null
): TimelineKind {
  const name = toolName.toLowerCase()
  if (isTaskToolName(name)) {
    return 'delegate'
  }
  if (name.includes('todo')) {
    return 'todo'
  }
  if (name.includes('delete') || name.includes('remove')) {
    return 'delete'
  }
  if (name.includes('create') || name.includes('mkdir') || name.includes('touch')) {
    return 'create'
  }
  if (name.includes('write') || name.includes('edit') || name.includes('replace')) {
    return 'edit'
  }
  if (name.includes('apply_patch')) {
    const patch = extractPatchTarget(input, workspaceDirectory)
    return patch ? mapPatchVerbToKind(patch.verb) : 'edit'
  }
  if (name.includes('read')) {
    return 'read'
  }
  if (
    name.includes('rg') ||
    name.includes('grep') ||
    name.includes('search') ||
    name.includes('find')
  ) {
    return 'search'
  }
  if (name.includes('ls') || name.includes('list')) {
    return 'list'
  }
  if (name.includes('git')) {
    return 'git'
  }
  if (name.includes('exec_command') || name.includes('bash') || name.includes('run')) {
    const command = extractCommand(input)
    return command ? classifyCommandKind(command, workspaceDirectory) : 'run'
  }
  return 'run'
}

export function describeSearchCommand(command: string, workspaceDirectory?: string | null) {
  const normalized = command.replace(/\s+/g, ' ').trim()
  const patternMatch = normalized.match(
    /\b(?:rg|grep)\b(?:\s+-{1,2}[^\s]+\s+)*("([^"]+)"|'([^']+)'|([^\s]+))/
  )
  const pattern = (patternMatch?.[2] ?? patternMatch?.[3] ?? patternMatch?.[4] ?? '').replace(
    /^["']|["']$/g,
    ''
  )
  const target = deriveTargetFromCommand(command, workspaceDirectory)
  if (pattern && target) {
    return `for ${compactText(pattern, 42)} in ${target}`
  }
  if (pattern) {
    return `for ${compactText(pattern, 42)}`
  }
  if (target) {
    return `in ${target}`
  }
  return null
}

export function extractToolTarget(input: unknown, workspaceDirectory?: string | null): string | null {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (!trimmed) {
      return null
    }
    const parsed = parseJsonObject(trimmed)
    if (parsed) {
      return extractToolTarget(parsed, workspaceDirectory)
    }
    return deriveTargetFromCommand(trimmed, workspaceDirectory)
  }
  if (Array.isArray(input)) {
    for (const value of input) {
      const target = extractToolTarget(value, workspaceDirectory)
      if (target) {
        return target
      }
    }
    return null
  }
  if (!input || typeof input !== 'object') {
    return null
  }
  const record = input as Record<string, unknown>
  const prioritizedKeys = [
    'path',
    'paths',
    'filePath',
    'filepath',
    'file_path',
    'relativePath',
    'file',
    'filename',
    'target',
    'targetPath',
    'destination',
    'from',
    'to',
    'oldPath',
    'newPath',
    'directory',
    'uri',
    'ref_id',
    'refId',
  ]

  for (const key of prioritizedKeys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) {
      return formatTarget(value, workspaceDirectory)
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) {
          return formatTarget(item, workspaceDirectory)
        }
      }
    }
  }

  for (const value of Object.values(record)) {
    const nested = extractToolTarget(value, workspaceDirectory)
    if (nested) {
      return nested
    }
  }
  return null
}

export function isLikelyTelemetryOrThinkingText(text: string) {
  return isLikelyTelemetryJson(text) || isLikelyThinkingText(text) || isProgressUpdateText(text)
}

export function shouldHideAssistantTextPart(text: string) {
  return shouldHideAssistantText(text)
}

export function summarizeBrowserActionText(text: string) {
  return summarizeOrxaBrowserActionText(text)
}
