import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanBoardSnapshot, KanbanCreateTaskInput, KanbanTask } from "@shared/ipc";
import { KanbanBoard } from "./KanbanBoard";

function createTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: overrides.id ?? "task-1",
    workspaceDir: overrides.workspaceDir ?? "/repo/kanban",
    title: overrides.title ?? "Task 1",
    prompt: overrides.prompt ?? "Do the task",
    description: overrides.description ?? "Task description",
    provider: overrides.provider ?? "opencode",
    providerConfig: overrides.providerConfig,
    columnId: overrides.columnId ?? "backlog",
    position: overrides.position ?? 0,
    statusSummary: overrides.statusSummary ?? "idle",
    autoStartWhenUnblocked: overrides.autoStartWhenUnblocked ?? false,
    blocked: overrides.blocked ?? false,
    shipStatus: overrides.shipStatus ?? "unshipped",
    trashStatus: overrides.trashStatus ?? "active",
    latestPreview: overrides.latestPreview,
    latestActivityKind: overrides.latestActivityKind,
    taskBranch: overrides.taskBranch,
    createdAt: overrides.createdAt ?? Date.now(),
    updatedAt: overrides.updatedAt ?? Date.now(),
    completedAt: overrides.completedAt,
    worktreePath: overrides.worktreePath,
    baseRef: overrides.baseRef,
    providerSessionKey: overrides.providerSessionKey,
    providerThreadId: overrides.providerThreadId,
    restoreColumnId: overrides.restoreColumnId,
    trashedAt: overrides.trashedAt,
    mergeStatus: overrides.mergeStatus,
  };
}

