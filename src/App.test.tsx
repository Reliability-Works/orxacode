import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { EMPTY_WORKSPACE_SESSIONS_KEY } from "./hooks/useWorkspaceState";
import { setPersistedCodexState } from "./hooks/codex-session-storage";
import { preferredAgentForMode } from "./lib/app-mode";
import { useUnifiedRuntimeStore } from "./state/unified-runtime-store";

const checkDependenciesMock = vi.fn(async () => ({
  checkedAt: Date.now(),
  missingAny: false,
  missingRequired: false,
  dependencies: [
    {
      key: "opencode" as const,
      label: "OpenCode CLI",
      required: true,
      installed: true,
      description: "Core runtime and CLI backend used by the app for sessions, tools, and streaming.",
      reason: "Required. Orxa Code depends on the OpenCode server and CLI APIs.",
      installCommand: "npm install -g opencode-ai",
      sourceUrl: "https://github.com/anomalyco/opencode",
    },
    {
      key: "orxa" as const,
      label: "Orxa Code Plugin Package",
      required: false,
      installed: true,
      description: "Orxa workflows, agents, and plugin assets for the dedicated Orxa mode experience.",
      reason: "Optional. Needed only when using Orxa mode features.",
      installCommand: "npm install -g @reliabilityworks/opencode-orxa",
      sourceUrl: "https://github.com/Reliability-Works/opencode-orxa",
    },
  ],
}));

