import { DndContext, DragOverlay, closestCorners, type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core'
import { Play, Plus, WandSparkles } from 'lucide-react'
import type { KanbanBoardSnapshot, KanbanTask, KanbanTaskStatusSummary, KanbanWorkspace } from '@shared/ipc'
import { KanbanColumn } from './KanbanTaskCard'
import { KANBAN_COLUMNS, providerLabel, scheduleSummary } from './kanban-utils'
import { KanbanGitPanel } from './KanbanGitPanel'
import { KanbanManagementChat } from './KanbanManagementChat'
import { KanbanSettingsPanel } from './KanbanSettingsPanel'
import { KanbanWorktreesPanel } from './KanbanWorktreesPanel'
import { DEFAULT_AUTOMATION_TEMPLATES, type AutomationDraft, type KanbanDependencyEdge, type KanbanLinkState } from './KanbanBoard.types'

function KanbanBoardPanel(props: {
  activeTask: KanbanTask | null
  boardCanvasRef: React.RefObject<HTMLDivElement | null>
  dependencyEdges: KanbanDependencyEdge[]
  handleDragEnd: (event: DragEndEvent) => void
  handleLinkComplete: (task: KanbanTask) => void
  handleLinkHover: (task: KanbanTask | null, event?: React.PointerEvent<HTMLButtonElement>) => void
  handleLinkStart: (task: KanbanTask, event: React.PointerEvent<HTMLButtonElement>) => void
  hoveredDependencyId: string | null
  linking: KanbanLinkState
  onHoverDependencyEnter: (id: string) => void
  onHoverDependencyLeave: (id: string) => void
  onOpenTask: (task: KanbanTask) => void
  onTrashTask: (task: KanbanTask) => void
  onUnlinkDependency: (id: string) => void
  runtimeStatuses: Map<string, KanbanTaskStatusSummary>
  sensors: SensorDescriptor<SensorOptions>[]
  setContextMenu: React.Dispatch<React.SetStateAction<{ task: KanbanTask; x: number; y: number } | null>>
  setDraggedTaskId: React.Dispatch<React.SetStateAction<string | null>>
  showDependencies: boolean
  tasksByColumn: Map<string, KanbanTask[]>
}) {
  const {
    activeTask,
    boardCanvasRef,
    dependencyEdges,
    handleDragEnd,
    handleLinkComplete,
    handleLinkHover,
    handleLinkStart,
    hoveredDependencyId,
    linking,
    onHoverDependencyEnter,
    onHoverDependencyLeave,
    onOpenTask,
    onTrashTask,
    onUnlinkDependency,
    runtimeStatuses,
    sensors,
    setContextMenu,
    setDraggedTaskId,
    showDependencies,
    tasksByColumn,
  } = props
  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={event => setDraggedTaskId(String(event.active.id))} onDragEnd={event => void handleDragEnd(event)} onDragCancel={() => setDraggedTaskId(null)}>
      <div ref={boardCanvasRef} className="kanban-columns">
        {showDependencies && dependencyEdges.length > 0 ? (
          <svg className="kanban-linking-overlay kanban-linking-overlay--dependencies" aria-hidden="true">
            <defs>
              <marker id="kanban-dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 7 4 L 0 7 z" className="kanban-dep-arrow-fill" /></marker>
              <marker id="kanban-dep-arrow-hover" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 1 L 7 4 L 0 7 z" className="kanban-dep-arrow-fill-hover" /></marker>
            </defs>
            {dependencyEdges.map(edge => (
              <g key={edge.id}>
                <path d={`M ${edge.x1} ${edge.y1} C ${edge.cx1} ${edge.cy1}, ${edge.cx2} ${edge.cy2}, ${edge.x2} ${edge.y2}`} className={`kanban-dependency-edge${hoveredDependencyId === edge.id ? ' is-hovered' : ''}`.trim()} markerEnd={hoveredDependencyId === edge.id ? 'url(#kanban-dep-arrow-hover)' : 'url(#kanban-dep-arrow)'} />
                <path d={`M ${edge.x1} ${edge.y1} C ${edge.cx1} ${edge.cy1}, ${edge.cx2} ${edge.cy2}, ${edge.x2} ${edge.y2}`} className="kanban-dependency-edge-hit" data-dependency-edge-hit={edge.id} onPointerEnter={() => onHoverDependencyEnter(edge.id)} onPointerLeave={() => onHoverDependencyLeave(edge.id)} onClick={() => void onUnlinkDependency(edge.id)} />
              </g>
            ))}
          </svg>
        ) : null}
        {linking ? (() => {
          const endX = linking.targetX ?? linking.currentX
          const endY = linking.targetY ?? linking.currentY
          const pull = Math.max(42, Math.min(Math.abs(endX - linking.startX) * 0.4, 180))
          return (
            <svg className="kanban-linking-overlay" aria-hidden="true">
              <defs><marker id="kanban-link-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" className="kanban-linking-arrow-fill" /></marker></defs>
              <path d={`M ${linking.startX} ${linking.startY} C ${linking.startX + pull} ${linking.startY}, ${endX - pull} ${endY}, ${endX} ${endY}`} className={`kanban-linking-path${linking.hoverTaskId ? ' is-snapped' : ''}`} markerEnd="url(#kanban-link-arrow)" />
            </svg>
          )
        })() : null}
        {KANBAN_COLUMNS.map(column => (
          <KanbanColumn key={column.id} column={column} tasks={tasksByColumn.get(column.id) ?? []} runtimeStatuses={runtimeStatuses} onOpenTask={task => void onOpenTask(task)} onTrashTask={task => void onTrashTask(task)} onContextTask={(task, x, y) => setContextMenu({ task, x, y })} onLinkStart={handleLinkStart} onLinkComplete={task => void handleLinkComplete(task)} onLinkHover={handleLinkHover} linkingSourceTaskId={linking?.fromTaskId ?? null} linkingTargetTaskId={linking?.hoverTaskId ?? null} />
        ))}
      </div>
      <DragOverlay>{activeTask ? <article className="kanban-task-card is-drag-overlay"><strong>{activeTask.title}</strong></article> : null}</DragOverlay>
    </DndContext>
  )
}

