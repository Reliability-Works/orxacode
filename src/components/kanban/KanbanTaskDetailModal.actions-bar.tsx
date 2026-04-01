import { Check, FolderOpen, GitPullRequest, Pencil, Play, RotateCcw, Square, Terminal, Trash2 } from 'lucide-react'
import type { KanbanScriptShortcutResult, KanbanSettings, KanbanWorktree } from '@shared/ipc'

type TaskActionButtonsProps = {
  workspaceDir: string
  taskId: string
  worktree: KanbanWorktree | null
  onRefresh: () => void
  onTerminalToggle: () => void
  onEditToggle: () => void
}

function TaskActionButtons({
  workspaceDir,
  taskId,
  worktree,
  onRefresh,
  onTerminalToggle,
  onEditToggle,
}: TaskActionButtonsProps) {
  return (
    <>
      <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.startTask(workspaceDir, taskId).then(onRefresh)}>
        <Play size={12} /> Start
      </button>
      <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.resumeTask(workspaceDir, taskId).then(onRefresh)}>
        <Play size={12} /> Resume
      </button>
      <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.stopTask(workspaceDir, taskId).then(onRefresh)}>
        <Square size={12} /> Stop
      </button>
      <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.commitTask(workspaceDir, taskId).then(onRefresh)}>
        <Check size={12} /> Commit
      </button>
      <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.openTaskPr(workspaceDir, taskId).then(onRefresh)}>
        <GitPullRequest size={12} /> Open PR
      </button>
      {worktree ? (
        <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.openWorktree(workspaceDir, worktree.id)}>
          <FolderOpen size={12} /> Open worktree
        </button>
      ) : null}
      <button type="button" className="kanban-filter-toggle" onClick={onTerminalToggle}>
        <Terminal size={12} /> Terminal
      </button>
      <button type="button" className="kanban-filter-toggle" onClick={onEditToggle}>
        <Pencil size={12} /> Edit
      </button>
    </>
  )
}

type TaskLifecycleButtonsProps = {
  workspaceDir: string
  taskId: string
  worktree: KanbanWorktree | null
  trashStatus: string
  hasConflictedMerge: boolean
  hasUnmergedWorktree: boolean
  onRefresh: () => void
  onClose: () => void
}

function TaskLifecycleButtons({
  workspaceDir,
  taskId,
  worktree,
  trashStatus,
  hasConflictedMerge,
  hasUnmergedWorktree,
  onRefresh,
  onClose,
}: TaskLifecycleButtonsProps) {
  return (
    <>
      {trashStatus === 'trashed' ? (
        <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.restoreTask(workspaceDir, taskId).then(onRefresh)}>
          <RotateCcw size={12} /> Restore
        </button>
      ) : (
        <button
          type="button"
          className="kanban-filter-toggle"
          onClick={() =>
            void window.orxa.kanban.trashTask(workspaceDir, taskId).then(() => {
              onRefresh()
              onClose()
            })
          }
        >
          <Trash2 size={12} /> Trash
        </button>
      )}
      {hasConflictedMerge ? (
        <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.resolveMergeWithAgent(workspaceDir, worktree!.id).then(onRefresh)}>
          Resolve merge
        </button>
      ) : null}
      {hasUnmergedWorktree ? (
        <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.mergeWorktree(workspaceDir, worktree!.id).then(onRefresh)}>
          Merge
        </button>
      ) : null}
    </>
  )
}

type ScriptShortcutButtonsProps = {
  settings: KanbanSettings | null
  workspaceDir: string
  taskId: string
  onShortcutResult: (result: KanbanScriptShortcutResult) => void
}

function ScriptShortcutButtons({
  settings,
  workspaceDir,
  taskId,
  onShortcutResult,
}: ScriptShortcutButtonsProps) {
  if (!settings?.scriptShortcuts.length) return null

  return (
    <>
      {settings.scriptShortcuts.map(shortcut => (
        <button
          key={shortcut.id}
          type="button"
          className="kanban-filter-toggle"
          onClick={() =>
            void window.orxa.kanban.runScriptShortcut(workspaceDir, taskId, shortcut.id).then(onShortcutResult)
          }
        >
          {shortcut.name || 'Shortcut'}
        </button>
      ))}
    </>
  )
}

export type OverviewActionsProps = {
  workspaceDir: string
  taskId: string
  worktree: KanbanWorktree | null
  trashStatus: string
  hasConflictedMerge: boolean
  hasUnmergedWorktree: boolean
  onRefresh: () => void
  onClose: () => void
  onTerminalToggle: () => void
  onEditToggle: () => void
  settings: KanbanSettings | null
  onShortcutResult: (result: KanbanScriptShortcutResult) => void
}

export function OverviewActions(props: OverviewActionsProps) {
  return (
    <div className="kanban-task-detail-actions">
      <TaskActionButtons
        workspaceDir={props.workspaceDir}
        taskId={props.taskId}
        worktree={props.worktree}
        onRefresh={props.onRefresh}
        onTerminalToggle={props.onTerminalToggle}
        onEditToggle={props.onEditToggle}
      />
      <TaskLifecycleButtons
        workspaceDir={props.workspaceDir}
        taskId={props.taskId}
        worktree={props.worktree}
        trashStatus={props.trashStatus}
        hasConflictedMerge={props.hasConflictedMerge}
        hasUnmergedWorktree={props.hasUnmergedWorktree}
        onRefresh={props.onRefresh}
        onClose={props.onClose}
      />
      <ScriptShortcutButtons
        settings={props.settings}
        workspaceDir={props.workspaceDir}
        taskId={props.taskId}
        onShortcutResult={props.onShortcutResult}
      />
    </div>
  )
}
