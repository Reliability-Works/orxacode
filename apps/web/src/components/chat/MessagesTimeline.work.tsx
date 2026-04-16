import { memo, useState } from 'react'
import {
  BotIcon,
  CheckIcon,
  CircleAlertIcon,
  EyeIcon,
  GlobeIcon,
  HammerIcon,
  type LucideIcon,
  SquarePenIcon,
  TerminalIcon,
  WrenchIcon,
  ZapIcon,
} from 'lucide-react'

import { normalizeCompactToolLabel } from './MessagesTimeline.logic'
import { type TimelineWorkEntry } from './MessagesTimeline.model'
import { ToolCallInlineDiff } from './ToolCallInlineDiff'
import { cn } from '~/lib/utils'
import { relativizeWorkspacePathsInText, toWorkspaceRelativePath } from '~/lib/workspacePath'

function workToneIcon(tone: TimelineWorkEntry['tone']): {
  icon: LucideIcon
  className: string
} {
  if (tone === 'error') return { icon: CircleAlertIcon, className: 'text-foreground/92' }
  if (tone === 'thinking') return { icon: BotIcon, className: 'text-foreground/92' }
  if (tone === 'info') return { icon: CheckIcon, className: 'text-foreground/92' }
  return { icon: ZapIcon, className: 'text-foreground/92' }
}

function workToneClass(tone: 'thinking' | 'tool' | 'info' | 'error'): string {
  if (tone === 'error') return 'text-rose-300/50 dark:text-rose-300/50'
  if (tone === 'tool') return 'text-muted-foreground/70'
  if (tone === 'thinking') return 'text-muted-foreground/50'
  return 'text-muted-foreground/40'
}

function extractFromJsonDetail(body: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const record = parsed as Record<string, unknown>
  const stringKey = (value: unknown): string | null => (typeof value === 'string' ? value : null)
  return (
    stringKey(record.file_path) ??
    stringKey(record.filePath) ??
    stringKey(record.path) ??
    stringKey(record.pattern) ??
    stringKey(record.command) ??
    stringKey(record.url) ??
    stringKey(record.query) ??
    (Array.isArray(record.todos) ? `${record.todos.length} todos` : null)
  )
}

function prettifyDetail(detail: string): string {
  const trimmed = detail.trim()
  const match = /^(?<name>[A-Za-z][\w-]*):\s*(?<body>[\s\S]+)$/u.exec(trimmed)
  const bodyFromMatch = match?.groups?.body?.trim()
  const body = bodyFromMatch && bodyFromMatch.length > 0 ? bodyFromMatch : trimmed
  if (body.startsWith('{') || body.startsWith('[')) {
    const extracted = extractFromJsonDetail(body)
    if (extracted) return extracted
  }
  return body
}

function workEntryPreview(
  workEntry: Pick<TimelineWorkEntry, 'detail' | 'command' | 'changedFiles'>,
  workspaceRoot: string | undefined
) {
  if ((workEntry.changedFiles?.length ?? 0) > 0) {
    const [firstPath] = workEntry.changedFiles ?? []
    if (firstPath) {
      const displayPath = toWorkspaceRelativePath(firstPath, workspaceRoot)
      return workEntry.changedFiles!.length === 1
        ? displayPath
        : `${displayPath} +${workEntry.changedFiles!.length - 1} more`
    }
  }
  if (workEntry.command) return relativizeWorkspacePathsInText(workEntry.command, workspaceRoot)
  if (workEntry.detail) {
    return relativizeWorkspacePathsInText(prettifyDetail(workEntry.detail), workspaceRoot)
  }
  return null
}

