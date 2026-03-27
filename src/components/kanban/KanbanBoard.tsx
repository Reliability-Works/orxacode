import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { FolderPlus, GitBranch, Link2, MessageSquare, Play, Plus, RefreshCw, Settings, Trash2, WandSparkles } from "lucide-react";
import type {
  KanbanBoardSnapshot,
  KanbanColumnId,
  KanbanCreateAutomationInput,
  KanbanLegacyImportInput,
  KanbanProvider,
  KanbanRegenerateTaskField,
  KanbanTask,
  KanbanTaskDetail,
  KanbanTaskProviderConfig,
  KanbanTaskStatusSummary,
  KanbanWorkspace,
} from "@shared/ipc";
import { readPersistedValue, removePersistedValue, writePersistedValue } from "../../lib/persistence";
import { KanbanDropdown } from "./KanbanDropdown";
import { KanbanColumn } from "./KanbanTaskCard";
import { KANBAN_COLUMNS, providerLabel, scheduleSummary } from "./kanban-utils";
import { KanbanTaskDetailModal } from "./KanbanTaskDetailModal";
import { KanbanSettingsPanel } from "./KanbanSettingsPanel";
import { KanbanGitPanel } from "./KanbanGitPanel";
import { KanbanManagementChat } from "./KanbanManagementChat";
import { KanbanTaskProviderConfigFields } from "./KanbanTaskProviderConfigFields";
import { KanbanWorktreesPanel } from "./KanbanWorktreesPanel";
import { buildRunAgentCliOptions, buildTaskFieldRegenerationPrompt, extractGeneratedFieldText } from "./kanban-task-generation";

const JOBS_KEY = "orxa:jobs:v1";
const JOB_RUNS_KEY = "orxa:jobRuns:v1";
const KANBAN_MIGRATION_KEY = "orxa:kanban:migratedJobs:v1";

const DEFAULT_AUTOMATION_TEMPLATES: KanbanCreateAutomationInput[] = [
  {
    workspaceDir: "",
    name: "Weekly release notes",
    prompt: "Draft weekly release notes from merged PRs in the last 7 days. Group by feature, fix, and infra, and include links when available.",
    provider: "opencode",
    schedule: { type: "daily", time: "09:00", days: [5] },
  },
  {
    workspaceDir: "",
    name: "Security scan findings",
    prompt: "Perform a focused security scan of recent changes and dependencies. Report exploitable paths, confidence, and remediation steps.",
    provider: "claude",
    schedule: { type: "daily", time: "11:00", days: [1, 3, 5] },
  },
  {
    workspaceDir: "",
    name: "PR quality digest",
    prompt: "Analyze merged PRs in the last week and summarize quality trends, hotspots, and high-risk areas for next sprint planning.",
    provider: "codex",
    schedule: { type: "daily", time: "16:00", days: [5] },
  },
];

type KanbanTab = "board" | "runs" | "automations" | "worktrees" | "settings" | "git" | "management";

type TaskDraft = {
  title: string;
  prompt: string;
  description: string;
  provider: KanbanProvider;
  providerConfig?: KanbanTaskProviderConfig;
  columnId: KanbanColumnId;
  autoStartWhenUnblocked: boolean;
};

type AutomationDraft = {
  name: string;
  prompt: string;
  provider: KanbanProvider;
  browserModeEnabled: boolean;
  enabled: boolean;
  autoStart: boolean;
  schedule: KanbanCreateAutomationInput["schedule"];
};

const BOARD_REFRESH_EVENT_TYPES = new Set([
  "kanban.task",
  "kanban.run",
  "kanban.board",
  "kanban.runtime",
  "kanban.checkpoint",
  "kanban.worktree",
  "kanban.shortcut",
]);

function extractEventTaskId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = payload as {
    taskId?: unknown;
    task?: { id?: unknown };
    run?: { taskId?: unknown };
    runtime?: { taskId?: unknown };
    checkpoint?: { taskId?: unknown };
    worktree?: { taskId?: unknown };
  };
  if (typeof data.taskId === "string") return data.taskId;
  if (typeof data.task?.id === "string") return data.task.id;
  if (typeof data.run?.taskId === "string") return data.run.taskId;
  if (typeof data.runtime?.taskId === "string") return data.runtime.taskId;
  if (typeof data.checkpoint?.taskId === "string") return data.checkpoint.taskId;
  if (typeof data.worktree?.taskId === "string") return data.worktree.taskId;
  return null;
}

function workspaceLabel(workspaces: KanbanWorkspace[], workspaceDir: string) {
  const workspace = workspaces.find((item) => item.directory === workspaceDir);
  return workspace?.name || workspaceDir.split("/").at(-1) || workspaceDir;
}

function taskProviderDefaults(
  settings: KanbanBoardSnapshot["settings"] | null | undefined,
  provider: KanbanProvider,
): KanbanTaskProviderConfig | undefined {
  if (!settings?.providerDefaults) {
    return undefined;
  }
  if (provider === "opencode" && settings.providerDefaults.opencode) {
    return { opencode: settings.providerDefaults.opencode };
  }
  if (provider === "codex" && settings.providerDefaults.codex) {
    return { codex: settings.providerDefaults.codex };
  }
  if (provider === "claude" && settings.providerDefaults.claude) {
    return { claude: settings.providerDefaults.claude };
  }
  return undefined;
}

function createTaskDraft(settings: KanbanBoardSnapshot["settings"] | null | undefined, provider?: KanbanProvider): TaskDraft {
  const nextProvider = provider ?? settings?.defaultProvider ?? "opencode";
  return {
    title: "",
    prompt: "",
    description: "",
    provider: nextProvider,
    providerConfig: taskProviderDefaults(settings, nextProvider),
    columnId: "backlog",
    autoStartWhenUnblocked: false,
  };
}

