/* eslint-disable complexity, max-lines-per-function */
import type { Part } from '@opencode-ai/sdk/v2/client'
import type { ToolCallStatus } from '../components/chat/ToolCallCard'
import type { UnifiedTimelineRenderRow } from '../components/chat/unified-timeline-model'
import {
  extractMetaFileDiffDetails,
  extractMetaFileDiffSummary,
  extractPatchFileDetails,
  extractPatchSummary,
  extractWriteFileDetail,
  extractWriteFileSummary,
  mergeChangedFileDetails,
} from './message-feed-patch-summary'
import type { TimelineKind } from './message-feed-timeline'
import {
  compactText,
  extractCommand,
  extractCommandPreview,
  extractShellCommandForTool,
  extractTaskDelegationInfo,
  extractToolTarget,
  inferTimelineKind,
  isCommandToolName,
  isLikelyShellCommand,
  isLowSignalActiveLabel,
  isTaskToolName,
  isToolStatusActive,
  extractPatchTarget,
} from './opencode-session-presentation-utils'

function formatTargetedToolLabel(
  target: string | null,
  isActive: boolean,
  isError: boolean,
  activeLabel: string,
  completedLabel: string,
  failedLabel = 'Failed'
) {
  if (target) {
    if (isActive) {
      return `${activeLabel} ${target}...`
    }
    if (isError) {
      return `${failedLabel} ${target}`
    }
    return `${completedLabel} ${target}`
  }
  if (isActive) {
    return `${activeLabel}...`
  }
  if (isError) {
    return failedLabel
  }
  return completedLabel
}

function formatTaskToolLabel(
  status: string,
  input: unknown,
  metadata: unknown
) {
  const isActive = isToolStatusActive(status)
  const isError = status === 'error'
  const task = extractTaskDelegationInfo(input, metadata)
  const agentLabel = task?.agent ? `@${task.agent}` : 'subagent'
  const taskLabel = task?.description ? compactText(task.description, 56) : 'delegated task'
  if (isActive) {
    return `Delegating ${taskLabel} to ${agentLabel}...`
  }
  if (isError) {
    return `Delegation failed for ${agentLabel}`
  }
  return `Delegated ${taskLabel} to ${agentLabel}`
}

function formatWriteToolLabel(
  status: string,
  input: unknown,
  metadata: unknown,
  workspaceDirectory?: string | null
) {
  const isActive = isToolStatusActive(status)
  const isError = status === 'error'
  const writeSummary = extractWriteFileSummary(input, metadata, workspaceDirectory)
  if (isActive) {
    return writeSummary ? `Writing ${writeSummary.summary}...` : 'Writing...'
  }
  if (isError) {
    return writeSummary ? `Write failed ${writeSummary.summary}` : 'Write failed'
  }
  if (writeSummary) {
    return `${writeSummary.verb} ${writeSummary.summary}`
  }
  return formatTargetedToolLabel(
    extractToolTarget(input, workspaceDirectory),
    false,
    false,
    'Writing',
    'Edited',
    'Write failed'
  )
}

function formatEditToolLabel(
  status: string,
  metadata: unknown,
  workspaceDirectory?: string | null
) {
  const isActive = isToolStatusActive(status)
  const isError = status === 'error'
  const filediffSummary = extractMetaFileDiffSummary(metadata, workspaceDirectory)
  if (!isActive && !isError && filediffSummary) {
    return `Edited ${filediffSummary}`
  }
  return formatTargetedToolLabel(null, isActive, isError, 'Editing', 'Edited', 'Edit failed')
}

function formatPatchToolLabel(
  status: string,
  input: unknown,
  output: unknown,
  metadata: unknown,
  workspaceDirectory?: string | null
) {
  const isActive = isToolStatusActive(status)
  const isError = status === 'error'
  const patch = extractPatchTarget(input, workspaceDirectory)
  const patchSummary =
    extractPatchSummary(input, output, workspaceDirectory) ??
    extractMetaFileDiffSummary(metadata, workspaceDirectory)
  if (patch) {
    if (isActive) {
      return `${patch.verb === 'Deleted' ? 'Deleting' : patch.verb === 'Created' ? 'Creating' : 'Editing'} ${patch.target}...`
    }
    if (isError) {
      return patchSummary
        ? `Patch failed on ${patch.target} (${patchSummary})`
        : `Patch failed on ${patch.target}`
    }
    return patchSummary ? `${patch.verb} ${patchSummary}` : `${patch.verb} ${patch.target}`
  }
  if (patchSummary) {
    return isActive
      ? `Applying patch (${patchSummary})...`
      : isError
        ? `Patch failed (${patchSummary})`
        : `Applied patch ${patchSummary}`
  }
  return isActive ? 'Applying patch...' : isError ? 'Patch failed' : 'Applied patch'
}

