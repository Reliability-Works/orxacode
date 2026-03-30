import type { RefObject } from 'react'
import type {
  KanbanBoardSnapshot,
  KanbanColumnId,
  KanbanCreateAutomationInput,
  KanbanProvider,
  KanbanRegenerateTaskField,
  KanbanTask,
  KanbanTaskDetail,
  KanbanTaskStatusSummary,
  KanbanWorkspace,
} from '@shared/ipc'
import type { SensorDescriptor, SensorOptions } from '@dnd-kit/core'
import type { TaskDraft } from './kanban-board-utils'

export const DEFAULT_AUTOMATION_TEMPLATES: KanbanCreateAutomationInput[] = [
  {
    workspaceDir: '',
    name: 'Weekly release notes',
    prompt:
      'Draft weekly release notes from merged PRs in the last 7 days. Group by feature, fix, and infra, and include links when available.',
    provider: 'opencode',
    schedule: { type: 'daily', time: '09:00', days: [5] },
  },
  {
    workspaceDir: '',
    name: 'Security scan findings',
    prompt:
      'Perform a focused security scan of recent changes and dependencies. Report exploitable paths, confidence, and remediation steps.',
    provider: 'claude',
    schedule: { type: 'daily', time: '11:00', days: [1, 3, 5] },
  },
  {
    workspaceDir: '',
    name: 'PR quality digest',
    prompt:
      'Analyze merged PRs in the last week and summarize quality trends, hotspots, and high-risk areas for next sprint planning.',
    provider: 'codex',
    schedule: { type: 'daily', time: '16:00', days: [5] },
  },
]

export const BOARD_REFRESH_EVENT_TYPES = new Set([
  'kanban.task',
  'kanban.run',
  'kanban.board',
  'kanban.runtime',
  'kanban.checkpoint',
  'kanban.worktree',
  'kanban.shortcut',
])

export type KanbanTab =
  | 'board'
  | 'runs'
  | 'automations'
  | 'worktrees'
  | 'settings'
  | 'git'
  | 'management'

export type AutomationDraft = {
  name: string
  prompt: string
  provider: KanbanProvider
  browserModeEnabled: boolean
  enabled: boolean
  autoStart: boolean
  schedule: KanbanCreateAutomationInput['schedule']
}

export type KanbanLinkState = {
  fromTaskId: string
  startX: number
  startY: number
  currentX: number
  currentY: number
  hoverTaskId: string | null
  targetX: number | null
  targetY: number | null
} | null

export type KanbanDependencyEdge = {
  id: string
  fromTaskId: string
  toTaskId: string
  x1: number
  y1: number
  x2: number
  y2: number
  cx1: number
  cy1: number
  cx2: number
  cy2: number
}

export type KanbanContextMenuState = { task: KanbanTask; x: number; y: number } | null

export type KanbanBoardState = {
  sensors: SensorDescriptor<SensorOptions>[]
  workspaces: KanbanWorkspace[]
  setWorkspaces: React.Dispatch<React.SetStateAction<KanbanWorkspace[]>>
  selectedWorkspaceDir: string
  setSelectedWorkspaceDir: React.Dispatch<React.SetStateAction<string>>
  activeTab: KanbanTab
  setActiveTab: React.Dispatch<React.SetStateAction<KanbanTab>>
  snapshot: KanbanBoardSnapshot | null
  setSnapshot: React.Dispatch<React.SetStateAction<KanbanBoardSnapshot | null>>
  loading: boolean
  setLoading: React.Dispatch<React.SetStateAction<boolean>>
  refreshing: boolean
  setRefreshing: React.Dispatch<React.SetStateAction<boolean>>
  error: string | null
  setError: React.Dispatch<React.SetStateAction<string | null>>
  providerFilter: 'all' | KanbanProvider
  setProviderFilter: React.Dispatch<React.SetStateAction<'all' | KanbanProvider>>
  statusFilter: 'all' | KanbanTask['statusSummary'] | 'blocked'
  setStatusFilter: React.Dispatch<React.SetStateAction<'all' | KanbanTask['statusSummary'] | 'blocked'>>
  showDependencies: boolean
  setShowDependencies: React.Dispatch<React.SetStateAction<boolean>>
  taskModalOpen: boolean
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  taskDraft: TaskDraft
  setTaskDraft: React.Dispatch<React.SetStateAction<TaskDraft>>
  regeneratingField: KanbanRegenerateTaskField | null
  setRegeneratingField: React.Dispatch<React.SetStateAction<KanbanRegenerateTaskField | null>>
  automationModalOpen: boolean
  setAutomationModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  automationDraft: AutomationDraft
  setAutomationDraft: React.Dispatch<React.SetStateAction<AutomationDraft>>
  editingAutomationId: string | null
  setEditingAutomationId: React.Dispatch<React.SetStateAction<string | null>>
  detail: KanbanTaskDetail | null
  setDetail: React.Dispatch<React.SetStateAction<KanbanTaskDetail | null>>
  detailError: string | null
  setDetailError: React.Dispatch<React.SetStateAction<string | null>>
  activeDetailTaskIdRef: React.MutableRefObject<string | null>
  draggedTaskId: string | null
  setDraggedTaskId: React.Dispatch<React.SetStateAction<string | null>>
  contextMenu: KanbanContextMenuState
  setContextMenu: React.Dispatch<React.SetStateAction<KanbanContextMenuState>>
  boardCanvasRef: RefObject<HTMLDivElement | null>
  linking: KanbanLinkState
  setLinking: React.Dispatch<React.SetStateAction<KanbanLinkState>>
  dependencyEdges: KanbanDependencyEdge[]
  setDependencyEdges: React.Dispatch<React.SetStateAction<KanbanDependencyEdge[]>>
  hoveredDependencyId: string | null
  setHoveredDependencyId: React.Dispatch<React.SetStateAction<string | null>>
}

export type KanbanDerivedState = {
  filteredTasks: KanbanTask[]
  tasksByColumn: Map<KanbanColumnId, KanbanTask[]>
  runtimeStatuses: Map<string, KanbanTaskStatusSummary>
  activeTask: KanbanTask | null
  workspaceOptions: Array<{ value: string; label: string }>
  visibleTaskIds: Set<string>
  runs: KanbanBoardSnapshot['runs']
  automations: KanbanBoardSnapshot['automations']
  trashedCount: number
  worktreeCount: number
}
