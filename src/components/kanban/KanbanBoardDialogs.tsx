import { Trash2 } from 'lucide-react'
import type { KanbanBoardSnapshot, KanbanTask, KanbanTaskDetail } from '@shared/ipc'
import { KANBAN_COLUMNS, providerLabel } from './kanban-utils'
import { taskProviderDefaults, type TaskDraft } from './kanban-board-utils'
import { KanbanDropdown } from './KanbanDropdown'
import { KanbanTaskDetailModal } from './KanbanTaskDetailModal'
import { KanbanTaskProviderConfigFields } from './KanbanTaskProviderConfigFields'
import type { AutomationDraft } from './KanbanBoard.types'

function KanbanTaskModal(props: {
  onClose: () => void
  onCreate: () => void
  onRegenerateField: (field: 'title' | 'description' | 'prompt') => void
  regeneratingField: 'title' | 'description' | 'prompt' | null
  selectedWorkspaceDir: string
  setTaskDraft: React.Dispatch<React.SetStateAction<TaskDraft>>
  snapshot: KanbanBoardSnapshot | null
  taskDraft: TaskDraft
}) {
  return (
    <div className="kanban-pane-overlay" onClick={props.onClose}>
      <section className="modal kanban-modal kanban-sheet-modal" onClick={event => event.stopPropagation()}>
        <header className="modal-header"><h2>Create task</h2><button type="button" className="modal-close-btn" onClick={props.onClose}>X</button></header>
        <div className="kanban-modal-body">
          <label className="kanban-field">Title<input value={props.taskDraft.title} onChange={event => props.setTaskDraft(current => ({ ...current, title: event.target.value }))} /><button type="button" className="kanban-inline-meta-btn" disabled={props.regeneratingField === 'title'} onClick={() => props.onRegenerateField('title')}>{props.regeneratingField === 'title' ? 'Regenerating...' : 'Regenerate with AI'}</button></label>
          <label className="kanban-field">Description<input value={props.taskDraft.description} onChange={event => props.setTaskDraft(current => ({ ...current, description: event.target.value }))} /><button type="button" className="kanban-inline-meta-btn" disabled={props.regeneratingField === 'description'} onClick={() => props.onRegenerateField('description')}>{props.regeneratingField === 'description' ? 'Regenerating...' : 'Regenerate with AI'}</button></label>
          <label className="kanban-field">Prompt<textarea rows={5} value={props.taskDraft.prompt} onChange={event => props.setTaskDraft(current => ({ ...current, prompt: event.target.value }))} /><button type="button" className="kanban-inline-meta-btn" disabled={props.regeneratingField === 'prompt'} onClick={() => props.onRegenerateField('prompt')}>{props.regeneratingField === 'prompt' ? 'Regenerating...' : 'Regenerate with AI'}</button></label>
          <label className="kanban-field"><span>Provider</span><div className="kanban-segmented-control">{(['opencode', 'codex', 'claude'] as const).map(provider => <button key={provider} type="button" className={props.taskDraft.provider === provider ? 'active' : ''} onClick={() => props.setTaskDraft(current => ({ ...current, provider, providerConfig: taskProviderDefaults(props.snapshot?.settings, provider) }))}>{providerLabel(provider)}</button>)}</div></label>
          <section className="kanban-task-config-section"><h3>Provider config</h3><KanbanTaskProviderConfigFields workspaceDir={props.selectedWorkspaceDir} provider={props.taskDraft.provider} providerConfig={props.taskDraft.providerConfig} onChange={providerConfig => props.setTaskDraft(current => ({ ...current, providerConfig }))} /></section>
          <div className="kanban-field"><span>Column</span><KanbanDropdown value={props.taskDraft.columnId} options={KANBAN_COLUMNS.map(column => ({ value: column.id, label: column.label }))} onChange={columnId => props.setTaskDraft(current => ({ ...current, columnId }))} /></div>
          <label className="kanban-toggle-row"><span>Auto start when unblocked</span><button type="button" role="switch" aria-checked={props.taskDraft.autoStartWhenUnblocked} className={`kanban-switch${props.taskDraft.autoStartWhenUnblocked ? ' on' : ''}`} onClick={() => props.setTaskDraft(current => ({ ...current, autoStartWhenUnblocked: !current.autoStartWhenUnblocked }))}><span className="kanban-switch-thumb" /></button></label>
          <footer className="kanban-modal-footer"><button type="button" className="kanban-filter-toggle" onClick={props.onClose}>Cancel</button><button type="button" className="kanban-primary-btn" onClick={props.onCreate}>Create</button></footer>
        </div>
      </section>
    </div>
  )
}