function useLegacyJobsMigration() {
  return useCallback(async () => {
    if (readPersistedValue(KANBAN_MIGRATION_KEY) === "done") {
      return;
    }
    const rawJobs = readPersistedValue(JOBS_KEY);
    const rawRuns = readPersistedValue(JOB_RUNS_KEY);
    if (!rawJobs && !rawRuns) {
      writePersistedValue(KANBAN_MIGRATION_KEY, "done");
      return;
    }
    const input: KanbanLegacyImportInput = {
      jobs: rawJobs ? JSON.parse(rawJobs) as KanbanLegacyImportInput["jobs"] : [],
      runs: rawRuns ? JSON.parse(rawRuns) as KanbanLegacyImportInput["runs"] : [],
    };
    await window.orxa.kanban.importLegacyJobs(input);
    removePersistedValue(JOBS_KEY);
    removePersistedValue(JOB_RUNS_KEY);
    writePersistedValue(KANBAN_MIGRATION_KEY, "done");
  }, []);
}

export function KanbanBoard() {
  const migrateLegacyJobs = useLegacyJobsMigration();
  const [workspaces, setWorkspaces] = useState<KanbanWorkspace[]>([]);
  const [selectedWorkspaceDir, setSelectedWorkspaceDir] = useState("");
  const [activeTab, setActiveTab] = useState<KanbanTab>("board");
  const [snapshot, setSnapshot] = useState<KanbanBoardSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<"all" | KanbanProvider>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | KanbanTask["statusSummary"] | "blocked">("all");
  const [showDependencies, setShowDependencies] = useState(true);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(createTaskDraft(null));
  const [regeneratingField, setRegeneratingField] = useState<KanbanRegenerateTaskField | null>(null);
  const [automationModalOpen, setAutomationModalOpen] = useState(false);
  const [automationDraft, setAutomationDraft] = useState<AutomationDraft>({
    name: "",
    prompt: "",
    provider: "opencode",
    browserModeEnabled: false,
    enabled: true,
    autoStart: true,
    schedule: { type: "daily", time: "09:00", days: [1, 2, 3, 4, 5] },
  });
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<KanbanTaskDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const activeDetailTaskIdRef = useRef<string | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ task: KanbanTask; x: number; y: number } | null>(null);
  const boardCanvasRef = useRef<HTMLDivElement | null>(null);
  const [linking, setLinking] = useState<{
    fromTaskId: string;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    hoverTaskId: string | null;
    targetX: number | null;
    targetY: number | null;
  } | null>(null);
  const [dependencyEdges, setDependencyEdges] = useState<Array<{
    id: string;
    fromTaskId: string;
    toTaskId: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    cx1: number;
    cy1: number;
    cx2: number;
    cy2: number;
  }>>([]);
  const [hoveredDependencyId, setHoveredDependencyId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ─── Data loading ───
  const loadWorkspaces = useCallback(async (preferredWorkspaceDir?: string) => {
    const nextWorkspaces = await window.orxa.kanban.listWorkspaces();
    setWorkspaces(nextWorkspaces);
    setSelectedWorkspaceDir((current) => {
      if (preferredWorkspaceDir && nextWorkspaces.some((workspace) => workspace.directory === preferredWorkspaceDir)) {
        return preferredWorkspaceDir;
      }
      if (current && nextWorkspaces.some((workspace) => workspace.directory === current)) {
        return current;
      }
      return nextWorkspaces[0]?.directory ?? "";
    });
    return nextWorkspaces;
  }, []);

  const loadBoard = useCallback(async (workspaceDir: string, options?: { silent?: boolean }) => {
    if (!workspaceDir) {
      setSnapshot(null);
      return;
    }
    const silent = options?.silent === true;
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const next = await window.orxa.kanban.getBoard(workspaceDir);
      setSnapshot(next);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await migrateLegacyJobs();
        await loadWorkspaces();
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : String(nextError));
      }
    })();
  }, [loadWorkspaces, migrateLegacyJobs]);

  useEffect(() => {
    if (selectedWorkspaceDir) {
      void loadBoard(selectedWorkspaceDir);
    } else {
      setSnapshot(null);
    }
  }, [loadBoard, selectedWorkspaceDir]);

  useEffect(() => {
    if (!taskModalOpen || !snapshot?.settings) {
      return;
    }
    setTaskDraft((current) => (
      current.title || current.prompt || current.description
        ? current
        : createTaskDraft(snapshot.settings)
    ));
  }, [snapshot?.settings, taskModalOpen]);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointer = () => setContextMenu(null);
    window.addEventListener("mousedown", handlePointer);
    return () => window.removeEventListener("mousedown", handlePointer);
  }, [contextMenu]);

  // ─── Computed ───
  const filteredTasks = useMemo(() => {
    const tasks = snapshot?.tasks ?? [];
    return tasks.filter((task) => {
      if (providerFilter !== "all" && task.provider !== providerFilter) return false;
      if (statusFilter === "blocked") return task.blocked;
      if (statusFilter !== "all" && task.statusSummary !== statusFilter) return false;
      return true;
    });
  }, [providerFilter, snapshot?.tasks, statusFilter]);

  const tasksByColumn = useMemo(() => {
    const map = new Map<KanbanColumnId, KanbanTask[]>();
    for (const column of KANBAN_COLUMNS) {
      map.set(column.id, []);
    }
    for (const task of filteredTasks) {
      map.get(task.columnId)?.push(task);
    }
    for (const tasks of map.values()) {
      tasks.sort((left, right) => left.position - right.position);
    }
    return map;
  }, [filteredTasks]);

  const runtimeStatuses = useMemo(() => {
    const map = new Map<string, KanbanTaskStatusSummary>();
    for (const runtime of snapshot?.runtimes ?? []) {
      if (runtime.status !== "archived") {
        map.set(runtime.taskId, runtime.status);
      }
    }
    return map;
  }, [snapshot?.runtimes]);

  const activeTask = useMemo(() => filteredTasks.find((task) => task.id === draggedTaskId) ?? null, [draggedTaskId, filteredTasks]);
  const trashedCount = snapshot?.trashedTasks?.length ?? 0;
  const worktreeCount = snapshot?.worktrees?.length ?? 0;

  const workspaceOptions = useMemo(
    () => workspaces.map((workspace) => ({ value: workspace.directory, label: workspace.name })),
    [workspaces],
  );
  const visibleTaskIds = useMemo(() => new Set(filteredTasks.map((task) => task.id)), [filteredTasks]);

  // ─── Actions ───
  const openTaskDetail = useCallback(async (task: KanbanTask) => {
    activeDetailTaskIdRef.current = task.id;
    setDetailError(null);
    try {
      const next = await window.orxa.kanban.getTaskDetail(task.workspaceDir, task.id);
      if (activeDetailTaskIdRef.current === task.id) {
        setDetail(next);
      }
    } catch (nextError) {
      setDetailError(nextError instanceof Error ? nextError.message : String(nextError));
      if (activeDetailTaskIdRef.current === task.id) {
        setDetail(null);
      }
    }
  }, []);

  const refreshDetail = useCallback(() => {
    const taskId = activeDetailTaskIdRef.current;
    if (!taskId || !selectedWorkspaceDir) {
      return;
    }
    const task = snapshot?.tasks.find((entry) => entry.id === taskId) ?? snapshot?.trashedTasks?.find((entry) => entry.id === taskId);
    if (task) {
      void openTaskDetail(task);
    }
  }, [openTaskDetail, selectedWorkspaceDir, snapshot?.tasks, snapshot?.trashedTasks]);

  // ─── Events ───
  useEffect(() => {
    const unsubscribe = window.orxa.events.subscribe((event) => {
      if (!selectedWorkspaceDir || !BOARD_REFRESH_EVENT_TYPES.has(event.type)) {
        return;
      }
      const payload = event.payload as { workspaceDir?: string } | undefined;
      if (payload?.workspaceDir !== selectedWorkspaceDir) {
        return;
      }

      void loadBoard(selectedWorkspaceDir, { silent: true });

      const detailTaskId = activeDetailTaskIdRef.current;
      if (!detailTaskId) {
        return;
      }

      if (event.type === "kanban.board") {
        void refreshDetail();
        return;
      }

      const eventTaskId = extractEventTaskId(event.payload);
      if (eventTaskId === detailTaskId) {
        void refreshDetail();
      }
    });
    return unsubscribe;
  }, [loadBoard, refreshDetail, selectedWorkspaceDir]);

  const handleCreateTask = useCallback(async () => {
    if (!selectedWorkspaceDir || !taskDraft.title.trim() || !taskDraft.prompt.trim()) return;
    await window.orxa.kanban.createTask({
      workspaceDir: selectedWorkspaceDir,
      title: taskDraft.title,
      prompt: taskDraft.prompt,
      description: taskDraft.description,
      provider: taskDraft.provider,
      providerConfig: taskDraft.providerConfig,
      columnId: taskDraft.columnId,
      autoStartWhenUnblocked: taskDraft.autoStartWhenUnblocked,
    });
    setTaskModalOpen(false);
    setTaskDraft(createTaskDraft(snapshot?.settings));
    await loadBoard(selectedWorkspaceDir);
  }, [loadBoard, selectedWorkspaceDir, snapshot?.settings, taskDraft]);

  const regenerateTaskDraftField = useCallback(async (field: KanbanRegenerateTaskField) => {
    if (!selectedWorkspaceDir) {
      return;
    }
    setRegeneratingField(field);
    try {
      const prompt = buildTaskFieldRegenerationPrompt({
        workspaceDir: selectedWorkspaceDir,
        provider: taskDraft.provider,
        field,
        title: taskDraft.title,
        description: taskDraft.description,
        prompt: taskDraft.prompt,
      });
      const result = await window.orxa.app.runAgentCli(
        buildRunAgentCliOptions({
          provider: taskDraft.provider,
          providerConfig: taskDraft.providerConfig,
          workspaceDir: selectedWorkspaceDir,
          prompt,
        }),
      );
      const text = extractGeneratedFieldText(result.output);
      if (!result.ok || !text) {
        throw new Error(result.output.trim() || "Field regeneration failed");
      }
      setTaskDraft((current) => ({ ...current, [field]: text }));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setRegeneratingField(null);
    }
  }, [selectedWorkspaceDir, taskDraft]);

  const handleCreateAutomation = useCallback(async () => {
    if (!selectedWorkspaceDir || !automationDraft.name.trim() || !automationDraft.prompt.trim()) return;
    await window.orxa.kanban.createAutomation({
      workspaceDir: selectedWorkspaceDir,
      name: automationDraft.name,
      prompt: automationDraft.prompt,
      provider: automationDraft.provider,
      browserModeEnabled: automationDraft.browserModeEnabled,
      enabled: automationDraft.enabled,
      autoStart: automationDraft.autoStart,
      schedule: automationDraft.schedule,
    });
    setAutomationModalOpen(false);
    await loadBoard(selectedWorkspaceDir);
  }, [automationDraft, loadBoard, selectedWorkspaceDir]);

  const handleUpdateAutomation = useCallback(async () => {
    if (!editingAutomationId || !selectedWorkspaceDir || !automationDraft.name.trim() || !automationDraft.prompt.trim()) return;
    await window.orxa.kanban.updateAutomation({
      id: editingAutomationId,
      workspaceDir: selectedWorkspaceDir,
      name: automationDraft.name,
      prompt: automationDraft.prompt,
      provider: automationDraft.provider,
      browserModeEnabled: automationDraft.browserModeEnabled,
      enabled: automationDraft.enabled,
      autoStart: automationDraft.autoStart,
      schedule: automationDraft.schedule,
    });
    setAutomationModalOpen(false);
    setEditingAutomationId(null);
    await loadBoard(selectedWorkspaceDir);
  }, [editingAutomationId, automationDraft, loadBoard, selectedWorkspaceDir]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    setDraggedTaskId(null);
    if (!selectedWorkspaceDir || !snapshot || !over || active.id === over.id) return;
    const activeTaskId = String(active.id);
    const draggedTask = snapshot.tasks.find((task) => task.id === activeTaskId);
    if (!draggedTask) return;
    const sourceTasks = tasksByColumn.get(draggedTask.columnId) ?? [];
    const overColumnId = KANBAN_COLUMNS.some((column) => column.id === String(over.id))
      ? (String(over.id) as KanbanColumnId)
      : (snapshot.tasks.find((task) => task.id === String(over.id))?.columnId ?? draggedTask.columnId);
    const destinationTasks = tasksByColumn.get(overColumnId) ?? [];
    const activeIndex = sourceTasks.findIndex((task) => task.id === activeTaskId);
    const overIndexInDestination = destinationTasks.findIndex((task) => task.id === String(over.id));
    const targetIndex = overIndexInDestination >= 0 ? overIndexInDestination : destinationTasks.length;

    if (draggedTask.columnId === overColumnId) {
      const reordered = arrayMove(sourceTasks, activeIndex, targetIndex);
      for (let index = 0; index < reordered.length; index += 1) {
        await window.orxa.kanban.moveTask({ workspaceDir: selectedWorkspaceDir, taskId: reordered[index]!.id, columnId: overColumnId, position: index });
      }
    } else {
      const reordered = [...destinationTasks];
      reordered.splice(targetIndex, 0, draggedTask);
      for (let index = 0; index < reordered.length; index += 1) {
        await window.orxa.kanban.moveTask({ workspaceDir: selectedWorkspaceDir, taskId: reordered[index]!.id, columnId: overColumnId, position: index });
      }
    }
    await loadBoard(selectedWorkspaceDir);
  }, [loadBoard, selectedWorkspaceDir, snapshot, tasksByColumn]);

  const runs = snapshot?.runs ?? [];
  const automations = snapshot?.automations ?? [];
  const trashTask = useCallback(async (task: KanbanTask) => {
    await window.orxa.kanban.trashTask(task.workspaceDir, task.id);
    setContextMenu(null);
    if (detail?.task.id === task.id) {
      activeDetailTaskIdRef.current = null;
      setDetail(null);
      setDetailError(null);
    }
    await loadBoard(task.workspaceDir, { silent: true });
  }, [detail?.task.id, loadBoard]);

  const getAnchorPoint = useCallback((event: Pick<ReactPointerEvent<HTMLButtonElement>, "currentTarget">) => {
    const board = boardCanvasRef.current;
    if (!board) return { x: 0, y: 0 };
    const boardRect = board.getBoundingClientRect();
    // Walk up from the button to find the card element
    const card = event.currentTarget.closest<HTMLElement>(".kanban-task-card");
    const rect = card ? card.getBoundingClientRect() : event.currentTarget.getBoundingClientRect();
    // Use the right edge center of the card, accounting for board scroll
    return {
      x: rect.right - boardRect.left + board.scrollLeft,
      y: rect.top + rect.height / 2 - boardRect.top + board.scrollTop,
    };
  }, []);

  const handleLinkStart = useCallback((task: KanbanTask, event: ReactPointerEvent<HTMLButtonElement>) => {
    const anchor = getAnchorPoint(event);
    setLinking({
      fromTaskId: task.id,
      startX: anchor.x,
      startY: anchor.y,
      currentX: anchor.x,
      currentY: anchor.y,
      hoverTaskId: null,
      targetX: null,
      targetY: null,
    });
  }, [getAnchorPoint]);

  const handleLinkComplete = useCallback(async (task: KanbanTask) => {
    if (!linking || !selectedWorkspaceDir || linking.fromTaskId === task.id) {
      return;
    }
    await window.orxa.kanban.linkTasks(selectedWorkspaceDir, linking.fromTaskId, task.id);
    setLinking(null);
    await loadBoard(selectedWorkspaceDir, { silent: true });
  }, [linking, loadBoard, selectedWorkspaceDir]);

  const handleLinkHover = useCallback((task: KanbanTask | null, event?: ReactPointerEvent<HTMLButtonElement>) => {
    const anchor = task && event ? getAnchorPoint(event) : null;
    setLinking((current) => {
      if (!current) {
        return null;
      }
      if (!task || !anchor) {
        return {
          ...current,
          hoverTaskId: null,
          targetX: null,
          targetY: null,
        };
      }
      return {
        ...current,
        hoverTaskId: task.id,
        targetX: anchor.x,
        targetY: anchor.y,
      };
    });
  }, [getAnchorPoint]);

  useEffect(() => {
    if (!linking) {
      return;
    }
    const handleMove = (event: PointerEvent) => {
      const board = boardCanvasRef.current;
      if (!board) return;
      const boardRect = board.getBoundingClientRect();
      setLinking((current) => current ? ({
        ...current,
        currentX: event.clientX - boardRect.left + board.scrollLeft,
        currentY: event.clientY - boardRect.top + board.scrollTop,
      }) : null);
    };
    const handleUp = () => setLinking(null);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [linking]);

  const handleAddWorkspace = useCallback(async () => {
    try {
      const workspace = await window.orxa.kanban.addWorkspaceDirectory();
      if (!workspace) return;
      await loadWorkspaces(workspace.directory);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, [loadWorkspaces]);

  const openCreateTaskModal = useCallback(() => {
    setTaskDraft(createTaskDraft(snapshot?.settings));
    setTaskModalOpen(true);
  }, [snapshot?.settings]);

  const recalculateDependencyEdges = useCallback(() => {
    if (!boardCanvasRef.current || !showDependencies || !snapshot?.dependencies.length) {
      setDependencyEdges([]);
      setHoveredDependencyId(null);
      return;
    }
    const board = boardCanvasRef.current;
    const boardRect = board.getBoundingClientRect();
    const scrollLeft = board.scrollLeft;
    const scrollTop = board.scrollTop;
    const nextEdges = snapshot.dependencies.flatMap((dependency) => {
      if (!visibleTaskIds.has(dependency.fromTaskId) || !visibleTaskIds.has(dependency.toTaskId)) {
        return [];
      }
      const fromCard = board.querySelector<HTMLElement>(`[data-kanban-task-anchor="${dependency.fromTaskId}"]`)?.closest<HTMLElement>(".kanban-task-card");
      const toCard = board.querySelector<HTMLElement>(`[data-kanban-task-anchor="${dependency.toTaskId}"]`)?.closest<HTMLElement>(".kanban-task-card");
      if (!fromCard || !toCard) {
        return [];
      }
      const fromRect = fromCard.getBoundingClientRect();
      const toRect = toCard.getBoundingClientRect();
      const x1 = fromRect.right - boardRect.left + scrollLeft;
      const y1 = fromRect.top + fromRect.height / 2 - boardRect.top + scrollTop;
      const x2 = toRect.left - boardRect.left + scrollLeft;
      const y2 = toRect.top + toRect.height / 2 - boardRect.top + scrollTop;
      const dx = Math.abs(x2 - x1);
      const pull = Math.max(42, Math.min(dx * 0.4, 180));
      return [{
        id: dependency.id,
        fromTaskId: dependency.fromTaskId,
        toTaskId: dependency.toTaskId,
        x1,
        y1,
        x2,
        y2,
        cx1: x1 + pull,
        cy1: y1,
        cx2: x2 - pull,
        cy2: y2,
      }];
    });
    setDependencyEdges(nextEdges);
    setHoveredDependencyId((current) => nextEdges.some((edge) => edge.id === current) ? current : null);
  }, [showDependencies, snapshot?.dependencies, visibleTaskIds]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(recalculateDependencyEdges);
    const handleResize = () => recalculateDependencyEdges();
    const handleScroll = () => recalculateDependencyEdges();
    const canvasElement = boardCanvasRef.current;
    window.addEventListener("resize", handleResize);
    canvasElement?.addEventListener("scroll", handleScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleResize);
      canvasElement?.removeEventListener("scroll", handleScroll);
    };
  }, [recalculateDependencyEdges]);

  const unlinkDependency = useCallback(async (dependencyId: string) => {
    if (!selectedWorkspaceDir || !snapshot) {
      return;
    }
    const dependency = snapshot.dependencies.find((entry) => entry.id === dependencyId);
    if (!dependency) {
      return;
    }
    await window.orxa.kanban.unlinkTasks(selectedWorkspaceDir, dependency.fromTaskId, dependency.toTaskId);
    setHoveredDependencyId(null);
    await loadBoard(selectedWorkspaceDir, { silent: true });
  }, [loadBoard, selectedWorkspaceDir, snapshot]);

  // ─── Render ───
  return (
    <section className="kanban-board">
      <div className="kanban-titlebar">
        <h1 className="kanban-title">Orxa KanBan</h1>
      </div>

      <header className="kanban-control-bar">
        <div className="kanban-control-bar-left">
          {workspaceOptions.length > 0 ? (
            <KanbanDropdown compact value={selectedWorkspaceDir} options={workspaceOptions} onChange={setSelectedWorkspaceDir} />
          ) : (
            <div className="kanban-empty-workspace-chip" title="No Kanban workspace selected">No workspace</div>
          )}
          <button type="button" className="kanban-icon-btn" title="Add Kanban workspace" onClick={() => void handleAddWorkspace()}>
            <FolderPlus size={14} aria-hidden="true" />
          </button>
          <span className="kanban-control-sep" aria-hidden="true" />
          <nav className="kanban-tabs" aria-label="Kanban view">
            <button type="button" className={`kanban-tab${activeTab === "board" ? " active" : ""}`} onClick={() => setActiveTab("board")}>Board</button>
            <button type="button" className={`kanban-tab${activeTab === "runs" ? " active" : ""}`} onClick={() => setActiveTab("runs")}>Runs</button>
            <button type="button" className={`kanban-tab${activeTab === "automations" ? " active" : ""}`} onClick={() => setActiveTab("automations")}>Automations</button>
            <button type="button" className={`kanban-tab${activeTab === "worktrees" ? " active" : ""}`} onClick={() => setActiveTab("worktrees")}>Worktrees</button>
            <span className="kanban-control-sep" aria-hidden="true" />
            <button type="button" className={`kanban-tab kanban-tab--secondary${activeTab === "settings" ? " active" : ""}`} onClick={() => setActiveTab("settings")} title="Settings">
              <Settings size={12} aria-hidden="true" />
            </button>
            <button type="button" className={`kanban-tab kanban-tab--secondary${activeTab === "git" ? " active" : ""}`} onClick={() => setActiveTab("git")} title="Git">
              <GitBranch size={12} aria-hidden="true" />
            </button>
            <button type="button" className={`kanban-tab kanban-tab--secondary${activeTab === "management" ? " active" : ""}`} onClick={() => setActiveTab("management")} title="Management">
              <MessageSquare size={12} aria-hidden="true" />
            </button>
          </nav>
        </div>
        <div className="kanban-control-bar-right">
          <KanbanDropdown
            compact
            value={providerFilter}
            options={[
              { value: "all", label: "All providers" },
              { value: "opencode", label: "OpenCode" },
              { value: "codex", label: "Codex" },
              { value: "claude", label: "Claude" },
            ]}
            onChange={setProviderFilter}
          />
          <KanbanDropdown
            compact
            value={statusFilter}
            options={[
              { value: "all", label: "All statuses" },
              { value: "blocked", label: "Blocked" },
              { value: "idle", label: "Idle" },
              { value: "running", label: "Running" },
              { value: "awaiting_review", label: "Awaiting review" },
              { value: "awaiting_input", label: "Awaiting input" },
              { value: "completed", label: "Completed" },
              { value: "failed", label: "Failed" },
              { value: "stopped", label: "Stopped" },
            ]}
            onChange={setStatusFilter}
          />
          <button
            type="button"
            className={`kanban-filter-toggle${showDependencies ? " active" : ""}`}
            onClick={() => setShowDependencies((current) => !current)}
            title={showDependencies ? "Hide dependencies" : "Show dependencies"}
          >
            <Link2 size={12} aria-hidden="true" />
            Deps
          </button>
          {trashedCount > 0 ? <span className="kanban-meta-badge">{trashedCount} in trash</span> : null}
          {worktreeCount > 0 ? <span className="kanban-meta-badge">{worktreeCount} worktrees</span> : null}
          <span className="kanban-control-sep" aria-hidden="true" />
          <button
            type="button"
            className={`kanban-icon-btn${refreshing ? " is-spinning" : ""}`}
            title="Refresh board"
            onClick={() => selectedWorkspaceDir && void loadBoard(selectedWorkspaceDir, { silent: true })}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button type="button" className="kanban-primary-btn" onClick={openCreateTaskModal}>
            <Plus size={13} aria-hidden="true" />
            New task
          </button>
        </div>
      </header>

      {error ? <p className="skills-error" style={{ padding: "10px 16px" }}>{error}</p> : null}
      {loading ? <div className="kanban-empty-state" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>Loading…</div> : null}
      {!loading && !selectedWorkspaceDir ? (
        <div className="kanban-empty-state" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          Add a Kanban workspace to start building a board.
        </div>
      ) : null}

      {/* ─── Board tab ─── */}
      {!loading && selectedWorkspaceDir && activeTab === "board" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={(event) => setDraggedTaskId(String(event.active.id))}
          onDragEnd={(event) => void handleDragEnd(event)}
          onDragCancel={() => setDraggedTaskId(null)}
        >
          <div ref={boardCanvasRef} className="kanban-columns">
            {showDependencies && dependencyEdges.length > 0 ? (
              <svg className="kanban-linking-overlay kanban-linking-overlay--dependencies" aria-hidden="true">
                <defs>
                  <marker id="kanban-dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 1 L 7 4 L 0 7 z" className="kanban-dep-arrow-fill" />
                  </marker>
                  <marker id="kanban-dep-arrow-hover" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 1 L 7 4 L 0 7 z" className="kanban-dep-arrow-fill-hover" />
                  </marker>
                </defs>
                {dependencyEdges.map((edge) => (
                  <g key={edge.id}>
                    <path
                      d={`M ${edge.x1} ${edge.y1} C ${edge.cx1} ${edge.cy1}, ${edge.cx2} ${edge.cy2}, ${edge.x2} ${edge.y2}`}
                      className={`kanban-dependency-edge${hoveredDependencyId === edge.id ? " is-hovered" : ""}`.trim()}
                      markerEnd={hoveredDependencyId === edge.id ? "url(#kanban-dep-arrow-hover)" : "url(#kanban-dep-arrow)"}
                    />
                    <path
                      d={`M ${edge.x1} ${edge.y1} C ${edge.cx1} ${edge.cy1}, ${edge.cx2} ${edge.cy2}, ${edge.x2} ${edge.y2}`}
                      className="kanban-dependency-edge-hit"
                      data-dependency-edge-hit={edge.id}
                      onPointerEnter={() => setHoveredDependencyId(edge.id)}
                      onPointerLeave={() => setHoveredDependencyId((current) => current === edge.id ? null : current)}
                      onClick={() => void unlinkDependency(edge.id)}
                    />
                  </g>
                ))}
              </svg>
            ) : null}
            {linking ? (() => {
              const endX = linking.targetX ?? linking.currentX;
              const endY = linking.targetY ?? linking.currentY;
              const dx = Math.abs(endX - linking.startX);
              const pull = Math.max(42, Math.min(dx * 0.4, 180));
              const cx1 = linking.startX + pull;
              const cx2 = endX - pull;
              return (
                <svg className="kanban-linking-overlay" aria-hidden="true">
                  <defs>
                    <marker id="kanban-link-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                      <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" className="kanban-linking-arrow-fill" />
                    </marker>
                  </defs>
                  <path
                    d={`M ${linking.startX} ${linking.startY} C ${cx1} ${linking.startY}, ${cx2} ${endY}, ${endX} ${endY}`}
                    className={`kanban-linking-path${linking.hoverTaskId ? " is-snapped" : ""}`}
                    markerEnd="url(#kanban-link-arrow)"
                  />
                </svg>
              );
            })() : null}
            {KANBAN_COLUMNS.map((column) => (
              <KanbanColumn
                key={column.id}
                column={column}
                tasks={tasksByColumn.get(column.id) ?? []}
                runtimeStatuses={runtimeStatuses}
                onOpenTask={(task) => void openTaskDetail(task)}
                onTrashTask={(task) => void trashTask(task)}
                onContextTask={(task, x, y) => setContextMenu({ task, x, y })}
                onLinkStart={handleLinkStart}
                onLinkComplete={(task) => void handleLinkComplete(task)}
                onLinkHover={handleLinkHover}
                linkingSourceTaskId={linking?.fromTaskId ?? null}
                linkingTargetTaskId={linking?.hoverTaskId ?? null}
              />
            ))}
          </div>
          <DragOverlay>
            {activeTask ? <article className="kanban-task-card is-drag-overlay"><strong>{activeTask.title}</strong></article> : null}
          </DragOverlay>
        </DndContext>
      ) : null}

      {/* ─── Runs tab ─── */}
      {!loading && selectedWorkspaceDir && activeTab === "runs" ? (
        <section className="kanban-runs">
          {runs.map((run) => (
            <article key={run.id} className="kanban-list-card">
              <header className="kanban-list-card-header">
                <strong>{run.taskId ? snapshot?.tasks.find((task) => task.id === run.taskId)?.title ?? run.taskId : "Automation run"}</strong>
                <div className="kanban-list-card-badges">
                  <span className="kanban-task-pill kanban-task-pill--provider">{providerLabel(run.provider)}</span>
                  <span className={`kanban-task-pill kanban-task-pill--status${run.status === "completed" ? " is-success" : run.status === "failed" ? " is-error" : ""}`.trim()}>
                    {run.status}
                  </span>
                </div>
              </header>
              <footer className="kanban-list-card-footer">
                <span>{new Date(run.createdAt).toLocaleString()}</span>
                <span>{workspaceLabel(workspaces, run.workspaceDir)}</span>
                <button type="button" className="kanban-task-inline-action" onClick={() => {
                  const task = snapshot?.tasks.find((candidate) => candidate.id === run.taskId);
                  if (task) void openTaskDetail(task);
                }}>Open task</button>
              </footer>
            </article>
          ))}
          {runs.length === 0 ? <div className="kanban-empty-state">No runs yet</div> : null}
        </section>
      ) : null}

      {/* ─── Automations tab ─── */}
      {!loading && selectedWorkspaceDir && activeTab === "automations" ? (
        <section className="kanban-automations">
          <div className="kanban-section-header">
            <h2>Configured automations</h2>
            <button type="button" className="kanban-primary-btn" onClick={() => setAutomationModalOpen(true)}>
              <Plus size={13} aria-hidden="true" />
              New automation
            </button>
          </div>
          <div className="kanban-list-grid">
            {automations.map((automation) => (
              <article key={automation.id} className="kanban-list-card">
                <header className="kanban-list-card-header">
                  <strong>{automation.name}</strong>
                  <div className="kanban-list-card-badges">
                    <span className={`kanban-task-pill kanban-task-pill--status${automation.enabled ? " is-success" : " is-blocked"}`.trim()}>{automation.enabled ? "enabled" : "paused"}</span>
                    <span className="kanban-task-pill kanban-task-pill--provider">{providerLabel(automation.provider)}</span>
                  </div>
                </header>
                <p className="kanban-list-card-desc">{automation.prompt}</p>
                <footer className="kanban-list-card-footer">
                  <span>{scheduleSummary(automation.schedule)}</span>
                  <span>{workspaceLabel(workspaces, automation.workspaceDir)}</span>
                </footer>
                <div className="kanban-list-card-actions">
                  <button type="button" className="kanban-filter-toggle" onClick={() => {
                    setAutomationDraft({
                      name: automation.name,
                      prompt: automation.prompt,
                      provider: automation.provider,
                      browserModeEnabled: automation.browserModeEnabled,
                      enabled: automation.enabled,
                      autoStart: automation.autoStart,
                      schedule: automation.schedule,
                    });
                    setEditingAutomationId(automation.id);
                    setAutomationModalOpen(true);
                  }}>
                    Edit
                  </button>
                  <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.runAutomationNow(automation.workspaceDir, automation.id).then(() => loadBoard(automation.workspaceDir))}>
                    <Play size={11} aria-hidden="true" /> Run now
                  </button>
                  <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.deleteAutomation(automation.workspaceDir, automation.id).then(() => loadBoard(automation.workspaceDir))}>
                    Delete
                  </button>
                </div>
              </article>
            ))}
            {automations.length === 0 ? <div className="kanban-empty-state">No automations configured</div> : null}
          </div>
          <div className="kanban-section-header"><h2>Templates</h2></div>
          <div className="kanban-list-grid kanban-list-grid--3col">
            {DEFAULT_AUTOMATION_TEMPLATES.map((template) => (
              <article key={template.name} className="kanban-list-card">
                <header className="kanban-list-card-header">
                  <span className="kanban-template-icon"><WandSparkles size={13} aria-hidden="true" /></span>
                  <strong>{template.name}</strong>
                </header>
                <p className="kanban-list-card-desc">{template.prompt}</p>
                <footer className="kanban-list-card-footer"><span>{scheduleSummary(template.schedule)}</span></footer>
                <button type="button" className="kanban-filter-toggle" onClick={() => {
                  setAutomationDraft({ name: template.name, prompt: template.prompt, provider: template.provider, browserModeEnabled: false, enabled: true, autoStart: true, schedule: template.schedule });
                  setAutomationModalOpen(true);
                }}>Use template</button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!loading && selectedWorkspaceDir && activeTab === "worktrees" ? (
        <KanbanWorktreesPanel
          workspaceDir={selectedWorkspaceDir}
          worktrees={snapshot?.worktrees ?? []}
          trashedTasks={snapshot?.trashedTasks ?? []}
          onRefresh={() => void loadBoard(selectedWorkspaceDir, { silent: true })}
        />
      ) : null}

      {/* ─── Settings tab ─── */}
      {!loading && selectedWorkspaceDir && activeTab === "settings" ? (
        <KanbanSettingsPanel workspaceDir={selectedWorkspaceDir} />
      ) : null}

      {/* ─── Git tab ─── */}
      {!loading && selectedWorkspaceDir && activeTab === "git" ? (
        <KanbanGitPanel workspaceDir={selectedWorkspaceDir} />
      ) : null}

      {/* ─── Management tab ─── */}
      {!loading && selectedWorkspaceDir && activeTab === "management" ? (
        <KanbanManagementChat workspaceDir={selectedWorkspaceDir} />
      ) : null}

      {/* ─── Dependencies strip ─── */}
      {showDependencies && snapshot?.dependencies.length ? (
        <section className="kanban-dependency-strip">
          <h2>Dependencies</h2>
          <div className="kanban-dependency-list">
            {snapshot.dependencies.map((dependency) => {
              const fromTitle = snapshot.tasks.find((task) => task.id === dependency.fromTaskId)?.title ?? dependency.fromTaskId;
              const toTitle = snapshot.tasks.find((task) => task.id === dependency.toTaskId)?.title ?? dependency.toTaskId;
              return <span key={dependency.id} className="kanban-task-pill">{fromTitle} → {toTitle}</span>;
            })}
          </div>
        </section>
      ) : null}

      {/* ─── Create task modal ─── */}
      {taskModalOpen ? (
        <div className="kanban-pane-overlay" onClick={() => setTaskModalOpen(false)}>
          <section className="modal kanban-modal kanban-sheet-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <h2>Create task</h2>
              <button type="button" className="modal-close-btn" onClick={() => setTaskModalOpen(false)}>X</button>
            </header>
            <div className="kanban-modal-body">
              <label className="kanban-field">
                Title
                <input value={taskDraft.title} onChange={(event) => setTaskDraft((current) => ({ ...current, title: event.target.value }))} />
                <button type="button" className="kanban-inline-meta-btn" disabled={regeneratingField === "title"} onClick={() => void regenerateTaskDraftField("title")}>
                  {regeneratingField === "title" ? "Regenerating..." : "Regenerate with AI"}
                </button>
              </label>
              <label className="kanban-field">
                Description
                <input value={taskDraft.description} onChange={(event) => setTaskDraft((current) => ({ ...current, description: event.target.value }))} />
                <button type="button" className="kanban-inline-meta-btn" disabled={regeneratingField === "description"} onClick={() => void regenerateTaskDraftField("description")}>
                  {regeneratingField === "description" ? "Regenerating..." : "Regenerate with AI"}
                </button>
              </label>
              <label className="kanban-field">
                Prompt
                <textarea rows={5} value={taskDraft.prompt} onChange={(event) => setTaskDraft((current) => ({ ...current, prompt: event.target.value }))} />
                <button type="button" className="kanban-inline-meta-btn" disabled={regeneratingField === "prompt"} onClick={() => void regenerateTaskDraftField("prompt")}>
                  {regeneratingField === "prompt" ? "Regenerating..." : "Regenerate with AI"}
                </button>
              </label>
              <label className="kanban-field">
                Provider
                <div className="kanban-segmented-control">
                  {(["opencode", "codex", "claude"] as const).map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      className={taskDraft.provider === provider ? "active" : ""}
                      onClick={() => setTaskDraft((current) => ({
                        ...current,
                        provider,
                        providerConfig: taskProviderDefaults(snapshot?.settings, provider),
                      }))}
                    >
                      {providerLabel(provider)}
                    </button>
                  ))}
                </div>
              </label>
              <section className="kanban-task-config-section">
                <h3>Provider config</h3>
                <KanbanTaskProviderConfigFields
                  workspaceDir={selectedWorkspaceDir}
                  provider={taskDraft.provider}
                  providerConfig={taskDraft.providerConfig}
                  onChange={(providerConfig) => setTaskDraft((current) => ({ ...current, providerConfig }))}
                />
              </section>
              <div className="kanban-field">
                <span>Column</span>
                <KanbanDropdown value={taskDraft.columnId} options={KANBAN_COLUMNS.map((column) => ({ value: column.id, label: column.label }))} onChange={(columnId) => setTaskDraft((current) => ({ ...current, columnId }))} />
              </div>
              <label className="kanban-toggle-row">
                <span>Auto start when unblocked</span>
                <button type="button" role="switch" aria-checked={taskDraft.autoStartWhenUnblocked} className={`kanban-switch${taskDraft.autoStartWhenUnblocked ? " on" : ""}`} onClick={() => setTaskDraft((current) => ({ ...current, autoStartWhenUnblocked: !current.autoStartWhenUnblocked }))}>
                  <span className="kanban-switch-thumb" />
                </button>
              </label>
              <footer className="kanban-modal-footer">
                <button type="button" className="kanban-filter-toggle" onClick={() => setTaskModalOpen(false)}>Cancel</button>
                <button type="button" className="kanban-primary-btn" onClick={() => void handleCreateTask()}>Create</button>
              </footer>
            </div>
          </section>
        </div>
      ) : null}

      {/* ─── Create automation modal ─── */}
      {automationModalOpen ? (
        <div className="kanban-pane-overlay" onClick={() => { setAutomationModalOpen(false); setEditingAutomationId(null); }}>
          <section className="modal kanban-modal kanban-sheet-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-header">
              <h2>{editingAutomationId ? "Edit automation" : "Create automation"}</h2>
              <button type="button" className="modal-close-btn" onClick={() => { setAutomationModalOpen(false); setEditingAutomationId(null); }}>X</button>
            </header>
            <div className="kanban-modal-body">
              <label className="kanban-field">Name<input value={automationDraft.name} onChange={(event) => setAutomationDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label className="kanban-field">Prompt<textarea rows={5} value={automationDraft.prompt} onChange={(event) => setAutomationDraft((current) => ({ ...current, prompt: event.target.value }))} /></label>
              <label className="kanban-field">
                Provider
                <div className="kanban-segmented-control">
                  {(["opencode", "codex", "claude"] as const).map((provider) => (
                    <button key={provider} type="button" className={automationDraft.provider === provider ? "active" : ""} onClick={() => setAutomationDraft((current) => ({ ...current, provider }))}>{providerLabel(provider)}</button>
                  ))}
                </div>
              </label>
              <label className="kanban-toggle-row">
                <span>Auto start</span>
                <button type="button" role="switch" aria-checked={automationDraft.autoStart} className={`kanban-switch${automationDraft.autoStart ? " on" : ""}`} onClick={() => setAutomationDraft((current) => ({ ...current, autoStart: !current.autoStart }))}>
                  <span className="kanban-switch-thumb" />
                </button>
              </label>
              <section className="kanban-schedule-section">
                <div className="kanban-schedule-header">
                  <span>Schedule</span>
                  <div className="kanban-segmented-control">
                    <button type="button" className={automationDraft.schedule.type === "daily" ? "active" : ""} onClick={() => setAutomationDraft((current) => ({ ...current, schedule: { type: "daily", time: "09:00", days: [1, 2, 3, 4, 5] } }))}>Daily</button>
                    <button type="button" className={automationDraft.schedule.type === "interval" ? "active" : ""} onClick={() => setAutomationDraft((current) => ({ ...current, schedule: { type: "interval", intervalMinutes: 240 } }))}>Interval</button>
                  </div>
                </div>
                {automationDraft.schedule.type === "daily" ? (
                  <label className="kanban-field">Time<input type="time" value={automationDraft.schedule.time} onChange={(event) => setAutomationDraft((current) => ({ ...current, schedule: { ...current.schedule, time: event.target.value } as AutomationDraft["schedule"] }))} /></label>
                ) : (
                  <label className="kanban-field">Every (minutes)<input type="number" min={5} step={5} value={automationDraft.schedule.intervalMinutes} onChange={(event) => setAutomationDraft((current) => ({ ...current, schedule: { type: "interval", intervalMinutes: Math.max(5, Number(event.target.value) || 5) } }))} /></label>
                )}
              </section>
              <footer className="kanban-modal-footer">
                <button type="button" className="kanban-filter-toggle" onClick={() => { setAutomationModalOpen(false); setEditingAutomationId(null); }}>Cancel</button>
                <button type="button" className="kanban-primary-btn" onClick={() => void (editingAutomationId ? handleUpdateAutomation() : handleCreateAutomation())}>{editingAutomationId ? "Save" : "Create"}</button>
              </footer>
            </div>
          </section>
        </div>
      ) : null}

      {/* ─── Task detail modal ─── */}
      {detail ? (
        <KanbanTaskDetailModal
          detail={detail}
          snapshot={{ tasks: snapshot?.tasks ?? [], dependencies: snapshot?.dependencies ?? [] }}
          workspaceDir={selectedWorkspaceDir}
          onClose={() => { activeDetailTaskIdRef.current = null; setDetail(null); setDetailError(null); }}
          onRefresh={refreshDetail}
        />
      ) : null}
      {detailError && !detail ? (
        <div className="kanban-pane-overlay" onClick={() => setDetailError(null)}>
          <section className="modal kanban-modal kanban-sheet-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h2>Error</h2>
              <button type="button" className="modal-close-btn" onClick={() => setDetailError(null)}>X</button>
            </header>
            <div className="kanban-modal-body"><p className="skills-error">{detailError}</p></div>
          </section>
        </div>
      ) : null}

      {/* ─── Context menu ─── */}
      {contextMenu ? (
        <div className="kanban-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button type="button" onClick={() => { setContextMenu(null); void openTaskDetail(contextMenu.task); }}>Open task</button>
          {contextMenu.task.columnId === "done" ? (
            <button type="button" onClick={() => void trashTask(contextMenu.task)}><Trash2 size={12} /> Trash task</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
