import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { OrxaAgentDocument } from "@shared/ipc";
import { preferredAgentForMode } from "./lib/app-mode";

const modeGetMock = vi.fn(async () => "orxa");
const modeSetMock = vi.fn(async (mode: "orxa" | "standard") => mode);
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
      reason: "Required. Opencode Orxa depends on the OpenCode server and CLI APIs.",
      installCommand: "npm install -g opencode-ai",
      sourceUrl: "https://github.com/anomalyco/opencode",
    },
    {
      key: "orxa" as const,
      label: "Opencode Orxa Package",
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
  const subscribe = vi.fn(() => () => undefined);
  modeGetMock.mockResolvedValue("orxa");
  modeSetMock.mockImplementation(async (mode: "orxa" | "standard") => mode);
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
        reason: "Required. Opencode Orxa depends on the OpenCode server and CLI APIs.",
        installCommand: "npm install -g opencode-ai",
        sourceUrl: "https://github.com/anomalyco/opencode",
      },
      {
        key: "orxa",
        label: "Opencode Orxa Package",
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
      mode: {
        get: modeGetMock,
        set: modeSetMock,
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
        pickImage: vi.fn(async () => undefined),
        readOrxaConfig: vi.fn(async () => ({ scope: "global", path: "orxa.json", content: "{}" })),
        writeOrxaConfig: vi.fn(async () => ({ scope: "global", path: "orxa.json", content: "{}" })),
        readOrxaAgentPrompt: vi.fn(async () => undefined),
        listOrxaAgents: vi.fn(async (): Promise<OrxaAgentDocument[]> => []),
        saveOrxaAgent: vi.fn(async () => ({
          name: "orxa",
          mode: "primary",
          path: "orxa.yaml",
          source: "override",
        })),
        getOrxaAgentDetails: vi.fn(async () => ({ history: [] })),
        resetOrxaAgent: vi.fn(async () => undefined),
        restoreOrxaAgentHistory: vi.fn(async () => undefined),
        getServerDiagnostics: vi.fn(async () => ({
          runtime: { status: "disconnected", managedServer: false },
          health: "disconnected",
          plugin: {
            specifier: "@reliabilityworks/opencode-orxa@1.0.43",
            configPath: "opencode.jsonc",
            installedPath: "node_modules/@reliabilityworks/opencode-orxa",
            configured: false,
            installed: false,
          },
        })),
        repairRuntime: vi.fn(async () => ({
          runtime: { status: "disconnected", managedServer: false },
          health: "disconnected",
          plugin: {
            specifier: "@reliabilityworks/opencode-orxa@1.0.43",
            configPath: "opencode.jsonc",
            installedPath: "node_modules/@reliabilityworks/opencode-orxa",
            configured: false,
            installed: false,
          },
        })),
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

    expect(screen.getByRole("button", { name: "Profiles" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Config" })).toBeInTheDocument();
  });

  it("chooses preferred agents by mode", () => {
    expect(
      preferredAgentForMode({
        mode: "standard",
        hasOrxaAgent: true,
        hasPlanAgent: true,
        serverAgentNames: new Set(["orxa", "plan", "build"]),
        firstAgentName: "orxa",
      }),
    ).toBe("build");

    expect(
      preferredAgentForMode({
        mode: "standard",
        hasOrxaAgent: false,
        hasPlanAgent: true,
        serverAgentNames: new Set(["plan"]),
        firstAgentName: "plan",
      }),
    ).toBe("plan");

    expect(
      preferredAgentForMode({
        mode: "orxa",
        hasOrxaAgent: true,
        hasPlanAgent: true,
        serverAgentNames: new Set(["orxa", "plan"]),
        firstAgentName: "plan",
      }),
    ).toBe("orxa");
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
          reason: "Required. Opencode Orxa depends on the OpenCode server and CLI APIs.",
          installCommand: "npm install -g opencode-ai",
          sourceUrl: "https://github.com/anomalyco/opencode",
        },
        {
          key: "orxa",
          label: "Opencode Orxa Package",
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
          reason: "Required. Opencode Orxa depends on the OpenCode server and CLI APIs.",
          installCommand: "npm install -g opencode-ai",
          sourceUrl: "https://github.com/anomalyco/opencode",
        },
        {
          key: "orxa",
          label: "Opencode Orxa Package",
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