beforeEach(() => {
  window.localStorage.clear();
  useUnifiedRuntimeStore.setState({
    activeWorkspaceDirectory: undefined,
    activeSessionID: undefined,
    pendingSessionId: undefined,
    activeProvider: undefined,
    projectDataByDirectory: {},
    workspaceMetaByDirectory: {},
    opencodeSessions: {},
    codexSessions: {},
    claudeSessions: {},
    claudeChatSessions: {},
    sessionReadTimestamps: {},
    collapsedProjects: {},
  });
  const subscribe = vi.fn(() => () => undefined);
  checkDependenciesMock.mockResolvedValue({
    checkedAt: Date.now(),
    missingAny: false,
    missingRequired: false,
    dependencies: [
      {
        key: "opencode",
        label: "OpenCode CLI",
        required: true,
        installed: true,
        description: "Core runtime and CLI backend used by the app for sessions, tools, and streaming.",
        reason: "Required. Orxa Code depends on the OpenCode server and CLI APIs.",
        installCommand: "npm install -g opencode-ai",
        sourceUrl: "https://github.com/anomalyco/opencode",
      },
      {
        key: "orxa",
        label: "Orxa Code Plugin Package",
        required: false,
        installed: true,
        description: "Orxa workflows, agents, and plugin assets for the dedicated Orxa mode experience.",
        reason: "Optional. Needed only when using Orxa mode features.",
        installCommand: "npm install -g @reliabilityworks/opencode-orxa",
        sourceUrl: "https://github.com/Reliability-Works/opencode-orxa",
      },
    ],
  });

  Object.defineProperty(window, "orxa", {
    value: {
      app: {
        openExternal: vi.fn(async () => true),
        openFile: vi.fn(async () => undefined),
        scanPorts: vi.fn(async () => []),
        httpRequest: vi.fn(async () => ({ status: 200, headers: {}, body: "", elapsed: 0 })),
      },
      updates: {
        getPreferences: vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" })),
        setPreferences: vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" })),
        checkNow: vi.fn(async () => ({ ok: true, status: "started" })),
      },
      runtime: {
        getState: vi.fn(async () => ({ status: "disconnected", managedServer: false })),
        listProfiles: vi.fn(async () => []),
        saveProfile: vi.fn(async () => []),
        deleteProfile: vi.fn(async () => []),
        attach: vi.fn(async () => ({ status: "connected", managedServer: false })),
        startLocal: vi.fn(async () => ({ status: "connected", managedServer: true })),
        stopLocal: vi.fn(async () => ({ status: "disconnected", managedServer: false })),
      },
      opencode: {
        bootstrap: vi.fn(async () => ({ projects: [], runtime: { status: "disconnected", managedServer: false } })),
        checkDependencies: checkDependenciesMock,
        addProjectDirectory: vi.fn(async () => undefined),
        removeProjectDirectory: vi.fn(async () => true),
        selectProject: vi.fn(async () => {
          throw new Error("not used");
        }),
        refreshProject: vi.fn(async () => {
          throw new Error("not used");
        }),
        createSession: vi.fn(async () => {
          throw new Error("not used");
        }),
        deleteSession: vi.fn(async () => true),
        abortSession: vi.fn(async () => true),
        renameSession: vi.fn(async () => ({ id: "session-1", title: "Renamed" })),
        archiveSession: vi.fn(async () => ({ id: "session-1", title: "Archived" })),
        createWorktreeSession: vi.fn(async () => ({
          worktree: { name: "feature-test", branch: "feature-test", directory: "/tmp/feature-test" },
          session: { id: "session-2", title: "Worktree: test", slug: "worktree-test", parentID: undefined, sharing: undefined, revert: [], time: { created: Date.now(), updated: Date.now() } },
        })),
        getSessionRuntime: vi.fn(async (directory: string, sessionID: string) => ({
          directory,
          sessionID,
          session: null,
          sessionStatus: undefined,
          permissions: [],
          questions: [],
          commands: [],
          messages: [],
          sessionDiff: [],
          executionLedger: { cursor: 0, records: [] },
          changeProvenance: { cursor: 0, records: [] },
        })),
        loadMessages: vi.fn(async () => []),
        loadExecutionLedger: vi.fn(async () => ({ cursor: 0, records: [] })),
        clearExecutionLedger: vi.fn(async () => true),
        loadChangeProvenance: vi.fn(async () => ({ cursor: 0, records: [] })),
        getFileProvenance: vi.fn(async () => []),
        sendPrompt: vi.fn(async () => true),
        replyPermission: vi.fn(async () => true),
        replyQuestion: vi.fn(async () => true),
        rejectQuestion: vi.fn(async () => true),
        getConfig: vi.fn(async () => ({})),
        updateConfig: vi.fn(async () => ({})),
        readRawConfig: vi.fn(async () => ({ scope: "global", path: "config.json", content: "{}" })),
        writeRawConfig: vi.fn(async () => ({ scope: "global", path: "config.json", content: "{}" })),
        listProviders: vi.fn(async () => ({ all: [], connected: [], default: {} })),
        listAgents: vi.fn(async () => []),
        pickImage: vi.fn(async () => undefined),
        gitCommitSummary: vi.fn(async () => ({
          repoRoot: "/repo/dreamweaver",
          branch: "main",
          filesChanged: 0,
          insertions: 0,
          deletions: 0,
        })),
        gitGenerateCommitMessage: vi.fn(async () => "test commit"),
        gitCommit: vi.fn(async () => ({
          repoRoot: "/repo/dreamweaver",
          branch: "main",
          commitSha: "abc123",
          pushed: false,
          createdPullRequest: false,
        })),
        gitBranches: vi.fn(async () => ({
          current: "main",
          branches: ["main"],
          hasChanges: false,
          ahead: 0,
          behind: 0,
        })),
        gitCheckoutBranch: vi.fn(async () => ({
          current: "main",
          branches: ["main"],
          hasChanges: false,
          ahead: 0,
          behind: 0,
        })),
        gitStageAll: vi.fn(async () => true),
        gitRestoreAllUnstaged: vi.fn(async () => true),
        gitStagePath: vi.fn(async () => true),
        gitRestorePath: vi.fn(async () => true),
        gitUnstagePath: vi.fn(async () => true),
        getServerDiagnostics: vi.fn(async () => ({
          runtime: { status: "disconnected", managedServer: false },
          health: "disconnected",
        })),
        repairRuntime: vi.fn(async () => ({
          runtime: { status: "disconnected", managedServer: false },
          health: "disconnected",
        })),
        listAgentFiles: vi.fn(async () => []),
        readAgentFile: vi.fn(async () => ({ filename: "test.md", name: "test", mode: "primary", model: "", content: "", path: "" })),
        writeAgentFile: vi.fn(async () => true),
        deleteAgentFile: vi.fn(async () => true),
      },
      claudeChat: {
        health: vi.fn(async () => ({ available: true, authenticated: true, version: "2.0.25" })),
        listModels: vi.fn(async () => []),
        getState: vi.fn(async () => ({ sessionKey: "session-1", status: "disconnected" })),
        startTurn: vi.fn(async () => undefined),
        interruptTurn: vi.fn(async () => undefined),
        approve: vi.fn(async () => undefined),
        respondToUserInput: vi.fn(async () => undefined),
        getSessionMessages: vi.fn(async () => []),
        renameProviderSession: vi.fn(async () => undefined),
        archiveSession: vi.fn(async () => undefined),
        archiveProviderSession: vi.fn(async () => undefined),
      },
      kanban: {
        listWorkspaces: vi.fn(async () => []),
        addWorkspaceDirectory: vi.fn(async () => undefined),
        removeWorkspaceDirectory: vi.fn(async () => true),
        getSettings: vi.fn(async () => ({
          workspaceDir: "/tmp/project",
          autoCommit: false,
          autoPr: false,
          defaultProvider: "opencode",
          providerDefaults: {},
          scriptShortcuts: [],
          worktreeInclude: {
            detected: false,
            source: "none",
            entries: [],
            updatedAt: Date.now(),
          },
          updatedAt: Date.now(),
        })),
        updateSettings: vi.fn(async (input) => input),
        getBoard: vi.fn(async (workspaceDir: string) => ({
          workspaceDir,
          settings: {
            workspaceDir,
            autoCommit: false,
            autoPr: false,
            defaultProvider: "opencode",
            providerDefaults: {},
            scriptShortcuts: [],
            worktreeInclude: {
              detected: false,
              source: "none",
              entries: [],
              updatedAt: Date.now(),
            },
            updatedAt: Date.now(),
          },
          tasks: [],
          runtimes: [],
          dependencies: [],
          runs: [],
          automations: [],
          reviewComments: [],
          trashedTasks: [],
          worktrees: [],
        })),
        importLegacyJobs: vi.fn(async () => true),
        createTask: vi.fn(async () => ({
          id: "task-1",
          workspaceDir: "/tmp/project",
          title: "Task",
          prompt: "Prompt",
          description: "",
          provider: "opencode",
          columnId: "backlog",
          position: 0,
          statusSummary: "idle",
          autoStartWhenUnblocked: false,
          blocked: false,
          shipStatus: "unshipped",
          trashStatus: "active",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })),
        updateTask: vi.fn(async () => undefined),
        moveTask: vi.fn(async () => ({
          workspaceDir: "/tmp/project",
          tasks: [],
          dependencies: [],
          runs: [],
          automations: [],
          reviewComments: [],
          trashedTasks: [],
          worktrees: [],
        })),
        trashTask: vi.fn(async () => undefined),
        restoreTask: vi.fn(async () => undefined),
        deleteTask: vi.fn(async () => true),
        linkTasks: vi.fn(async () => ({
          workspaceDir: "/tmp/project",
          tasks: [],
          dependencies: [],
          runs: [],
          automations: [],
          reviewComments: [],
          trashedTasks: [],
          worktrees: [],
        })),
        unlinkTasks: vi.fn(async () => ({
          workspaceDir: "/tmp/project",
          tasks: [],
          dependencies: [],
          runs: [],
          automations: [],
          reviewComments: [],
          trashedTasks: [],
          worktrees: [],
        })),
        startTask: vi.fn(async () => undefined),
        resumeTask: vi.fn(async () => undefined),
        stopTask: vi.fn(async () => undefined),
        getTaskRuntime: vi.fn(async () => null),
        createTaskTerminal: vi.fn(async () => ({ id: "pty-1", directory: "/tmp/project", cwd: "/tmp/project", title: "Kanban", owner: "kanban", status: "running", pid: 1, exitCode: null, createdAt: Date.now() })),
        getTaskTerminal: vi.fn(async () => null),
        connectTaskTerminal: vi.fn(async () => ({ ptyID: "pty-1", directory: "/tmp/project", connected: true })),
        closeTaskTerminal: vi.fn(async () => true),
        getTaskDetail: vi.fn(async () => ({
          task: {
            id: "task-1",
            workspaceDir: "/tmp/project",
            title: "Task",
            prompt: "Prompt",
            description: "",
            provider: "opencode",
            columnId: "backlog",
            position: 0,
            statusSummary: "idle",
            autoStartWhenUnblocked: false,
            blocked: false,
            shipStatus: "unshipped",
            trashStatus: "active",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          runtime: null,
          run: null,
          dependencies: [],
          reviewComments: [],
          checkpoints: [],
          diff: "",
          structuredDiff: [],
          transcript: [],
          worktree: null,
        })),
        createCheckpoint: vi.fn(async () => ({
          id: "checkpoint-1",
          workspaceDir: "/tmp/project",
          taskId: "task-1",
          label: "Manual checkpoint",
          source: "manual",
          diffRaw: "",
          createdAt: Date.now(),
        })),
        listCheckpoints: vi.fn(async () => []),
        getCheckpointDiff: vi.fn(async () => ({
          workspaceDir: "/tmp/project",
          taskId: "task-1",
          fromCheckpointId: "checkpoint-1",
          raw: "",
          files: [],
        })),
        addReviewComment: vi.fn(async () => undefined),
        sendReviewFeedback: vi.fn(async () => undefined),
        commitTask: vi.fn(async () => undefined),
        openTaskPr: vi.fn(async () => undefined),
        gitState: vi.fn(async () => ({
          workspaceDir: "/tmp/project",
          repoRoot: "/tmp/project",
          branchState: { current: "main", branches: ["main"], hasChanges: false, ahead: 0, behind: 0 },
          statusText: "",
          commits: [],
          graphText: "",
        })),
        gitFetch: vi.fn(async () => ({
          workspaceDir: "/tmp/project",
          repoRoot: "/tmp/project",
          branchState: { current: "main", branches: ["main"], hasChanges: false, ahead: 0, behind: 0 },
          statusText: "",
          commits: [],
          graphText: "",
        })),
        gitPull: vi.fn(async () => ({
          workspaceDir: "/tmp/project",
          repoRoot: "/tmp/project",
          branchState: { current: "main", branches: ["main"], hasChanges: false, ahead: 0, behind: 0 },
          statusText: "",
          commits: [],
          graphText: "",
        })),
        gitPush: vi.fn(async () => ({
          workspaceDir: "/tmp/project",
          repoRoot: "/tmp/project",
          branchState: { current: "main", branches: ["main"], hasChanges: false, ahead: 0, behind: 0 },
          statusText: "",
          commits: [],
          graphText: "",
        })),
        gitCheckout: vi.fn(async () => ({
          workspaceDir: "/tmp/project",
          repoRoot: "/tmp/project",
          branchState: { current: "main", branches: ["main"], hasChanges: false, ahead: 0, behind: 0 },
          statusText: "",
          commits: [],
          graphText: "",
        })),
        listWorktrees: vi.fn(async () => []),
        createWorktree: vi.fn(async () => undefined),
        openWorktree: vi.fn(async () => undefined),
        deleteWorktree: vi.fn(async () => true),
        mergeWorktree: vi.fn(async () => undefined),
        resolveMergeWithAgent: vi.fn(async () => undefined),
        getWorktreeStatus: vi.fn(async () => ({
          workspaceDir: "/tmp/project",
          worktree: {
            id: "wt-1",
            workspaceDir: "/tmp/project",
            label: "Worktree",
            repoRoot: "/tmp/project",
            directory: "/tmp/project/.worktrees/worktree",
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
        listRuns: vi.fn(async () => []),
        getRun: vi.fn(async () => null),
        listAutomations: vi.fn(async () => []),
        createAutomation: vi.fn(async () => undefined),
        updateAutomation: vi.fn(async () => undefined),
        deleteAutomation: vi.fn(async () => true),
        runAutomationNow: vi.fn(async () => undefined),
        startManagementSession: vi.fn(async () => ({ workspaceDir: "/tmp/project", provider: "opencode", sessionKey: "session-1", status: "idle", transcript: [], updatedAt: Date.now() })),
        getManagementSession: vi.fn(async () => null),
        sendManagementPrompt: vi.fn(async () => ({ session: { workspaceDir: "/tmp/project", provider: "opencode", sessionKey: "session-1", status: "idle", transcript: [], updatedAt: Date.now() }, rawResponse: "", operations: [], applied: [] })),
      },
      terminal: {
        list: vi.fn(async () => []),
        create: vi.fn(async () => ({ id: "pty-1" })),
        connect: vi.fn(async () => ({ connected: true })),
        write: vi.fn(async () => true),
        resize: vi.fn(async () => true),
        close: vi.fn(async () => true),
      },
      browser: {
        getState: vi.fn(async () => ({ partition: "persist:orxa-browser", bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] })),
        setVisible: vi.fn(async () => ({ partition: "persist:orxa-browser", bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] })),
        setBounds: vi.fn(async () => ({ partition: "persist:orxa-browser", bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] })),
        openTab: vi.fn(async () => ({ partition: "persist:orxa-browser", bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] })),
        closeTab: vi.fn(async () => ({ partition: "persist:orxa-browser", bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] })),
        switchTab: vi.fn(async () => ({ partition: "persist:orxa-browser", bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] })),
        navigate: vi.fn(async () => ({ partition: "persist:orxa-browser", bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] })),
        back: vi.fn(async () => ({ partition: "persist:orxa-browser", bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] })),
        forward: vi.fn(async () => ({ partition: "persist:orxa-browser", bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] })),
        reload: vi.fn(async () => ({ partition: "persist:orxa-browser", bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] })),
        listHistory: vi.fn(async () => []),
        clearHistory: vi.fn(async () => []),
        performAgentAction: vi.fn(async () => ({ action: "navigate", ok: true, state: { partition: "persist:orxa-browser", bounds: { x: 0, y: 0, width: 0, height: 0 }, tabs: [] } })),
      },
      events: {
        subscribe,
      },
    },
    configurable: true,
  });
});