function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (workEntry.requestKind === 'command') return TerminalIcon
  if (workEntry.requestKind === 'file-read') return EyeIcon
  if (workEntry.requestKind === 'file-change') return SquarePenIcon
  if (workEntry.itemType === 'command_execution' || workEntry.command) return TerminalIcon
  if (workEntry.itemType === 'file_change' || (workEntry.changedFiles?.length ?? 0) > 0) {
    return SquarePenIcon
  }
  if (workEntry.itemType === 'web_search') return GlobeIcon
  if (workEntry.itemType === 'image_view') return EyeIcon
  switch (workEntry.itemType) {
    case 'mcp_tool_call':
      return WrenchIcon
    case 'dynamic_tool_call':
    case 'collab_agent_tool_call':
      return HammerIcon
  }
  return workToneIcon(workEntry.tone).icon
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) return value
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`
}

const ACTION_ROW_HEADINGS: Record<NonNullable<TimelineWorkEntry['action']>, string> = {
  read: 'Read',
  edit: 'Edit',
  create: 'Create',
  delete: 'Delete',
  search: 'Explore',
  list: 'List',
  command: 'Run',
  web: 'Web search',
  todo: 'Todo',
  tool: 'Tool',
}

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  if (workEntry.action) return ACTION_ROW_HEADINGS[workEntry.action]
  if (workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle))
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.label))
}

function renderWorkEntryIcon(workEntry: TimelineWorkEntry, className: string) {
  const Icon = workEntryIcon(workEntry)
  return <Icon className={className} />
}

function WorkEntryPreview(props: {
  preview: string
  canExpandDiff: boolean
  isDiffOpen: boolean
  onToggleDiff: () => void
}) {
  if (!props.canExpandDiff) {
    return <span className="text-muted-foreground/55"> - {props.preview}</span>
  }
  return (
    <>
      <span className="text-muted-foreground/55"> - </span>
      <button
        type="button"
        className="cursor-pointer text-muted-foreground/70 underline-offset-2 transition-colors duration-150 hover:text-foreground/90 hover:underline"
        onClick={props.onToggleDiff}
        aria-expanded={props.isDiffOpen}
      >
        {props.preview}
      </button>
    </>
  )
}

function ChangedFileBadges(props: {
  workEntry: TimelineWorkEntry
  workspaceRoot: string | undefined
}) {
  const { workEntry, workspaceRoot } = props
  const count = workEntry.changedFiles?.length ?? 0
  return (
    <div className="mt-1 flex flex-wrap gap-1 pl-6">
      {workEntry.changedFiles?.slice(0, 4).map(filePath => (
        <span
          key={`${workEntry.id}:${filePath}`}
          className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/75"
          title={filePath}
        >
          {toWorkspaceRelativePath(filePath, workspaceRoot)}
        </span>
      ))}
      {count > 4 && <span className="px-1 text-[10px] text-muted-foreground/55">+{count - 4}</span>}
    </div>
  )
}

export const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry
  workspaceRoot: string | undefined
}) {
  const { workEntry, workspaceRoot } = props
  const iconConfig = workToneIcon(workEntry.tone)
  const heading = toolWorkEntryHeading(workEntry)
  const preview = workEntryPreview(workEntry, workspaceRoot)
  const displayText = preview ? `${heading} - ${preview}` : heading
  const changedFileCount = workEntry.changedFiles?.length ?? 0
  const hasMultipleChangedFiles = changedFileCount > 1
  const previewIsChangedFiles = changedFileCount > 0 && !workEntry.command && !workEntry.detail
  const filePatch = workEntry.filePatches?.[0]
  const canExpandDiff = Boolean(filePatch && preview && changedFileCount === 1)
  const [isDiffOpen, setIsDiffOpen] = useState(false)

  return (
    <div className="rounded-lg px-1 py-1">
      <div className="flex items-center gap-2 transition-[opacity,translate] duration-200">
        <span
          className={cn('flex size-5 shrink-0 items-center justify-center', iconConfig.className)}
        >
          {renderWorkEntryIcon(workEntry, 'size-3')}
        </span>
        <div className="min-w-0 flex-1 overflow-hidden">
          <p
            className={cn(
              'truncate text-[11px] leading-5',
              workToneClass(workEntry.tone),
              preview ? 'text-muted-foreground/70' : ''
            )}
            title={displayText}
          >
            <span className={cn('text-foreground/80', workToneClass(workEntry.tone))}>
              {heading}
            </span>
            {preview && (
              <WorkEntryPreview
                preview={preview}
                canExpandDiff={canExpandDiff}
                isDiffOpen={isDiffOpen}
                onToggleDiff={() => setIsDiffOpen(open => !open)}
              />
            )}
          </p>
        </div>
      </div>
      {canExpandDiff && isDiffOpen && filePatch && (
        <div className="pl-7 pr-1">
          <ToolCallInlineDiff patchText={filePatch.patchText} filePath={filePatch.path} />
        </div>
      )}
      {hasMultipleChangedFiles && !previewIsChangedFiles && (
        <ChangedFileBadges workEntry={workEntry} workspaceRoot={workspaceRoot} />
      )}
    </div>
  )
})