function KanbanAutomationsPanel(props: {
  automations: KanbanBoardSnapshot['automations']
  loadBoard: (workspaceDir: string, options?: { silent?: boolean }) => Promise<void>
  selectedWorkspaceDir: string
  setAutomationDraft: React.Dispatch<React.SetStateAction<AutomationDraft>>
  setAutomationModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setEditingAutomationId: React.Dispatch<React.SetStateAction<string | null>>
  workspaces: KanbanWorkspace[]
}) {
  return (
    <section className="kanban-automations">
      <div className="kanban-section-header"><h2>Configured automations</h2><button type="button" className="kanban-primary-btn" onClick={() => props.setAutomationModalOpen(true)}><Plus size={13} aria-hidden="true" />New automation</button></div>
      <div className="kanban-list-grid">
        {props.automations.map(automation => (
          <article key={automation.id} className="kanban-list-card">
            <header className="kanban-list-card-header"><strong>{automation.name}</strong><div className="kanban-list-card-badges"><span className={`kanban-task-pill kanban-task-pill--status${automation.enabled ? ' is-success' : ' is-blocked'}`.trim()}>{automation.enabled ? 'enabled' : 'paused'}</span><span className="kanban-task-pill kanban-task-pill--provider">{providerLabel(automation.provider)}</span></div></header>
            <p className="kanban-list-card-desc">{automation.prompt}</p>
            <footer className="kanban-list-card-footer"><span>{scheduleSummary(automation.schedule)}</span><span>{props.workspaces.find(workspace => workspace.directory === automation.workspaceDir)?.name ?? automation.workspaceDir}</span></footer>
            <div className="kanban-list-card-actions">
              <button type="button" className="kanban-filter-toggle" onClick={() => { props.setAutomationDraft({ name: automation.name, prompt: automation.prompt, provider: automation.provider, browserModeEnabled: automation.browserModeEnabled, enabled: automation.enabled, autoStart: automation.autoStart, schedule: automation.schedule }); props.setEditingAutomationId(automation.id); props.setAutomationModalOpen(true) }}>Edit</button>
              <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.runAutomationNow(automation.workspaceDir, automation.id).then(() => props.loadBoard(automation.workspaceDir))}><Play size={11} aria-hidden="true" /> Run now</button>
              <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.deleteAutomation(automation.workspaceDir, automation.id).then(() => props.loadBoard(automation.workspaceDir))}>Delete</button>
            </div>
          </article>
        ))}
        {props.automations.length === 0 ? <div className="kanban-empty-state">No automations configured</div> : null}
      </div>
      <div className="kanban-section-header"><h2>Templates</h2></div>
      <div className="kanban-list-grid kanban-list-grid--3col">
        {DEFAULT_AUTOMATION_TEMPLATES.map(template => (
          <article key={template.name} className="kanban-list-card">
            <header className="kanban-list-card-header"><span className="kanban-template-icon"><WandSparkles size={13} aria-hidden="true" /></span><strong>{template.name}</strong></header>
            <p className="kanban-list-card-desc">{template.prompt}</p>
            <footer className="kanban-list-card-footer"><span>{scheduleSummary(template.schedule)}</span></footer>
            <button type="button" className="kanban-filter-toggle" onClick={() => { props.setAutomationDraft({ name: template.name, prompt: template.prompt, provider: template.provider, browserModeEnabled: false, enabled: true, autoStart: true, schedule: template.schedule }); props.setAutomationModalOpen(true) }}>Use template</button>
          </article>
        ))}
      </div>
    </section>
  )
}

