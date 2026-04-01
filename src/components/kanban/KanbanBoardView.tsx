import { KanbanBoardDialogs } from './KanbanBoardDialogs'
import { KanbanDependencyStrip, KanbanBoardPanels } from './KanbanBoardPanels'
import { KanbanBoardToolbar } from './KanbanBoardToolbar'
import { useKanbanBoardController } from './useKanbanBoardController'

function buildToolbarProps(controller: ReturnType<typeof useKanbanBoardController>) {
  const { actions, data, state } = controller
  return {
    activeTab: state.activeTab,
    branchLikeCounts: { trashedCount: data.trashedCount, worktreeCount: data.worktreeCount },
    onAddWorkspace: () => void actions.handleAddWorkspace(),
    onCreateTask: actions.openCreateTaskModal,
    onRefresh: () =>
      state.selectedWorkspaceDir && void data.loadBoard(state.selectedWorkspaceDir, { silent: true }),
    onSelectTab: state.setActiveTab,
    providerFilter: state.providerFilter,
    setProviderFilter: state.setProviderFilter,
    refreshing: state.refreshing,
    selectedWorkspaceDir: state.selectedWorkspaceDir,
    setSelectedWorkspaceDir: state.setSelectedWorkspaceDir,
    showDependencies: state.showDependencies,
    setShowDependencies: state.setShowDependencies,
    statusFilter: state.statusFilter,
    setStatusFilter: (value: string) => state.setStatusFilter(value as typeof state.statusFilter),
    workspaceOptions: data.workspaceOptions,
  }
}

function buildPanelsProps(controller: ReturnType<typeof useKanbanBoardController>) {
  const { actions, data, interactions, state } = controller
  return {
    activeTab: state.activeTab,
    activeTask: data.activeTask,
    automations: data.automations,
    boardCanvasRef: state.boardCanvasRef,
    dependencyEdges: state.dependencyEdges,
    handleDragEnd: interactions.handleDragEnd,
    handleLinkComplete: interactions.handleLinkComplete,
    handleLinkHover: interactions.handleLinkHover,
    handleLinkStart: interactions.handleLinkStart,
    hoveredDependencyId: state.hoveredDependencyId,
    linking: state.linking,
    loadBoard: data.loadBoard,
    loading: state.loading,
    onCreateAutomationDraftChange: state.setAutomationDraft,
    onHoverDependencyEnter: (id: string) => state.setHoveredDependencyId(id),
    onHoverDependencyLeave: (id: string) =>
      state.setHoveredDependencyId(current => (current === id ? null : current)),
    onOpenTask: (task: Parameters<typeof actions.openTaskDetail>[0]) => void actions.openTaskDetail(task),
    onTrashTask: (task: Parameters<typeof actions.trashTask>[0]) => void actions.trashTask(task),
    onUnlinkDependency: (id: string) => void interactions.unlinkDependency(id),
    refreshError: state.error,
    runs: data.runs,
    runtimeStatuses: data.runtimeStatuses,
    selectedWorkspaceDir: state.selectedWorkspaceDir,
    sensors: state.sensors,
    setAutomationModalOpen: state.setAutomationModalOpen,
    setContextMenu: state.setContextMenu,
    setDraggedTaskId: state.setDraggedTaskId,
    setEditingAutomationId: state.setEditingAutomationId,
    showDependencies: state.showDependencies,
    snapshot: state.snapshot,
    tasksByColumn: data.tasksByColumn,
    workspaces: state.workspaces,
  }
}

function buildDialogsProps(controller: ReturnType<typeof useKanbanBoardController>) {
  const { actions, state } = controller
  const activeDetailTaskIdRef = state.activeDetailTaskIdRef
  return {
    activeDetailTaskIdRef,
    automationDraft: state.automationDraft,
    automationModalOpen: state.automationModalOpen,
    contextMenu: state.contextMenu,
    detail: state.detail,
    detailError: state.detailError,
    editingAutomationId: state.editingAutomationId,
    onCloseAutomationModal: () => {
      state.setAutomationModalOpen(false)
      state.setEditingAutomationId(null)
    },
    onCloseContextMenu: () => state.setContextMenu(null),
    onCloseDetail: () => {
      activeDetailTaskIdRef.current = null
      state.setDetail(null)
      state.setDetailError(null)
    },
    onCloseDetailError: () => state.setDetailError(null),
    onCloseTaskModal: () => state.setTaskModalOpen(false),
    onCreateTask: () => void actions.handleCreateTask(),
    onOpenContextTask: actions.openTaskDetail,
    onRefreshDetail: actions.refreshDetail,
    onRegenerateTaskField: (field: Parameters<typeof actions.regenerateTaskDraftField>[0]) =>
      void actions.regenerateTaskDraftField(field),
    onSubmitAutomation: () =>
      void (state.editingAutomationId ? actions.handleUpdateAutomation() : actions.handleCreateAutomation()),
    onTrashTask: (task: Parameters<typeof actions.trashTask>[0]) => void actions.trashTask(task),
    regeneratingField: state.regeneratingField,
    selectedWorkspaceDir: state.selectedWorkspaceDir,
    setAutomationDraft: state.setAutomationDraft,
    setAutomationModalOpen: state.setAutomationModalOpen,
    setEditingAutomationId: state.setEditingAutomationId,
    setTaskDraft: state.setTaskDraft,
    snapshot: state.snapshot,
    taskDraft: state.taskDraft,
    taskModalOpen: state.taskModalOpen,
  }
}

export function KanbanBoardView(controller: ReturnType<typeof useKanbanBoardController>) {
  const toolbarProps = buildToolbarProps(controller)
  const panelsProps = buildPanelsProps(controller)
  const dialogsProps = buildDialogsProps(controller)
  return (
    <section className="kanban-board">
      <KanbanBoardToolbar {...toolbarProps} />
      <KanbanBoardPanels {...panelsProps} />
      <KanbanDependencyStrip
        showDependencies={toolbarProps.showDependencies}
        snapshot={dialogsProps.snapshot}
      />
      <KanbanBoardDialogs {...dialogsProps} />
    </section>
  )
}
