import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { OrxaAgentDocument } from "@shared/ipc";
import { preferredAgentForMode } from "./lib/app-mode";

const modeGetMock = vi.fn(async () => "orxa");
const modeSetMock = vi.fn(async (mode: "orxa" | "standard") => mode);

beforeEach(() => {
  const subscribe = vi.fn(() => () => undefined);
  modeGetMock.mockResolvedValue("orxa");
  modeSetMock.mockImplementation(async (mode: "orxa" | "standard") => mode);

  Object.defineProperty(window, "orxa", {
    value: {
      mode: {
        get: modeGetMock,
        set: modeSetMock,
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
        sendPrompt: vi.fn(async () => true),
        replyPermission: vi.fn(async () => true),
        replyQuestion: vi.fn(async () => true),
        rejectQuestion: vi.fn(async () => true),
        getConfig: vi.fn(async () => ({})),
        updateConfig: vi.fn(async () => ({})),
        readRawConfig: vi.fn(async () => ({ scope: "global", path: "config.json", content: "{}" })),
        writeRawConfig: vi.fn(async () => ({ scope: "global", path: "config.json", content: "{}" })),
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
});
