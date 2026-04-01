import { useRef, useState } from 'react'
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { createTaskDraft, useLegacyJobsMigration, type TaskDraft } from './kanban-board-utils'
import type { KanbanBoardState } from './KanbanBoard.types'

export function useKanbanBoardState() {
  const migrateLegacyJobs = useLegacyJobsMigration()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  const [workspaces, setWorkspaces] = useState<KanbanBoardState['workspaces']>([])
  const [selectedWorkspaceDir, setSelectedWorkspaceDir] = useState('')
  const [activeTab, setActiveTab] = useState<KanbanBoardState['activeTab']>('board')
  const [snapshot, setSnapshot] = useState<KanbanBoardState['snapshot']>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerFilter, setProviderFilter] = useState<KanbanBoardState['providerFilter']>('all')
  const [statusFilter, setStatusFilter] = useState<KanbanBoardState['statusFilter']>('all')
  const [showDependencies, setShowDependencies] = useState(true)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(createTaskDraft(null))
  const [regeneratingField, setRegeneratingField] = useState<KanbanBoardState['regeneratingField']>(null)
  const [automationModalOpen, setAutomationModalOpen] = useState(false)
  const [automationDraft, setAutomationDraft] = useState<KanbanBoardState['automationDraft']>({
    name: '',
    prompt: '',
    provider: 'opencode',
    browserModeEnabled: false,
    enabled: true,
    autoStart: true,
    schedule: { type: 'daily', time: '09:00', days: [1, 2, 3, 4, 5] },
  })
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null)
  const [detail, setDetail] = useState<KanbanBoardState['detail']>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const activeDetailTaskIdRef = useRef<string | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<KanbanBoardState['contextMenu']>(null)
  const boardCanvasRef = useRef<HTMLDivElement | null>(null)
  const [linking, setLinking] = useState<KanbanBoardState['linking']>(null)
  const [dependencyEdges, setDependencyEdges] = useState<KanbanBoardState['dependencyEdges']>([])
  const [hoveredDependencyId, setHoveredDependencyId] = useState<string | null>(null)

  return {
    activeDetailTaskIdRef,
    activeTab,
    automationDraft,
    automationModalOpen,
    boardCanvasRef,
    contextMenu,
    dependencyEdges,
    detail,
    detailError,
    draggedTaskId,
    editingAutomationId,
    error,
    hoveredDependencyId,
    linking,
    loading,
    migrateLegacyJobs,
    providerFilter,
    refreshing,
    regeneratingField,
    selectedWorkspaceDir,
    sensors,
    setActiveTab,
    setAutomationDraft,
    setAutomationModalOpen,
    setContextMenu,
    setDependencyEdges,
    setDetail,
    setDetailError,
    setDraggedTaskId,
    setEditingAutomationId,
    setError,
    setHoveredDependencyId,
    setLinking,
    setLoading,
    setProviderFilter,
    setRefreshing,
    setRegeneratingField,
    setSelectedWorkspaceDir,
    setShowDependencies,
    setSnapshot,
    setStatusFilter,
    setTaskDraft,
    setTaskModalOpen,
    setWorkspaces,
    showDependencies,
    snapshot,
    statusFilter,
    taskDraft,
    taskModalOpen,
    workspaces,
  } satisfies KanbanBoardState & { migrateLegacyJobs: () => Promise<void> }
}