function formatCommandToolLabel(
  status: string,
  input: unknown,
  workspaceDirectory?: string | null
) {
  const isActive = isToolStatusActive(status)
  const isError = status === 'error'
  const target = extractToolTarget(input, workspaceDirectory)
  const command = extractCommand(input)
  const commandPreview = extractCommandPreview(input, 72)
  const withTarget = (activeLabel: string, completedLabel: string, failedLabel = 'Failed') =>
    formatTargetedToolLabel(target, isActive, isError, activeLabel, completedLabel, failedLabel)

  if (isActive && target) {
    return `${target}...`
  }
  if (commandPreview && !isLikelyShellCommand(commandPreview)) {
    return commandPreview
  }
  if (target) {
    return formatTargetedToolLabel(target, isActive, isError, 'Running', 'Ran', 'Run failed')
  }
  if (command && isLikelyShellCommand(command)) {
    return isActive ? 'Running...' : isError ? 'Run failed' : 'Ran'
  }
  return withTarget('Running', 'Ran', 'Run failed')
}

export function toToolActivityLabel(
  toolName: string,
  status: string,
  input: unknown,
  workspaceDirectory?: string | null,
  metadata?: unknown,
  output?: unknown
) {
  const name = toolName.toLowerCase()
  const isActive = isToolStatusActive(status)
  const isError = status === 'error'

  if (isTaskToolName(name)) {
    return formatTaskToolLabel(status, input, metadata)
  }
  if (name.includes('todo')) {
    return isActive ? 'Updating todo list...' : 'Updated todo list'
  }
  if (name.includes('delete') || name.includes('remove')) {
    return formatTargetedToolLabel(
      extractToolTarget(input, workspaceDirectory),
      isActive,
      isError,
      'Deleting',
      'Deleted',
      'Delete failed'
    )
  }
  if (name.includes('create') || name.includes('mkdir') || name.includes('touch')) {
    return formatTargetedToolLabel(
      extractToolTarget(input, workspaceDirectory),
      isActive,
      isError,
      'Creating',
      'Created',
      'Create failed'
    )
  }
  if (name.includes('write')) {
    return formatWriteToolLabel(status, input, metadata, workspaceDirectory)
  }
  if (name.includes('edit') || name.includes('replace')) {
    return formatEditToolLabel(status, metadata, workspaceDirectory)
  }
  if (name.includes('rename') || name.includes('move')) {
    return formatTargetedToolLabel(
      extractToolTarget(input, workspaceDirectory),
      isActive,
      isError,
      'Moving',
      'Moved',
      'Move failed'
    )
  }
  if (name.includes('apply_patch')) {
    return formatPatchToolLabel(status, input, output, metadata, workspaceDirectory)
  }
  if (name.includes('read')) {
    return formatTargetedToolLabel(
      extractToolTarget(input, workspaceDirectory),
      isActive,
      isError,
      'Reading',
      'Read'
    )
  }
  if (
    name.includes('rg') ||
    name.includes('grep') ||
    name.includes('search') ||
    name.includes('find')
  ) {
    return formatTargetedToolLabel(
      extractToolTarget(input, workspaceDirectory),
      isActive,
      isError,
      'Searching',
      'Searched',
      'Search failed'
    )
  }
  if (name.includes('ls') || name.includes('list')) {
    return formatTargetedToolLabel(
      extractToolTarget(input, workspaceDirectory),
      isActive,
      isError,
      'Scanning',
      'Scanned'
    )
  }
  if (name.includes('exec_command') || name.includes('bash') || name.includes('run')) {
    return formatCommandToolLabel(status, input, workspaceDirectory)
  }
  return formatTargetedToolLabel(
    extractToolTarget(input, workspaceDirectory),
    isActive,
    isError,
    'Running',
    'Ran',
    'Run failed'
  )
}

function mapToolStateStatus(status: string): ToolCallStatus {
  if (status === 'completed') return 'completed'
  if (status === 'error') return 'error'
  if (status === 'running') return 'running'
  return 'pending'
}

function buildCommandToolCallTitle(
  status: ToolCallStatus,
  explicitCommand: string,
  stateTitle: string,
  derivedTitle: string,
  isCommandTool: boolean
) {
  if (isCommandTool && explicitCommand) {
    const collapsedCommandPreview = compactText(explicitCommand, 92)
    if (status === 'running') {
      return `Running ${collapsedCommandPreview}...`
    }
    if (status === 'error') {
      return `Command failed ${collapsedCommandPreview}`
    }
    return `Ran ${collapsedCommandPreview}`
  }
  return !stateTitle || stateTitle.toLowerCase() === derivedTitle.toLowerCase()
    ? derivedTitle
    : stateTitle
}

function buildCommandToolExpandedTitle(status: ToolCallStatus, isCommandTool: boolean, explicitCommand: string) {
  if (!isCommandTool || !explicitCommand) {
    return undefined
  }
  if (status === 'running') {
    return 'Running command'
  }
  if (status === 'error') {
    return 'Command failed'
  }
  return 'Ran command'
}

