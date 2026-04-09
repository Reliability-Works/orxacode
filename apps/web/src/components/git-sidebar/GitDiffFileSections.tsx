import type { ReactNode } from 'react'
import type { GitDiffFile, GitDiffResult, GitDiffScopeKind } from '@orxa-code/contracts'
import { FilePlusIcon, MinusCircleIcon, RotateCcwIcon } from 'lucide-react'

import { Button } from '../ui/button'
import { cn } from '~/lib/utils'
import { getVisibleDiffSections } from './GitDiffFileSections.logic'

function DiffStatBadge({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null
  return (
    <span className="ml-auto shrink-0 font-mono text-[10px]">
      {additions > 0 && <span className="text-success">+{additions}</span>}
      {additions > 0 && deletions > 0 && <span className="text-muted-foreground/60"> </span>}
      {deletions > 0 && <span className="text-destructive">-{deletions}</span>}
    </span>
  )
}

function FileRow(props: {
  file: GitDiffFile
  selected: boolean
  onClick: () => void
  interactive: boolean
}) {
  const name = props.file.path.split('/').pop() ?? props.file.path
  const dir = props.file.path.includes('/')
    ? props.file.path.slice(0, props.file.path.lastIndexOf('/') + 1)
    : ''

  const content = (
    <>
      <span className="min-w-0 flex-1 truncate">
        {dir ? <span className="opacity-50">{dir}</span> : null}
        <span className="font-medium text-foreground">{name}</span>
      </span>
      <DiffStatBadge additions={props.file.additions} deletions={props.file.deletions} />
    </>
  )

  if (!props.interactive) {
    return (
      <div className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-muted-foreground">
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition-colors',
        props.selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
      )}
    >
      {content}
    </button>
  )
}

function FileActionButtons(props: {
  file: GitDiffFile
  pendingAction: string | null
  actionsEnabled: boolean
  stagePath: (path: string) => Promise<void>
  unstagePath: (path: string) => Promise<void>
  restorePath: (path: string) => Promise<void>
}) {
  const { file, pendingAction, actionsEnabled, stagePath, unstagePath, restorePath } = props

  if (!actionsEnabled) return null

  return (
    <div className="flex shrink-0 gap-0.5 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
      {file.section === 'unstaged' ? (
        <>
          <Button
            size="xs"
            variant="ghost"
            title="Stage"
            className="h-5 w-5 p-0"
            disabled={pendingAction !== null}
            onClick={() => void stagePath(file.path)}
          >
            <FilePlusIcon className="size-3" />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            title="Restore"
            className="h-5 w-5 p-0 text-destructive hover:text-destructive"
            disabled={pendingAction !== null}
            onClick={() => void restorePath(file.path)}
          >
            <RotateCcwIcon className="size-3" />
          </Button>
        </>
      ) : null}
      {file.section === 'staged' ? (
        <Button
          size="xs"
          variant="ghost"
          title="Unstage"
          className="h-5 w-5 p-0"
          disabled={pendingAction !== null}
          onClick={() => void unstagePath(file.path)}
        >
          <MinusCircleIcon className="size-3" />
        </Button>
      ) : null}
    </div>
  )
}

function SectionGroup(props: {
  label: string
  files: ReadonlyArray<GitDiffFile>
  selectedPath?: string | null
  pendingAction: string | null
  onSelect?: (file: GitDiffFile) => void
  stagePath: (path: string) => Promise<void>
  unstagePath: (path: string) => Promise<void>
  restorePath: (path: string) => Promise<void>
  interactive: boolean
  actionsEnabled: boolean
}) {
  if (props.files.length === 0) return null
  const onSelect = props.onSelect ?? (() => undefined)

  return (
    <div className="flex flex-col gap-0.5">
      <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        {props.label} ({props.files.length})
      </p>
      {props.files.map(file => (
        <div key={`${file.section}:${file.path}`} className="group flex items-center gap-0.5">
          <div className="min-w-0 flex-1">
            <FileRow
              file={file}
              selected={props.selectedPath === file.path}
              onClick={() => onSelect(file)}
              interactive={props.interactive}
            />
          </div>
          <FileActionButtons
            file={file}
            pendingAction={props.pendingAction}
            actionsEnabled={props.actionsEnabled}
            stagePath={props.stagePath}
            unstagePath={props.unstagePath}
            restorePath={props.restorePath}
          />
        </div>
      ))}
    </div>
  )
}

type GitDiffActions = {
  stagePath: (path: string) => Promise<void>
  unstagePath: (path: string) => Promise<void>
  restorePath: (path: string) => Promise<void>
}

export function GitDiffListView(props: {
  data: GitDiffResult
  scope: GitDiffScopeKind
  pendingAction: string | null
  actions: GitDiffActions
}): ReactNode {
  const sections = getVisibleDiffSections(props.data, props.scope)
  const actionsEnabled = props.scope !== 'branch'
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-2">
      {sections.map(section => (
        <SectionGroup
          key={section.kind}
          label={section.label}
          files={section.files}
          pendingAction={props.pendingAction}
          stagePath={props.actions.stagePath}
          unstagePath={props.actions.unstagePath}
          restorePath={props.actions.restorePath}
          interactive={false}
          actionsEnabled={actionsEnabled}
        />
      ))}
    </div>
  )
}

export function GitDiffTreePane(props: {
  data: GitDiffResult
  scope: GitDiffScopeKind
  activePath: string | null
  pendingAction: string | null
  onSelectPath: (path: string) => void
  actions: GitDiffActions
}): ReactNode {
  const sections = getVisibleDiffSections(props.data, props.scope)
  const actionsEnabled = props.scope !== 'branch'
  return (
    <div className="w-52 shrink-0 overflow-y-auto border-r border-border p-2">
      {sections.map(section => (
        <SectionGroup
          key={section.kind}
          label={section.label}
          files={section.files}
          selectedPath={props.activePath}
          pendingAction={props.pendingAction}
          onSelect={file => props.onSelectPath(file.path)}
          stagePath={props.actions.stagePath}
          unstagePath={props.actions.unstagePath}
          restorePath={props.actions.restorePath}
          interactive={true}
          actionsEnabled={actionsEnabled}
        />
      ))}
    </div>
  )
}
