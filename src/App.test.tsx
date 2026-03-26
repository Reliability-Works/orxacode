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
        archiveSession: vi.fn(async () => undefined),
        archiveProviderSession: vi.fn(async () => undefined),
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

    render(<App />);

    const sessionButton = await screen.findByText("Build Spa Booking Site");
    fireEvent.contextMenu(sessionButton);
    fireEvent.click(await screen.findByText("Archive Session"));

    await waitFor(() => {
      expect(archiveSessionMock).toHaveBeenCalledWith("/repo/dreamweaver", "session-1");
      expect(screen.queryByText("Build Spa Booking Site")).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByText("Opening session...")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("New session")).not.toBeInTheDocument();
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

  it("deletes an unused Codex session when navigating away", async () => {
    const now = Date.now();
    const bootstrapMock = vi.fn(async () => ({
      projects: [
        { id: "proj-1", name: "marketing-websites", worktree: "/repo/marketing-websites", source: "local" as const },
        { id: "proj-2", name: "dreamweaver", worktree: "/repo/dreamweaver", source: "local" as const },
      ],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const createSessionMock = vi.fn(async () => ({
      id: "codex-empty",
      slug: "codex-empty",
      title: "Codex Session",
      time: { created: now, updated: now },
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
    const refreshProjectMock = vi.fn(async (directory: string) => {
      if (directory === "/repo/marketing-websites") {
        return {
          directory,
          path: {},
          sessions: [{
            id: "codex-empty",
            slug: "codex-empty",
            title: "Codex Session",
            time: { created: now, updated: now },
          }],
          sessionStatus: { "codex-empty": { type: "idle" as const } },
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
          refreshProject: refreshProjectMock,
          createSession: createSessionMock,
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
      expect(deleteSessionMock).toHaveBeenCalledWith("/repo/marketing-websites", "codex-empty");
    });

    fireEvent.click(await screen.findByRole("button", { name: "marketing-websites" }));
    await waitFor(() => {
      expect(screen.queryByText("Codex Session")).not.toBeInTheDocument();
    });
  });

  it("deletes an unused Claude chat session when navigating away", async () => {
    const now = Date.now();
    const bootstrapMock = vi.fn(async () => ({
      projects: [
        { id: "proj-1", name: "marketing-websites", worktree: "/repo/marketing-websites", source: "local" as const },
        { id: "proj-2", name: "dreamweaver", worktree: "/repo/dreamweaver", source: "local" as const },
      ],
      runtime: { status: "disconnected" as const, managedServer: false },
    }));
    const createSessionMock = vi.fn(async () => ({
      id: "claude-chat-empty",
      slug: "claude-chat-empty",
      title: "Claude Code (Chat)",
      time: { created: now, updated: now },
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
    const refreshProjectMock = vi.fn(async (directory: string) => {
      if (directory === "/repo/marketing-websites") {
        return {
          directory,
          path: {},
          sessions: [{
            id: "claude-chat-empty",
            slug: "claude-chat-empty",
            title: "Claude Code (Chat)",
            time: { created: now, updated: now },
          }],
          sessionStatus: { "claude-chat-empty": { type: "idle" as const } },
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
          refreshProject: refreshProjectMock,
          createSession: createSessionMock,
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
      expect(deleteSessionMock).toHaveBeenCalledWith("/repo/marketing-websites", "claude-chat-empty");
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