export function buildToolCallCardProps(part: Part & { type: 'tool' }, workspaceDirectory?: string | null) {
  const stateRecord = part.state as unknown as Record<string, unknown>
  const stateTitle =
    'title' in part.state && typeof part.state.title === 'string' ? part.state.title.trim() : ''
  const status = mapToolStateStatus(part.state.status)
  const toolName = part.tool.trim().toLowerCase()
  const isCommandTool = isCommandToolName(toolName)
  const stateOutput = typeof stateRecord.output === 'string' ? stateRecord.output : undefined
  const stateError = typeof stateRecord.error === 'string' ? stateRecord.error : undefined
  const explicitCommand = extractShellCommandForTool(part.state.input, stateTitle)
  const derivedTitle = toToolActivityLabel(
    part.tool,
    part.state.status,
    part.state.input,
    workspaceDirectory,
    stateRecord.metadata,
    stateRecord.output
  )
  const title = buildCommandToolCallTitle(
    status,
    explicitCommand ?? '',
    stateTitle,
    derivedTitle,
    isCommandTool
  )
  const expandedTitle = buildCommandToolExpandedTitle(status, isCommandTool, explicitCommand ?? '')
  const command = isCommandTool && explicitCommand ? explicitCommand : undefined
  const output = stateOutput || undefined
  const error = status === 'error' ? (stateError ?? 'Tool execution failed') : undefined
  return { title, expandedTitle, status, command, output, error }
}

export function extractChangedFilesFromToolPart(
  part: Part & { type: 'tool' },
  kind: TimelineKind,
  workspaceDirectory?: string | null
) {
  if (kind !== 'edit' && kind !== 'create' && kind !== 'delete' && kind !== 'run') {
    return []
  }
  if (isToolStatusActive(part.state.status) || part.state.status === 'error') {
    return []
  }
  const stateRecord = part.state as unknown as Record<string, unknown>
  const patchFiles = extractPatchFileDetails(
    part.state.input,
    stateRecord.output,
    workspaceDirectory
  )
  const metadataPatchFiles = extractPatchFileDetails(
    stateRecord.metadata,
    undefined,
    workspaceDirectory
  )
  const metadataFiles = extractMetaFileDiffDetails(stateRecord.metadata, workspaceDirectory)
  const writeFile = extractWriteFileDetail(
    part.state.input,
    stateRecord.metadata,
    workspaceDirectory
  )
  const merged = mergeChangedFileDetails(
    patchFiles,
    metadataPatchFiles,
    metadataFiles,
    writeFile ? [writeFile] : []
  )
  return merged.map((file, index) => ({
    id: `${part.id}:diff:${file.path}:${index}`,
    kind: 'diff' as const,
    path: file.path,
    type: file.type,
    diff: file.diff,
    insertions: file.insertions,
    deletions: file.deletions,
  }))
}

export function renderToolParts(
  parts: Part[],
  workspaceDirectory?: string | null
): UnifiedTimelineRenderRow[] {
  return parts
    .filter((part): part is Part & { type: 'tool' } => part.type === 'tool')
    .filter(part => {
      const kind = inferTimelineKind(part.tool, part.state.input, workspaceDirectory)
      const toolName = part.tool.trim().toLowerCase()
      const stateTitle =
        'title' in part.state && typeof part.state.title === 'string' ? part.state.title : undefined
      const hasShellCommand = Boolean(extractShellCommandForTool(part.state.input, stateTitle))
      if (kind === 'todo') {
        return true
      }
      if (isTaskToolName(part.tool)) {
        return false
      }
      if (isCommandToolName(toolName) && hasShellCommand) {
        return kind !== 'read' && kind !== 'search' && kind !== 'list'
      }
      return (
        part.state.status === 'error' && (kind === 'edit' || kind === 'create' || kind === 'delete')
      )
    })
    .flatMap<UnifiedTimelineRenderRow>(part => {
      const kind = inferTimelineKind(part.tool, part.state.input, workspaceDirectory)
      if (kind === 'todo') {
        return [
          {
            id: `tool:${part.id}:status`,
            kind: 'status' as const,
            label: part.state.status === 'running' ? 'Updating todo list' : 'Updated todo list',
          },
        ]
      }
      const props = buildToolCallCardProps(part, workspaceDirectory)
      if (isLowSignalActiveLabel(props.title) && !props.command && !props.output && !props.error) {
        return []
      }
      return [
        {
          id: `tool:${part.id}`,
          kind: 'tool' as const,
          title: props.title,
          expandedTitle: props.expandedTitle,
          status: props.status,
          command: props.command,
          output: props.output,
          error: props.error,
          defaultExpanded: false,
        },
      ]
    })
}