function createBoardSnapshot(taskOverrides: Array<Partial<KanbanTask>> = [createTask()]): KanbanBoardSnapshot {
  const tasks = taskOverrides.map((task, index) => createTask({ position: index, ...task }));
  return {
    workspaceDir: "/repo/kanban",
    settings: {
      workspaceDir: "/repo/kanban",
      autoCommit: false,
      autoPr: false,
      defaultProvider: "opencode" as const,
      providerDefaults: {},
      scriptShortcuts: [],
      worktreeInclude: {
        detected: false,
        source: "none" as const,
        entries: [],
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    },
    tasks,
    runtimes: [],
    dependencies: [],
    runs: [],
    automations: [],
    reviewComments: [],
    trashedTasks: [],
    worktrees: [],
  };
}

function createTaskDetail(task: KanbanTask) {
  return {
    task,
    runtime: null,
    run: null,
    dependencies: [],
    reviewComments: [],
    checkpoints: [],
    diff: "",
    structuredDiff: [],
    transcript: [],
    worktree: null,
  };
}

function installKanbanWindowMocks(options?: {
  tasks?: Array<Partial<KanbanTask>>;
  runAgentCliOutput?: string;
  settings?: Partial<ReturnType<typeof createBoardSnapshot>["settings"]>;
  dependencies?: Array<{ id: string; workspaceDir: string; fromTaskId: string; toTaskId: string; createdAt: number }>;
}) {
  const subscribe = vi.fn(() => vi.fn());
  const snapshot = createBoardSnapshot(options?.tasks);
  snapshot.settings = { ...snapshot.settings, ...options?.settings };
  snapshot.dependencies = options?.dependencies ?? [];
  const getBoard = vi.fn(async () => snapshot);
  const getTaskDetail = vi.fn(async (_workspaceDir: string, taskId: string) => {
    const task = snapshot.tasks.find((entry) => entry.id === taskId) ?? snapshot.tasks[0]!;
    return createTaskDetail(task);
  });
  const linkTasks = vi.fn(async () => undefined);
  const unlinkTasks = vi.fn(async () => undefined);
  const runAgentCli = vi.fn(async () => ({ ok: true, output: options?.runAgentCliOutput ?? "Sharper task title" }));

  Object.defineProperty(window, "orxa", {
    configurable: true,
    value: {
      app: {
        runAgentCli,
      },
      kanban: {
        listWorkspaces: vi.fn(async () => [{ directory: "/repo/kanban", name: "kanban" }]),
        addWorkspaceDirectory: vi.fn(async () => undefined),
        removeWorkspaceDirectory: vi.fn(async () => true),
        getBoard,
        importLegacyJobs: vi.fn(async () => true),
        createTask: vi.fn(async () => undefined),
        updateTask: vi.fn(async () => undefined),
        moveTask: vi.fn(async () => undefined),
        trashTask: vi.fn(async () => undefined),
        restoreTask: vi.fn(async () => undefined),
        deleteTask: vi.fn(async () => true),
        linkTasks,
        unlinkTasks,
        startTask: vi.fn(async () => undefined),
        resumeTask: vi.fn(async () => undefined),
        stopTask: vi.fn(async () => undefined),
        getTaskRuntime: vi.fn(async () => null),
        createTaskTerminal: vi.fn(async () => undefined),
        getTaskTerminal: vi.fn(async () => null),
        connectTaskTerminal: vi.fn(async () => undefined),
        closeTaskTerminal: vi.fn(async () => true),
        getTaskDetail,
        createCheckpoint: vi.fn(async () => undefined),
        listCheckpoints: vi.fn(async () => []),
        getCheckpointDiff: vi.fn(async () => ({ workspaceDir: "/repo/kanban", taskId: "task-1", fromCheckpointId: "cp-1", raw: "", files: [] })),
        addReviewComment: vi.fn(async () => undefined),
        sendReviewFeedback: vi.fn(async () => undefined),
        commitTask: vi.fn(async () => undefined),
        openTaskPr: vi.fn(async () => undefined),
        listRuns: vi.fn(async () => []),
        getRun: vi.fn(async () => null),
        listAutomations: vi.fn(async () => []),
        createAutomation: vi.fn(async () => undefined),
        updateAutomation: vi.fn(async () => undefined),
        deleteAutomation: vi.fn(async () => true),
        runAutomationNow: vi.fn(async () => undefined),
        getSettings: vi.fn(async () => snapshot.settings),
        updateSettings: vi.fn(async () => undefined),
        gitState: vi.fn(async () => ({
          workspaceDir: "/repo/kanban",
          repoRoot: "/repo/kanban",
          branchState: { current: "main", branches: ["main"], hasChanges: false, ahead: 0, behind: 0 },
          statusText: "",
          commits: [],
          graphText: "",
        })),
        gitFetch: vi.fn(async () => undefined),
        gitPull: vi.fn(async () => undefined),
        gitPush: vi.fn(async () => undefined),
        gitCheckout: vi.fn(async () => undefined),
        listWorktrees: vi.fn(async () => []),
        createWorktree: vi.fn(async () => undefined),
        openWorktree: vi.fn(async () => undefined),
        deleteWorktree: vi.fn(async () => true),
        mergeWorktree: vi.fn(async () => undefined),
        resolveMergeWithAgent: vi.fn(async () => undefined),
        getWorktreeStatus: vi.fn(async () => ({
          workspaceDir: "/repo/kanban",
          worktree: {
            id: "wt-1",
            workspaceDir: "/repo/kanban",
            label: "Worktree",
            repoRoot: "/repo/kanban",
            directory: "/repo/kanban/.worktrees/worktree",
            branch: "feature/test",
            baseRef: "main",
            status: "ready",
            mergeStatus: "clean",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          branchState: { current: "feature/test", branches: ["main", "feature/test"], hasChanges: false, ahead: 0, behind: 0 },
          statusText: "",
          conflicts: [],
        })),
        createWorktreeIncludeFromGitignore: vi.fn(async () => ({
          detected: true,
          source: "generated_from_gitignore",
          entries: [],
          updatedAt: Date.now(),
        })),
        runScriptShortcut: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
        startManagementSession: vi.fn(async () => undefined),
        getManagementSession: vi.fn(async () => null),
        sendManagementPrompt: vi.fn(async () => undefined),
      },
      opencode: {
        listProviders: vi.fn(async () => []),
        listAgents: vi.fn(async () => []),
      },
      codex: {
        listModels: vi.fn(async () => []),
      },
      claudeChat: {
        listModels: vi.fn(async () => []),
      },
      events: {
        subscribe,
      },
    },
  });

  return { subscribe, getBoard, getTaskDetail, linkTasks, unlinkTasks, runAgentCli };
}

describe("KanbanBoard", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("refreshes the board and open detail modal on runtime events for the selected workspace", async () => {
    const { subscribe, getBoard, getTaskDetail } = installKanbanWindowMocks();

    render(<KanbanBoard />);

    await waitFor(() => {
      expect(getBoard).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText("Task 1"));

    await waitFor(() => {
      expect(getTaskDetail).toHaveBeenCalledTimes(1);
    });

    const listener = (subscribe.mock.calls[subscribe.mock.calls.length - 1] as Array<((event: { type: string; payload: unknown }) => void)> | undefined)?.[0];
    expect(listener).toBeTypeOf("function");
    if (!listener) {
      throw new Error("Expected KanbanBoard to register an events listener");
    }

    listener({
      type: "kanban.runtime",
      payload: {
        workspaceDir: "/repo/kanban",
        runtime: { taskId: "task-1", status: "running" },
      },
    });

    await waitFor(() => {
      expect(getBoard).toHaveBeenCalledTimes(2);
      expect(getTaskDetail).toHaveBeenCalledTimes(2);
    });
  });

  it("does not reopen a task modal after it has been explicitly closed", async () => {
    const { subscribe, getTaskDetail } = installKanbanWindowMocks();

    render(<KanbanBoard />);
    fireEvent.click(await screen.findByText("Task 1"));

    await screen.findByRole("button", { name: "X" });
    fireEvent.click(screen.getByRole("button", { name: "X" }));

    await waitFor(() => {
      expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    });

    const listener = (subscribe.mock.calls[subscribe.mock.calls.length - 1] as Array<((event: { type: string; payload: unknown }) => void)> | undefined)?.[0];
    if (!listener) {
      throw new Error("Expected KanbanBoard to register an events listener");
    }

    listener({
      type: "kanban.runtime",
      payload: {
        workspaceDir: "/repo/kanban",
        runtime: { taskId: "task-1", status: "running" },
      },
    });

    await waitFor(() => {
      expect(getTaskDetail).toHaveBeenCalledTimes(1);
      expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    });
  });

  it("creates task dependencies by dragging from one card anchor to another", async () => {
    const { linkTasks } = installKanbanWindowMocks({
      tasks: [
        { id: "task-a", title: "Inventory Deployable Sites" },
        { id: "task-b", title: "Cross-Site Build Matrix", position: 1 },
      ],
    });

    render(<KanbanBoard />);
    await screen.findByText("Inventory Deployable Sites");

    const anchors = screen.getAllByTitle("Drag to another task to create a dependency");
    fireEvent.pointerDown(anchors[0]!);
    fireEvent.pointerEnter(anchors[1]!);
    fireEvent.pointerUp(anchors[1]!);

    await waitFor(() => {
      expect(linkTasks).toHaveBeenCalledWith("/repo/kanban", "task-a", "task-b");
    });
  });

  it("removes dependencies directly from the board edge controls", async () => {
    const { unlinkTasks } = installKanbanWindowMocks({
      tasks: [
        { id: "task-a", title: "Inventory Deployable Sites" },
        { id: "task-b", title: "Cross-Site Build Matrix", position: 1 },
      ],
      dependencies: [{
        id: "dep-1",
        workspaceDir: "/repo/kanban",
        fromTaskId: "task-a",
        toTaskId: "task-b",
        createdAt: Date.now(),
      }],
    });

    render(<KanbanBoard />);
    await screen.findByText("Inventory Deployable Sites");

    let edgeHit: Element | null = null;
    await waitFor(() => {
      edgeHit = document.querySelector('[data-dependency-edge-hit="dep-1"]');
      expect(edgeHit).toBeInstanceOf(SVGElement);
    });
    const svgEdge = edgeHit as SVGElement | null;
    if (!svgEdge) {
      throw new Error("Expected dependency edge to render");
    }
    fireEvent.pointerEnter(svgEdge);
    fireEvent.click(svgEdge);

    await waitFor(() => {
      expect(unlinkTasks).toHaveBeenCalledWith("/repo/kanban", "task-a", "task-b");
    });
  });

  it("regenerates create-task fields with the selected provider", async () => {
    const { runAgentCli } = installKanbanWindowMocks({ runAgentCliOutput: "Inventory deployable sites" });

    render(<KanbanBoard />);
    fireEvent.click(await screen.findByRole("button", { name: /new task/i }));

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "inventory" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "check apps" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "audit the repo" } });

    const regenButtons = screen.getAllByRole("button", { name: /regenerate with ai/i });
    fireEvent.click(regenButtons[0]!);

    await waitFor(() => {
      expect(runAgentCli).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Title")).toHaveValue("Inventory deployable sites");
    });
  });

  it("uses workspace provider defaults when creating a new task", async () => {
    const createTaskMock = vi.fn(async (input: KanbanCreateTaskInput) => createTask({
      workspaceDir: input.workspaceDir,
      title: input.title,
      prompt: input.prompt,
      description: input.description ?? "",
      provider: input.provider,
      providerConfig: input.providerConfig,
      columnId: input.columnId ?? "backlog",
      autoStartWhenUnblocked: input.autoStartWhenUnblocked ?? false,
    }));
    const { getBoard } = installKanbanWindowMocks({
      settings: {
        defaultProvider: "codex",
        providerDefaults: {
          codex: {
            model: "gpt-5.4",
            reasoningEffort: "high",
          },
        },
      },
    });
    window.orxa.kanban.createTask = createTaskMock;

    render(<KanbanBoard />);
    await waitFor(() => {
      expect(getBoard).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole("button", { name: /new task/i }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Inventory" } });
    fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Audit the workspace" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
        provider: "codex",
        providerConfig: {
          codex: {
            model: "gpt-5.4",
            reasoningEffort: "high",
          },
        },
      }));
    });
  });

  it("does not render a ship badge for unshipped tasks", async () => {
    installKanbanWindowMocks({
      tasks: [{ id: "task-1", title: "Cross-Site Build Matrix", shipStatus: "unshipped" }],
    });

    render(<KanbanBoard />);
    fireEvent.click(await screen.findByText("Cross-Site Build Matrix"));

    await waitFor(() => {
      expect(screen.queryByText("PR opened")).not.toBeInTheDocument();
    });
  });
});