export function KanbanBoardPanels(props: {
  activeTab: string
  activeTask: KanbanTask | null
  automations: KanbanBoardSnapshot['automations']
  boardCanvasRef: React.RefObject<HTMLDivElement | null>
  dependencyEdges: KanbanDependencyEdge[]
  handleDragEnd: (event: DragEndEvent) => void
  handleLinkComplete: (task: KanbanTask) => void
  handleLinkHover: (task: KanbanTask | null, event?: React.PointerEvent<HTMLButtonElement>) => void
  handleLinkStart: (task: KanbanTask, event: React.PointerEvent<HTMLButtonElement>) => void
  hoveredDependencyId: string | null
  linking: KanbanLinkState
  loadBoard: (workspaceDir: string, options?: { silent?: boolean }) => Promise<void>
  loading: boolean
  onCreateAutomationDraftChange: React.Dispatch<React.SetStateAction<AutomationDraft>>
  onHoverDependencyEnter: (id: string) => void
  onHoverDependencyLeave: (id: string) => void
  onOpenTask: (task: KanbanTask) => void
  onTrashTask: (task: KanbanTask) => void
  onUnlinkDependency: (id: string) => void
  refreshError: string | null
  runs: KanbanBoardSnapshot['runs']
  runtimeStatuses: Map<string, KanbanTaskStatusSummary>
  selectedWorkspaceDir: string
  sensors: SensorDescriptor<SensorOptions>[]
  setAutomationModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setContextMenu: React.Dispatch<React.SetStateAction<{ task: KanbanTask; x: number; y: number } | null>>
  setDraggedTaskId: React.Dispatch<React.SetStateAction<string | null>>
  setEditingAutomationId: React.Dispatch<React.SetStateAction<string | null>>
  showDependencies: boolean
  snapshot: KanbanBoardSnapshot | null
  tasksByColumn: Map<string, KanbanTask[]>
  workspaces: KanbanWorkspace[]
}) {
  if (props.refreshError) return <p className="skills-error" style={{ padding: '10px 16px' }}>{props.refreshError}</p>
  if (props.loading) return <div className="kanban-empty-state" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>
  if (!props.loading && !props.selectedWorkspaceDir) return <div className="kanban-empty-state" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Add a Kanban workspace to start building a board.</div>
  if (!props.selectedWorkspaceDir) return null
  if (props.activeTab === 'board') return <KanbanBoardPanel activeTask={props.activeTask} boardCanvasRef={props.boardCanvasRef} dependencyEdges={props.dependencyEdges} handleDragEnd={props.handleDragEnd} handleLinkComplete={props.handleLinkComplete} handleLinkHover={props.handleLinkHover} handleLinkStart={props.handleLinkStart} hoveredDependencyId={props.hoveredDependencyId} linking={props.linking} onHoverDependencyEnter={props.onHoverDependencyEnter} onHoverDependencyLeave={props.onHoverDependencyLeave} onOpenTask={props.onOpenTask} onTrashTask={props.onTrashTask} onUnlinkDependency={props.onUnlinkDependency} runtimeStatuses={props.runtimeStatuses} sensors={props.sensors} setContextMenu={props.setContextMenu} setDraggedTaskId={props.setDraggedTaskId} showDependencies={props.showDependencies} tasksByColumn={props.tasksByColumn} />
  if (props.activeTab === 'runs') return <section className="kanban-runs">{props.runs.map(run => <article key={run.id} className="kanban-list-card"><header className="kanban-list-card-header"><strong>{run.taskId ? (props.snapshot?.tasks.find(task => task.id === run.taskId)?.title ?? run.taskId) : 'Automation run'}</strong><div className="kanban-list-card-badges"><span className="kanban-task-pill kanban-task-pill--provider">{providerLabel(run.provider)}</span><span className={`kanban-task-pill kanban-task-pill--status${run.status === 'completed' ? ' is-success' : run.status === 'failed' ? ' is-error' : ''}`.trim()}>{run.status}</span></div></header><footer className="kanban-list-card-footer"><span>{new Date(run.createdAt).toLocaleString()}</span><span>{props.workspaces.find(workspace => workspace.directory === run.workspaceDir)?.name ?? run.workspaceDir}</span><button type="button" className="kanban-task-inline-action" onClick={() => { const task = props.snapshot?.tasks.find(candidate => candidate.id === run.taskId); if (task) void props.onOpenTask(task) }}>Open task</button></footer></article>)}{props.runs.length === 0 ? <div className="kanban-empty-state">No runs yet</div> : null}</section>
  if (props.activeTab === 'automations') return <KanbanAutomationsPanel automations={props.automations} loadBoard={props.loadBoard} selectedWorkspaceDir={props.selectedWorkspaceDir} setAutomationDraft={props.onCreateAutomationDraftChange} setAutomationModalOpen={props.setAutomationModalOpen} setEditingAutomationId={props.setEditingAutomationId} workspaces={props.workspaces} />
  if (props.activeTab === 'worktrees') return <KanbanWorktreesPanel workspaceDir={props.selectedWorkspaceDir} worktrees={props.snapshot?.worktrees ?? []} trashedTasks={props.snapshot?.trashedTasks ?? []} onRefresh={() => void props.loadBoard(props.selectedWorkspaceDir, { silent: true })} />
  if (props.activeTab === 'settings') return <KanbanSettingsPanel workspaceDir={props.selectedWorkspaceDir} />
  if (props.activeTab === 'git') return <KanbanGitPanel workspaceDir={props.selectedWorkspaceDir} />
  return <KanbanManagementChat workspaceDir={props.selectedWorkspaceDir} />
}

export function KanbanDependencyStrip(props: { showDependencies: boolean; snapshot: KanbanBoardSnapshot | null }) {
  if (!props.showDependencies || !props.snapshot?.dependencies.length) return null
  return (
    <section className="kanban-dependency-strip">
      <h2>Dependencies</h2>
      <div className="kanban-dependency-list">
        {props.snapshot.dependencies.map(dependency => {
          const fromTitle = props.snapshot?.tasks.find(task => task.id === dependency.fromTaskId)?.title ?? dependency.fromTaskId
          const toTitle = props.snapshot?.tasks.find(task => task.id === dependency.toTaskId)?.title ?? dependency.toTaskId
          return <span key={dependency.id} className="kanban-task-pill">{fromTitle} → {toTitle}</span>
        })}
      </div>
    </section>
  )
}