function KanbanAutomationModal(props: {
  automationDraft: AutomationDraft
  editingAutomationId: string | null
  onClose: () => void
  onSubmit: () => void
  setAutomationDraft: React.Dispatch<React.SetStateAction<AutomationDraft>>
}) {
  return (
    <div className="kanban-pane-overlay" onClick={props.onClose}>
      <section className="modal kanban-modal kanban-sheet-modal" onClick={event => event.stopPropagation()}>
        <header className="modal-header"><h2>{props.editingAutomationId ? 'Edit automation' : 'Create automation'}</h2><button type="button" className="modal-close-btn" onClick={props.onClose}>X</button></header>
        <div className="kanban-modal-body">
          <label className="kanban-field">Name<input value={props.automationDraft.name} onChange={event => props.setAutomationDraft(current => ({ ...current, name: event.target.value }))} /></label>
          <label className="kanban-field">Prompt<textarea rows={5} value={props.automationDraft.prompt} onChange={event => props.setAutomationDraft(current => ({ ...current, prompt: event.target.value }))} /></label>
          <label className="kanban-field"><span>Provider</span><div className="kanban-segmented-control">{(['opencode', 'codex', 'claude'] as const).map(provider => <button key={provider} type="button" className={props.automationDraft.provider === provider ? 'active' : ''} onClick={() => props.setAutomationDraft(current => ({ ...current, provider }))}>{providerLabel(provider)}</button>)}</div></label>
          <label className="kanban-toggle-row"><span>Auto start</span><button type="button" role="switch" aria-checked={props.automationDraft.autoStart} className={`kanban-switch${props.automationDraft.autoStart ? ' on' : ''}`} onClick={() => props.setAutomationDraft(current => ({ ...current, autoStart: !current.autoStart }))}><span className="kanban-switch-thumb" /></button></label>
          <section className="kanban-schedule-section"><div className="kanban-schedule-header"><span>Schedule</span><div className="kanban-segmented-control"><button type="button" className={props.automationDraft.schedule.type === 'daily' ? 'active' : ''} onClick={() => props.setAutomationDraft(current => ({ ...current, schedule: { type: 'daily', time: '09:00', days: [1, 2, 3, 4, 5] } }))}>Daily</button><button type="button" className={props.automationDraft.schedule.type === 'interval' ? 'active' : ''} onClick={() => props.setAutomationDraft(current => ({ ...current, schedule: { type: 'interval', intervalMinutes: 240 } }))}>Interval</button></div></div>{props.automationDraft.schedule.type === 'daily' ? <label className="kanban-field">Time<input type="time" value={props.automationDraft.schedule.time} onChange={event => props.setAutomationDraft(current => ({ ...current, schedule: { ...current.schedule, time: event.target.value } as AutomationDraft['schedule'] }))} /></label> : <label className="kanban-field">Every (minutes)<input type="number" min={5} step={5} value={props.automationDraft.schedule.intervalMinutes} onChange={event => props.setAutomationDraft(current => ({ ...current, schedule: { type: 'interval', intervalMinutes: Math.max(5, Number(event.target.value) || 5) } }))} /></label>}</section>
          <footer className="kanban-modal-footer"><button type="button" className="kanban-filter-toggle" onClick={props.onClose}>Cancel</button><button type="button" className="kanban-primary-btn" onClick={props.onSubmit}>{props.editingAutomationId ? 'Save' : 'Create'}</button></footer>
        </div>
      </section>
    </div>
  )
}

export function KanbanBoardDialogs(props: {
  activeDetailTaskIdRef: React.MutableRefObject<string | null>
  automationDraft: AutomationDraft
  automationModalOpen: boolean
  contextMenu: { task: KanbanTask; x: number; y: number } | null
  detail: KanbanTaskDetail | null
  detailError: string | null
  editingAutomationId: string | null
  onCloseAutomationModal: () => void
  onCloseContextMenu: () => void
  onCloseDetail: () => void
  onCloseDetailError: () => void
  onCloseTaskModal: () => void
  onCreateTask: () => void
  onOpenContextTask: (task: KanbanTask) => void
  onRefreshDetail: () => void
  onRegenerateTaskField: (field: 'title' | 'description' | 'prompt') => void
  onSubmitAutomation: () => void
  onTrashTask: (task: KanbanTask) => void
  regeneratingField: 'title' | 'description' | 'prompt' | null
  selectedWorkspaceDir: string
  setAutomationDraft: React.Dispatch<React.SetStateAction<AutomationDraft>>
  setAutomationModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setEditingAutomationId: React.Dispatch<React.SetStateAction<string | null>>
  setTaskDraft: React.Dispatch<React.SetStateAction<TaskDraft>>
  snapshot: KanbanBoardSnapshot | null
  taskDraft: TaskDraft
  taskModalOpen: boolean
}) {
  const { contextMenu } = props
  return (
    <>
      {props.taskModalOpen ? <KanbanTaskModal onClose={props.onCloseTaskModal} onCreate={props.onCreateTask} onRegenerateField={props.onRegenerateTaskField} regeneratingField={props.regeneratingField} selectedWorkspaceDir={props.selectedWorkspaceDir} setTaskDraft={props.setTaskDraft} snapshot={props.snapshot} taskDraft={props.taskDraft} /> : null}
      {props.automationModalOpen ? <KanbanAutomationModal automationDraft={props.automationDraft} editingAutomationId={props.editingAutomationId} onClose={props.onCloseAutomationModal} onSubmit={props.onSubmitAutomation} setAutomationDraft={props.setAutomationDraft} /> : null}
      {props.detail ? <KanbanTaskDetailModal detail={props.detail} snapshot={{ tasks: props.snapshot?.tasks ?? [], dependencies: props.snapshot?.dependencies ?? [] }} workspaceDir={props.selectedWorkspaceDir} onClose={props.onCloseDetail} onRefresh={props.onRefreshDetail} /> : null}
      {props.detailError && !props.detail ? <div className="kanban-pane-overlay" onClick={props.onCloseDetailError}><section className="modal kanban-modal kanban-sheet-modal" onClick={event => event.stopPropagation()}><header className="modal-header"><h2>Error</h2><button type="button" className="modal-close-btn" onClick={props.onCloseDetailError}>X</button></header><div className="kanban-modal-body"><p className="skills-error">{props.detailError}</p></div></section></div> : null}
      {contextMenu ? <div className="kanban-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}><button type="button" onClick={() => { props.onCloseContextMenu(); void props.onOpenContextTask(contextMenu.task) }}>Open task</button>{contextMenu.task.columnId === 'done' ? <button type="button" onClick={() => void props.onTrashTask(contextMenu.task)}><Trash2 size={12} /> Trash task</button> : null}</div> : null}
    </>
  )
}