describe("App", () => {
  it("renders the shell", async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Workspaces" })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Config" })).toBeInTheDocument();
  });

  it("wraps the shared opencode composer path in the centered rail", async () => {
    const now = Date.now();
    const projectData = {
      directory: "/repo/marketing-websites",
      path: {},
      sessions: [{
        id: "session-1",
        slug: "booking-site",
        title: "Create a booking site",
        time: { created: now, updated: now },
      }],
      sessionStatus: { "session-1": { type: "idle" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    };

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: vi.fn(async () => ({
            projects: [{ id: "proj-1", name: "marketing-websites", worktree: "/repo/marketing-websites", source: "local" as const }],
            runtime: { status: "disconnected" as const, managedServer: false },
          })),
          refreshProject: vi.fn(async () => projectData),
        },
      },
      configurable: true,
    });

    useUnifiedRuntimeStore.setState((state) => ({
      ...state,
      activeWorkspaceDirectory: "/repo/marketing-websites",
      activeSessionID: "session-1",
      projectDataByDirectory: {
        ...state.projectDataByDirectory,
        "/repo/marketing-websites": projectData as never,
      },
    }));

    const { container } = render(<App />);

    await waitFor(() => {
      expect(container.querySelector(".content-pane .center-pane-rail .composer-zone")).toBeInTheDocument();
    });
  });

  it("shows preloaded sessions in the workspace list without selecting the workspace", async () => {
    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "marketing-websites", worktree: "/repo/marketing-websites", source: "local" as const }],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const selectProjectMock = vi.fn(async () => ({
      directory: "/repo/marketing-websites",
      path: {},
      sessions: [{
        id: "session-1",
        slug: "booking-site",
        title: "Create a booking site",
        time: { created: Date.now(), updated: Date.now() },
      }],
      sessionStatus: { "session-1": { type: "idle" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    expect(await screen.findByText("Create a booking site")).toBeInTheDocument();
    expect(selectProjectMock).toHaveBeenCalledWith("/repo/marketing-websites");
  });

  it("prefers the busy spinner over unread for inactive Codex sessions that are still streaming", async () => {
    window.localStorage.setItem(
      "orxa:sessionTypes:v2",
      JSON.stringify({ "/repo/marketing-websites::session-1": "codex" }),
    );
    window.localStorage.setItem(
      "orxa:sessionReadTimestamps:v1",
      JSON.stringify({ "/repo/marketing-websites::session-1": 1 }),
    );
    setPersistedCodexState("/repo/marketing-websites::session-1", {
      messages: [],
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: true,
      messageIdCounter: 0,
    });

    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "marketing-websites", worktree: "/repo/marketing-websites", source: "local" as const }],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const selectProjectMock = vi.fn(async () => ({
      directory: "/repo/marketing-websites",
      path: {},
      sessions: [{
        id: "session-1",
        slug: "booking-site",
        title: "Create a booking site",
        time: { created: Date.now(), updated: 10 },
      }],
      sessionStatus: { "session-1": { type: "idle" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    expect(await screen.findByText("Create a booking site")).toBeInTheDocument();
    expect(document.querySelector(".session-status-indicator.busy")).toBeInTheDocument();
    expect(document.querySelector(".session-status-indicator.unread")).toBeNull();
  });

  it("shows a busy sidebar indicator for inactive Claude Chat sessions with active subagents", async () => {
    window.localStorage.setItem(
      "orxa:sessionTypes:v2",
      JSON.stringify({ "/repo/marketing-websites::session-claude": "claude-chat" }),
    );
    useUnifiedRuntimeStore.setState({
      claudeChatSessions: {
        "/repo/marketing-websites::session-claude": {
          key: "/repo/marketing-websites::session-claude",
          directory: "/repo/marketing-websites",
          connectionStatus: "connected",
          messages: [],
          historyMessages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: false,
          providerThreadId: "thread-claude",
          activeTurnId: null,
          lastError: undefined,
          subagents: [
            {
              id: "subagent-1",
              name: "Scout",
              status: "thinking",
              statusText: "Delegating",
            },
          ],
        },
      },
    });

    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "marketing-websites", worktree: "/repo/marketing-websites", source: "local" as const }],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const selectProjectMock = vi.fn(async () => ({
      directory: "/repo/marketing-websites",
      path: {},
      sessions: [{
        id: "session-claude",
        slug: "claude-chat",
        title: "Claude Code (Chat)",
        time: { created: Date.now(), updated: 10 },
      }],
      sessionStatus: { "session-claude": { type: "idle" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    expect(await screen.findByText("Claude Code (Chat)")).toBeInTheDocument();
    expect(document.querySelector(".session-status-indicator.busy")).toBeInTheDocument();
  });

  it("hides Kanban management sessions from the workspace sidebar", async () => {
    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "marketing-websites", worktree: "/repo/marketing-websites", source: "local" as const }],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const selectProjectMock = vi.fn(async () => ({
      directory: "/repo/marketing-websites",
      path: {},
      sessions: [{
        id: "session-bg",
        slug: "kanban-board-manager",
        title: "Kanban board manager",
        time: { created: Date.now(), updated: Date.now() },
      }],
      sessionStatus: { "session-bg": { type: "busy" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
        kanban: {
          ...window.orxa!.kanban,
          listWorkspaces: vi.fn(async () => [{
            directory: "/repo/marketing-websites",
            name: "marketing-websites",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }]),
          getManagementSession: vi.fn(async (workspaceDir: string, provider: string) => (
            workspaceDir === "/repo/marketing-websites" && provider === "opencode"
              ? {
                  workspaceDir,
                  provider: "opencode" as const,
                  sessionKey: "session-bg",
                  status: "idle" as const,
                  transcript: [],
                  updatedAt: Date.now(),
                }
              : null
          )),
        },
      },
      configurable: true,
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText("Kanban board manager")).not.toBeInTheDocument();
    });
  });

  it("keeps inactive Codex sessions polling in the background", async () => {
    window.localStorage.setItem(
      "orxa:sessionTypes:v2",
      JSON.stringify({ "/repo/marketing-websites::session-1": "codex" }),
    );
    setPersistedCodexState("/repo/marketing-websites::session-1", {
      messages: [],
      thread: { id: "thr-1", preview: "", modelProvider: "openai", createdAt: Date.now() },
      isStreaming: true,
      messageIdCounter: 0,
    });

    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "marketing-websites", worktree: "/repo/marketing-websites", source: "local" as const }],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const selectProjectMock = vi.fn(async () => ({
      directory: "/repo/marketing-websites",
      path: {},
      sessions: [{
        id: "session-1",
        slug: "booking-site",
        title: "Create a booking site",
        time: { created: Date.now(), updated: Date.now() },
      }],
      sessionStatus: { "session-1": { type: "idle" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));
    const getThreadRuntimeMock = vi.fn(async (threadId: string) => ({
      thread: {
        id: threadId,
        preview: "Create a booking site",
        modelProvider: "openai",
        createdAt: Date.now(),
        status: { type: "inProgress" as const },
      },
      childThreads: [],
    }));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        codex: {
          getThreadRuntime: getThreadRuntimeMock,
        },
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    expect(await screen.findByText("Create a booking site")).toBeInTheDocument();
    await waitFor(() => {
      expect(getThreadRuntimeMock).toHaveBeenCalledWith("thr-1");
    });
  });

  it("removes an archived session from the sidebar instead of falling back to New session", async () => {
    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "dreamweaver", worktree: "/repo/dreamweaver", source: "local" as const }],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const activeSession = {
      id: "session-1",
      slug: "booking-site",
      title: "Build Spa Booking Site",
      time: { created: Date.now(), updated: Date.now() },
    };
    const selectProjectMock = vi.fn(async () => ({
      directory: "/repo/dreamweaver",
      path: {},
      sessions: [activeSession],
      sessionStatus: { "session-1": { type: "idle" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));
    const refreshProjectMock = vi.fn(async () => ({
      directory: "/repo/dreamweaver",
      path: {},
      sessions: [],
      sessionStatus: {},
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));
    const archiveSessionMock = vi.fn(async () => ({ ...activeSession, time: { ...activeSession.time, archived: Date.now() } }));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
          refreshProject: refreshProjectMock,
          archiveSession: archiveSessionMock,
        },
      },
      configurable: true,
    });

    useUnifiedRuntimeStore.setState((state) => ({
      ...state,
      activeWorkspaceDirectory: "/repo/dreamweaver",
      activeSessionID: "session-1",
      projectDataByDirectory: {
        ...state.projectDataByDirectory,
        "/repo/dreamweaver": {
          directory: "/repo/dreamweaver",
          path: {},
          sessions: [activeSession],
          sessionStatus: { "session-1": { type: "idle" as const } },
          providers: { all: [], connected: [], default: {} },
          agents: [],
          config: {},
          permissions: [],
          questions: [],
          commands: [],
          mcp: {},
          lsp: [],
          formatter: [],
          ptys: [],
        } as never,
      },
    }));

    const { container } = render(<App />);

    const sessionButton = await screen.findByText("Build Spa Booking Site");
    const selectProjectCallsBeforeArchive = selectProjectMock.mock.calls.length;
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(await screen.findByText("Archive Session"));

    await waitFor(() => {
      expect(archiveSessionMock).toHaveBeenCalledWith("/repo/dreamweaver", "session-1");
      expect(screen.queryByText("Build Spa Booking Site")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByText("Opening session...")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(container.querySelectorAll(".workspace-landing-card").length).toBeGreaterThan(0);
    });
    expect(selectProjectMock).toHaveBeenCalledTimes(selectProjectCallsBeforeArchive + 1);
  });

  it("archives inactive sessions without rerouting the current workspace view", async () => {
    const activeSession = {
      id: "session-active",
      slug: "active-session",
      title: "Keep Me Open",
      time: { created: Date.now(), updated: Date.now() },
    };
    const archivedSession = {
      id: "session-archive",
      slug: "archive-me",
      title: "Archive Me",
      time: { created: Date.now() - 1000, updated: Date.now() - 1000 },
    };
    const projectData = {
      directory: "/repo/dreamweaver",
      path: {},
      sessions: [activeSession, archivedSession],
      sessionStatus: {
        "session-active": { type: "idle" as const },
        "session-archive": { type: "idle" as const },
      },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    };

    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "dreamweaver", worktree: "/repo/dreamweaver", source: "local" as const }],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const selectProjectMock = vi.fn(async () => projectData);
    const refreshProjectMock = vi.fn(async () => ({
      ...projectData,
      sessions: [activeSession],
      sessionStatus: { "session-active": { type: "idle" as const } },
    }));
    const archiveSessionMock = vi.fn(async () => ({ ...archivedSession, time: { ...archivedSession.time, archived: Date.now() } }));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
          refreshProject: refreshProjectMock,
          archiveSession: archiveSessionMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    expect(await screen.findByText("Keep Me Open")).toBeInTheDocument();
    fireEvent.contextMenu(await screen.findByText("Archive Me"));
    fireEvent.click(await screen.findByText("Archive Session"));

    await waitFor(() => {
      expect(archiveSessionMock).toHaveBeenCalledWith("/repo/dreamweaver", "session-archive");
      expect(screen.queryByText("Archive Me")).not.toBeInTheDocument();
    });
    expect(selectProjectMock).toHaveBeenCalledTimes(1);
  });

  it("clears Claude chat runtime state when archiving from the App shell", async () => {
    const sessionKey = "/repo/reliabilityworks::session-claude-chat";
    window.localStorage.setItem(
      "orxa:sessionTypes:v2",
      JSON.stringify({ [sessionKey]: "claude-chat" }),
    );

    useUnifiedRuntimeStore.setState({
      claudeChatSessions: {
        [sessionKey]: {
          key: sessionKey,
          directory: "/repo/reliabilityworks",
          connectionStatus: "connected",
          providerThreadId: "claude-thread-1",
          activeTurnId: "turn-1",
          messages: [],
          historyMessages: [],
          pendingApproval: {
            id: "approval-1",
            sessionKey,
            threadId: "claude-thread-1",
            turnId: "turn-1",
            itemId: "item-1",
            toolName: "Edit",
            reason: "Allow file edit",
            availableDecisions: ["accept", "decline"],
          },
          pendingUserInput: null,
          isStreaming: true,
          subagents: [
            {
              id: "agent-1",
              name: "Scout",
              role: "explorer",
              status: "thinking",
              statusText: "Working",
              prompt: "Inspect repository",
            },
          ],
          lastError: undefined,
        },
      },
    });

    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "reliabilityworks", worktree: "/repo/reliabilityworks", source: "local" as const }],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const activeSession = {
      id: "session-claude-chat",
      slug: "claude-chat",
      title: "Claude Code (Chat)",
      time: { created: Date.now(), updated: Date.now() },
    };
    const selectProjectMock = vi.fn(async () => ({
      directory: "/repo/reliabilityworks",
      path: {},
      sessions: [activeSession],
      sessionStatus: { "session-claude-chat": { type: "idle" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));
    const refreshProjectMock = vi.fn(async () => ({
      directory: "/repo/reliabilityworks",
      path: {},
      sessions: [],
      sessionStatus: {},
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
          refreshProject: refreshProjectMock,
          archiveSession: vi.fn(async () => ({ ...activeSession, time: { ...activeSession.time, archived: Date.now() } })),
        },
        claudeChat: {
          ...window.orxa!.claudeChat,
          archiveSession: vi.fn(async () => undefined),
        },
      },
      configurable: true,
    });

    render(<App />);

    const sessionButton = await screen.findByText("Claude Code (Chat)");
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(await screen.findByText("Archive Session"));

    await waitFor(() => {
      expect(useUnifiedRuntimeStore.getState().claudeChatSessions[sessionKey]).toBeUndefined();
    });
  });

  it("renames Claude chat provider sessions from the App shell", async () => {
    const sessionKey = "/repo/reliabilityworks::session-claude-chat";
    window.localStorage.setItem(
      "orxa:sessionTypes:v2",
      JSON.stringify({ [sessionKey]: "claude-chat" }),
    );

    useUnifiedRuntimeStore.setState({
      claudeChatSessions: {
        [sessionKey]: {
          key: sessionKey,
          directory: "/repo/reliabilityworks",
          connectionStatus: "connected",
          providerThreadId: "claude-thread-1",
          activeTurnId: null,
          messages: [],
          historyMessages: [],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: false,
          subagents: [],
        },
      },
    });

    const activeSession = {
      id: "session-claude-chat",
      title: "Claude Code (Chat)",
      slug: "claude-chat",
      time: { created: Date.now(), updated: Date.now() },
    };

    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "reliabilityworks", worktree: "/repo/reliabilityworks", source: "local" as const }],
      runtime: { status: "connected" as const, managedServer: false },
    }));
    const selectProjectMock = vi.fn(async () => ({
      directory: "/repo/reliabilityworks",
      path: {},
      sessions: [activeSession],
      sessionStatus: { "session-claude-chat": { type: "idle" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));
    const renameProviderSessionMock = vi.fn(async () => undefined);

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
        claudeChat: {
          ...window.orxa!.claudeChat,
          renameProviderSession: renameProviderSessionMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    const sessionButton = await screen.findByText("Claude Code (Chat)");
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(await screen.findByText("Rename Session"));

    const input = await screen.findByPlaceholderText("Session title");
    fireEvent.change(input, { target: { value: "Renamed Claude Session" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => {
      expect(renameProviderSessionMock).toHaveBeenCalledWith("claude-thread-1", "Renamed Claude Session", "/repo/reliabilityworks");
    });
  });

  it("falls back to Claude history message session ids when renaming provider sessions", async () => {
    const sessionKey = "/repo/reliabilityworks::session-claude-chat";
    window.localStorage.setItem(
      "orxa:sessionTypes:v2",
      JSON.stringify({ [sessionKey]: "claude-chat" }),
    );

    useUnifiedRuntimeStore.setState({
      claudeChatSessions: {
        [sessionKey]: {
          key: sessionKey,
          directory: "/repo/reliabilityworks",
          connectionStatus: "connected",
          providerThreadId: null,
          activeTurnId: null,
          messages: [],
          historyMessages: [
            {
              id: "history-1",
              role: "assistant",
              content: "Hello",
              timestamp: Date.now(),
              sessionId: "claude-thread-from-history",
            },
          ],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: false,
          subagents: [],
        },
      },
    });

    const activeSession = {
      id: "session-claude-chat",
      title: "Claude Code (Chat)",
      slug: "claude-chat",
      time: { created: Date.now(), updated: Date.now() },
    };

    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "reliabilityworks", worktree: "/repo/reliabilityworks", source: "local" as const }],
      runtime: { status: "connected" as const, managedServer: false },
    }));
    const selectProjectMock = vi.fn(async () => ({
      directory: "/repo/reliabilityworks",
      path: {},
      sessions: [activeSession],
      sessionStatus: { "session-claude-chat": { type: "idle" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));
    const renameProviderSessionMock = vi.fn(async () => undefined);

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
        claudeChat: {
          ...window.orxa!.claudeChat,
          renameProviderSession: renameProviderSessionMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    const sessionButton = await screen.findByText("Claude Code (Chat)");
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(await screen.findByText("Rename Session"));

    const input = await screen.findByPlaceholderText("Session title");
    fireEvent.change(input, { target: { value: "Renamed From History" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));

    await waitFor(() => {
      expect(renameProviderSessionMock).toHaveBeenCalledWith("claude-thread-from-history", "Renamed From History", "/repo/reliabilityworks");
    });
  });

  it("falls back to Claude history message session ids when copying the session id", async () => {
    const sessionKey = "/repo/reliabilityworks::session-claude-chat";
    window.localStorage.setItem(
      "orxa:sessionTypes:v2",
      JSON.stringify({ [sessionKey]: "claude-chat" }),
    );

    useUnifiedRuntimeStore.setState({
      claudeChatSessions: {
        [sessionKey]: {
          key: sessionKey,
          directory: "/repo/reliabilityworks",
          connectionStatus: "connected",
          providerThreadId: null,
          activeTurnId: null,
          messages: [],
          historyMessages: [
            {
              id: "history-1",
              role: "assistant",
              content: "Hello",
              timestamp: Date.now(),
              sessionId: "claude-thread-from-history",
            },
          ],
          pendingApproval: null,
          pendingUserInput: null,
          isStreaming: false,
          subagents: [],
        },
      },
    });

    const clipboardWriteText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
    });

    const activeSession = {
      id: "session-claude-chat",
      title: "Claude Code (Chat)",
      slug: "claude-chat",
      time: { created: Date.now(), updated: Date.now() },
    };

    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "reliabilityworks", worktree: "/repo/reliabilityworks", source: "local" as const }],
      runtime: { status: "connected" as const, managedServer: false },
    }));
    const selectProjectMock = vi.fn(async () => ({
      directory: "/repo/reliabilityworks",
      path: {},
      sessions: [activeSession],
      sessionStatus: { "session-claude-chat": { type: "idle" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    const sessionButton = await screen.findByText("Claude Code (Chat)");
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(await screen.findByText("Copy Claude Thread ID"));

    await waitFor(() => {
      expect(clipboardWriteText).toHaveBeenCalledWith("claude-thread-from-history");
    });
  });

  it("deletes an unused Codex session when navigating away", async () => {
    const bootstrapMock = vi.fn(async () => ({
      projects: [
        { id: "proj-1", name: "marketing-websites", worktree: "/repo/marketing-websites", source: "local" as const },
        { id: "proj-2", name: "dreamweaver", worktree: "/repo/dreamweaver", source: "local" as const },
      ],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const deleteSessionMock = vi.fn(async () => true);
    const selectProjectMock = vi.fn(async (directory: string) => {
      if (directory === "/repo/marketing-websites") {
        return {
          directory,
          path: {},
          sessions: [],
          sessionStatus: {},
          providers: { all: [], connected: [], default: {} },
          agents: [],
          config: {},
          permissions: [],
          questions: [],
          commands: [],
          mcp: {},
          lsp: [],
          formatter: [],
          ptys: [],
        };
      }
      return {
        directory,
        path: {},
        sessions: [],
        sessionStatus: {},
        providers: { all: [], connected: [], default: {} },
        agents: [],
        config: {},
        permissions: [],
        questions: [],
        commands: [],
        mcp: {},
        lsp: [],
        formatter: [],
        ptys: [],
      };
    });

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
          deleteSession: deleteSessionMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "marketing-websites" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create session for marketing-websites" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Codex/i }));
    fireEvent.click(await screen.findByRole("button", { name: "dreamweaver" }));

    await waitFor(() => {
      expect(deleteSessionMock).not.toHaveBeenCalled();
    });

    fireEvent.click(await screen.findByRole("button", { name: "marketing-websites" }));
    await waitFor(() => {
      expect(screen.queryByText("Codex Session")).not.toBeInTheDocument();
    });
  });

  it("deletes an unused Claude chat session when navigating away", async () => {
    const bootstrapMock = vi.fn(async () => ({
      projects: [
        { id: "proj-1", name: "marketing-websites", worktree: "/repo/marketing-websites", source: "local" as const },
        { id: "proj-2", name: "dreamweaver", worktree: "/repo/dreamweaver", source: "local" as const },
      ],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const deleteSessionMock = vi.fn(async () => true);
    const selectProjectMock = vi.fn(async (directory: string) => ({
      directory,
      path: {},
      sessions: [],
      sessionStatus: {},
      providers: { all: [], connected: [], default: {} },
      agents: [],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
          deleteSession: deleteSessionMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "marketing-websites" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create session for marketing-websites" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Claude Chat/i }));
    fireEvent.click(await screen.findByRole("button", { name: "dreamweaver" }));

    await waitFor(() => {
      expect(deleteSessionMock).not.toHaveBeenCalled();
    });

    fireEvent.click(await screen.findByRole("button", { name: "marketing-websites" }));
    await waitFor(() => {
      expect(screen.queryAllByText("Claude Code (Chat)")).toHaveLength(1);
    });
  });

  it("cleans up persisted empty sessions during startup", async () => {
    const deleteSessionMock = vi.fn(async () => true);

    window.localStorage.setItem(EMPTY_WORKSPACE_SESSIONS_KEY, JSON.stringify({
      "session-empty": "/repo/marketing-websites",
    }));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: vi.fn(async () => ({
            projects: [],
            runtime: { status: "disconnected" as const, managedServer: false },
          })),
          deleteSession: deleteSessionMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    await waitFor(() => {
      expect(deleteSessionMock).toHaveBeenCalledWith("/repo/marketing-websites", "session-empty");
    });
    expect(window.localStorage.getItem(EMPTY_WORKSPACE_SESSIONS_KEY)).toBeNull();
  });

  it("chooses preferred agents", () => {
    expect(
      preferredAgentForMode({
        hasPlanAgent: true,
        serverAgentNames: new Set(["plan", "build"]),
        firstAgentName: "plan",
      }),
    ).toBe("build");

    expect(
      preferredAgentForMode({
        hasPlanAgent: true,
        serverAgentNames: new Set(["plan"]),
        firstAgentName: "plan",
      }),
    ).toBe("plan");
  });

  it("loads the global Opencode agent registry independently of workspace-scoped agents", async () => {
    const bootstrapMock = vi.fn(async () => ({
      projects: [{ id: "proj-1", name: "dreamweaver", worktree: "/repo/dreamweaver", source: "local" as const }],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const selectProjectMock = vi.fn(async () => ({
      directory: "/repo/dreamweaver",
      path: {},
      sessions: [{
        id: "session-1",
        slug: "design-session",
        title: "Design session",
        time: { created: Date.now(), updated: Date.now() },
      }],
      sessionStatus: { "session-1": { type: "idle" as const } },
      providers: { all: [], connected: [], default: {} },
      agents: [{ name: "plan", mode: "primary", description: "Plan" }],
      config: {},
      permissions: [],
      questions: [],
      commands: [],
      mcp: {},
      lsp: [],
      formatter: [],
      ptys: [],
    }));
    const listAgentsMock = vi.fn(async () => ([
      { name: "plan", mode: "primary", description: "Plan" },
      { name: "conductor", mode: "primary", description: "Conductor" },
      { name: "builder", mode: "primary", description: "Builder" },
      { name: "orchestrator", mode: "primary", description: "Orchestrator" },
    ]));
    const listAgentFilesMock = vi.fn(async () => ([
      { filename: "plan.md", name: "plan", mode: "primary", description: "Plan", model: "openai/gpt-5.4", content: "", path: "/Users/test/.config/opencode/agents/plan.md" },
      { filename: "conductor.md", name: "conductor", mode: "primary", description: "Conductor", model: "kimi-for-coding/kimi-k2.5", content: "", path: "/Users/test/.config/opencode/agents/conductor.md" },
      { filename: "builder.md", name: "builder", mode: "primary", description: "Builder", model: "openai/gpt-5.4", content: "", path: "/Users/test/.config/opencode/agents/builder.md" },
      { filename: "orchestrator.md", name: "orchestrator", mode: "primary", description: "Orchestrator", model: "openai/gpt-5.4", content: "", path: "/Users/test/.config/opencode/agents/orchestrator.md" },
    ]));

    Object.defineProperty(window, "orxa", {
      value: {
        ...window.orxa,
        opencode: {
          ...window.orxa!.opencode,
          bootstrap: bootstrapMock,
          selectProject: selectProjectMock,
          listAgents: listAgentsMock,
          listAgentFiles: listAgentFilesMock,
        },
      },
      configurable: true,
    });

    render(<App />);

    await waitFor(() => {
      expect(listAgentsMock).toHaveBeenCalled();
      expect(listAgentFilesMock).toHaveBeenCalled();
    });
  });

  it("shows dependency modal when required runtime dependency is missing", async () => {
    checkDependenciesMock.mockResolvedValueOnce({
      checkedAt: Date.now(),
      missingAny: true,
      missingRequired: true,
      dependencies: [
        {
          key: "opencode",
          label: "OpenCode CLI",
          required: true,
          installed: false,
          description: "Core runtime and CLI backend used by the app for sessions, tools, and streaming.",
          reason: "Required. Orxa Code depends on the OpenCode server and CLI APIs.",
          installCommand: "npm install -g opencode-ai",
          sourceUrl: "https://github.com/anomalyco/opencode",
        },
        {
          key: "orxa",
          label: "Orxa Code Plugin Package",
          required: false,
          installed: false,
          description: "Orxa workflows, agents, and plugin assets for the dedicated Orxa mode experience.",
          reason: "Optional. Needed only when using Orxa mode features.",
          installCommand: "npm install -g @reliabilityworks/opencode-orxa",
          sourceUrl: "https://github.com/Reliability-Works/opencode-orxa",
        },
      ],
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Runtime Dependencies" })).toBeInTheDocument();
    });

    expect(screen.getByText("npm install -g opencode-ai")).toBeInTheDocument();
    expect(screen.getByText("npm install -g @reliabilityworks/opencode-orxa")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check again" })).toBeInTheDocument();

    const overlay = document.querySelector(".dependency-overlay");
    expect(overlay).not.toBeNull();
    overlay?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(screen.getByRole("heading", { name: "Runtime Dependencies" })).toBeInTheDocument();

    checkDependenciesMock.mockResolvedValueOnce({
      checkedAt: Date.now(),
      missingAny: false,
      missingRequired: false,
      dependencies: [
        {
          key: "opencode",
          label: "OpenCode CLI",
          required: true,
          installed: true,
          description: "Core runtime and CLI backend used by the app for sessions, tools, and streaming.",
          reason: "Required. Orxa Code depends on the OpenCode server and CLI APIs.",
          installCommand: "npm install -g opencode-ai",
          sourceUrl: "https://github.com/anomalyco/opencode",
        },
        {
          key: "orxa",
          label: "Orxa Code Plugin Package",
          required: false,
          installed: true,
          description: "Orxa workflows, agents, and plugin assets for the dedicated Orxa mode experience.",
          reason: "Optional. Needed only when using Orxa mode features.",
          installCommand: "npm install -g @reliabilityworks/opencode-orxa",
          sourceUrl: "https://github.com/Reliability-Works/opencode-orxa",
        },
      ],
    });
    const callsBeforeRetry = checkDependenciesMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Runtime Dependencies" })).not.toBeInTheDocument();
    });
    expect(checkDependenciesMock.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeRetry + 1);
  });

});
