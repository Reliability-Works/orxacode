import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OrxaAgentDocument, RawConfigDocument, ServerDiagnostics } from "@shared/ipc";
import { SettingsDrawer } from "./SettingsDrawer";

afterEach(() => {
  cleanup();
});

describe("SettingsDrawer", () => {
  it("hides Orxa-only sections in standard mode", () => {
    const rawDoc: RawConfigDocument = { scope: "global", path: "config.json", content: "{}" };
    const orxaDoc: RawConfigDocument = { scope: "global", path: "orxa.json", content: "{}" };
    const savedAgent: OrxaAgentDocument = { name: "orxa", mode: "primary", path: "orxa.yaml", source: "override" };
    const diagnostics: ServerDiagnostics = {
      runtime: { status: "disconnected", managedServer: false },
      health: "disconnected",
      plugin: {
        specifier: "@reliabilityworks/opencode-orxa@1.0.43",
        configPath: "opencode.jsonc",
        installedPath: "node_modules/@reliabilityworks/opencode-orxa",
        configured: false,
        installed: false,
      },
    };

    render(
      <SettingsDrawer
        open
        mode="standard"
        modeSwitching={false}
        directory={undefined}
        onClose={() => undefined}
        onReadRaw={vi.fn(async () => rawDoc)}
        onWriteRaw={vi.fn(async () => rawDoc)}
        onReadGlobalAgentsMd={vi.fn(async () => ({ path: "/Users/test/.config/opencode/AGENTS.md", content: "", exists: false }))}
        onWriteGlobalAgentsMd={vi.fn(async () => ({ path: "/Users/test/.config/opencode/AGENTS.md", content: "", exists: true }))}
        onReadOrxa={vi.fn(async () => orxaDoc)}
        onWriteOrxa={vi.fn(async () => orxaDoc)}
        onListOrxaAgents={vi.fn(async () => [])}
        onSaveOrxaAgent={vi.fn(async () => savedAgent)}
        onGetOrxaAgentDetails={vi.fn(async () => ({ history: [] }))}
        onResetOrxaAgent={vi.fn(async () => undefined)}
        onRestoreOrxaAgentHistory={vi.fn(async () => undefined)}
        appPreferences={{
          showOperationsPane: true,
          autoOpenTerminalOnCreate: true,
          confirmDangerousActions: true,
          permissionMode: "ask-write",
          commitGuidancePrompt: "",
          codeFont: "IBM Plex Mono",
          hiddenModels: [],
        }}
        onAppPreferencesChange={() => undefined}
        onGetServerDiagnostics={vi.fn(async () => diagnostics)}
        onRepairRuntime={vi.fn(async () => diagnostics)}
        onGetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onSetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onCheckForUpdates={vi.fn(async () => ({ ok: true, status: "started" as const }))}
        onGetMemorySettings={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onUpdateMemorySettings={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onListMemoryTemplates={vi.fn(async () => [])}
        onApplyMemoryTemplate={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onBackfillMemory={vi.fn(async () => ({
          running: false,
          progress: 1,
          scannedSessions: 0,
          totalSessions: 0,
          inserted: 0,
          updated: 0,
        }))}
        onClearWorkspaceMemory={vi.fn(async () => true)}
        onChangeMode={vi.fn(async () => undefined)}
        allModelOptions={[]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Orxa Agents" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Orxa JSON Editor" })).not.toBeInTheDocument();
  });

  it("renders provider models only from discoverable option input", () => {
    const rawDoc: RawConfigDocument = { scope: "global", path: "config.json", content: "{}" };
    const orxaDoc: RawConfigDocument = { scope: "global", path: "orxa.json", content: "{}" };
    const savedAgent: OrxaAgentDocument = { name: "orxa", mode: "primary", path: "orxa.yaml", source: "override" };
    const diagnostics: ServerDiagnostics = {
      runtime: { status: "disconnected", managedServer: false },
      health: "disconnected",
      plugin: {
        specifier: "@reliabilityworks/opencode-orxa@1.0.43",
        configPath: "opencode.jsonc",
        installedPath: "node_modules/@reliabilityworks/opencode-orxa",
        configured: false,
        installed: false,
      },
    };

    render(
      <SettingsDrawer
        open
        mode="standard"
        modeSwitching={false}
        directory={undefined}
        onClose={() => undefined}
        onReadRaw={vi.fn(async () => rawDoc)}
        onWriteRaw={vi.fn(async () => rawDoc)}
        onReadGlobalAgentsMd={vi.fn(async () => ({ path: "/Users/test/.config/opencode/AGENTS.md", content: "", exists: false }))}
        onWriteGlobalAgentsMd={vi.fn(async () => ({ path: "/Users/test/.config/opencode/AGENTS.md", content: "", exists: true }))}
        onReadOrxa={vi.fn(async () => orxaDoc)}
        onWriteOrxa={vi.fn(async () => orxaDoc)}
        onListOrxaAgents={vi.fn(async () => [])}
        onSaveOrxaAgent={vi.fn(async () => savedAgent)}
        onGetOrxaAgentDetails={vi.fn(async () => ({ history: [] }))}
        onResetOrxaAgent={vi.fn(async () => undefined)}
        onRestoreOrxaAgentHistory={vi.fn(async () => undefined)}
        appPreferences={{
          showOperationsPane: true,
          autoOpenTerminalOnCreate: true,
          confirmDangerousActions: true,
          permissionMode: "ask-write",
          commitGuidancePrompt: "",
          codeFont: "IBM Plex Mono",
          hiddenModels: [],
        }}
        onAppPreferencesChange={() => undefined}
        onGetServerDiagnostics={vi.fn(async () => diagnostics)}
        onRepairRuntime={vi.fn(async () => diagnostics)}
        onGetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onSetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onCheckForUpdates={vi.fn(async () => ({ ok: true, status: "started" as const }))}
        onGetMemorySettings={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onUpdateMemorySettings={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onListMemoryTemplates={vi.fn(async () => [])}
        onApplyMemoryTemplate={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onBackfillMemory={vi.fn(async () => ({
          running: false,
          progress: 1,
          scannedSessions: 0,
          totalSessions: 0,
          inserted: 0,
          updated: 0,
        }))}
        onClearWorkspaceMemory={vi.fn(async () => true)}
        onChangeMode={vi.fn(async () => undefined)}
        allModelOptions={[
          {
            key: "openai/gpt-5.2",
            providerID: "openai",
            modelID: "gpt-5.2",
            providerName: "OpenAI",
            modelName: "GPT-5.2",
            variants: [],
          },
          {
            key: "cloudflare/@cf/meta/llama-3.1-8b-instruct",
            providerID: "cloudflare",
            modelID: "@cf/meta/llama-3.1-8b-instruct",
            providerName: "Cloudflare AI",
            modelName: "Llama 3.1 8B Instruct",
            variants: [],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Provider Models" })[0]!);

    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Cloudflare AI")).toBeInTheDocument();
    expect(screen.queryByText("Abacus")).not.toBeInTheDocument();
  });

  it("shows app version in app preferences", () => {
    const rawDoc: RawConfigDocument = { scope: "global", path: "config.json", content: "{}" };
    const orxaDoc: RawConfigDocument = { scope: "global", path: "orxa.json", content: "{}" };
    const savedAgent: OrxaAgentDocument = { name: "orxa", mode: "primary", path: "orxa.yaml", source: "override" };
    const diagnostics: ServerDiagnostics = {
      runtime: { status: "disconnected", managedServer: false },
      health: "disconnected",
      plugin: {
        specifier: "@reliabilityworks/opencode-orxa@1.0.43",
        configPath: "opencode.jsonc",
        installedPath: "node_modules/@reliabilityworks/opencode-orxa",
        configured: false,
        installed: false,
      },
    };

    render(
      <SettingsDrawer
        open
        mode="standard"
        modeSwitching={false}
        directory={undefined}
        onClose={() => undefined}
        onReadRaw={vi.fn(async () => rawDoc)}
        onWriteRaw={vi.fn(async () => rawDoc)}
        onReadGlobalAgentsMd={vi.fn(async () => ({ path: "/Users/test/.config/opencode/AGENTS.md", content: "", exists: false }))}
        onWriteGlobalAgentsMd={vi.fn(async () => ({ path: "/Users/test/.config/opencode/AGENTS.md", content: "", exists: true }))}
        onReadOrxa={vi.fn(async () => orxaDoc)}
        onWriteOrxa={vi.fn(async () => orxaDoc)}
        onListOrxaAgents={vi.fn(async () => [])}
        onSaveOrxaAgent={vi.fn(async () => savedAgent)}
        onGetOrxaAgentDetails={vi.fn(async () => ({ history: [] }))}
        onResetOrxaAgent={vi.fn(async () => undefined)}
        onRestoreOrxaAgentHistory={vi.fn(async () => undefined)}
        appPreferences={{
          showOperationsPane: true,
          autoOpenTerminalOnCreate: true,
          confirmDangerousActions: true,
          permissionMode: "ask-write",
          commitGuidancePrompt: "",
          codeFont: "IBM Plex Mono",
          hiddenModels: [],
        }}
        onAppPreferencesChange={() => undefined}
        onGetServerDiagnostics={vi.fn(async () => diagnostics)}
        onRepairRuntime={vi.fn(async () => diagnostics)}
        onGetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onSetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onCheckForUpdates={vi.fn(async () => ({ ok: true, status: "started" as const }))}
        onGetMemorySettings={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onUpdateMemorySettings={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onListMemoryTemplates={vi.fn(async () => [])}
        onApplyMemoryTemplate={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onBackfillMemory={vi.fn(async () => ({
          running: false,
          progress: 1,
          scannedSessions: 0,
          totalSessions: 0,
          inserted: 0,
          updated: 0,
        }))}
        onClearWorkspaceMemory={vi.fn(async () => true)}
        onChangeMode={vi.fn(async () => undefined)}
        allModelOptions={[]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "App" })[0]!);
    expect(screen.getByText(`Version: v${__APP_VERSION__}`)).toBeInTheDocument();
  });

  it("places git settings on the dedicated Git page", () => {
    const rawDoc: RawConfigDocument = { scope: "global", path: "config.json", content: "{}" };
    const orxaDoc: RawConfigDocument = { scope: "global", path: "orxa.json", content: "{}" };
    const savedAgent: OrxaAgentDocument = { name: "orxa", mode: "primary", path: "orxa.yaml", source: "override" };
    const diagnostics: ServerDiagnostics = {
      runtime: { status: "disconnected", managedServer: false },
      health: "disconnected",
      plugin: {
        specifier: "@reliabilityworks/opencode-orxa@1.0.43",
        configPath: "opencode.jsonc",
        installedPath: "node_modules/@reliabilityworks/opencode-orxa",
        configured: false,
        installed: false,
      },
    };

    render(
      <SettingsDrawer
        open
        mode="standard"
        modeSwitching={false}
        directory={undefined}
        onClose={() => undefined}
        onReadRaw={vi.fn(async () => rawDoc)}
        onWriteRaw={vi.fn(async () => rawDoc)}
        onReadGlobalAgentsMd={vi.fn(async () => ({ path: "/Users/test/.config/opencode/AGENTS.md", content: "", exists: false }))}
        onWriteGlobalAgentsMd={vi.fn(async () => ({ path: "/Users/test/.config/opencode/AGENTS.md", content: "", exists: true }))}
        onReadOrxa={vi.fn(async () => orxaDoc)}
        onWriteOrxa={vi.fn(async () => orxaDoc)}
        onListOrxaAgents={vi.fn(async () => [])}
        onSaveOrxaAgent={vi.fn(async () => savedAgent)}
        onGetOrxaAgentDetails={vi.fn(async () => ({ history: [] }))}
        onResetOrxaAgent={vi.fn(async () => undefined)}
        onRestoreOrxaAgentHistory={vi.fn(async () => undefined)}
        appPreferences={{
          showOperationsPane: true,
          autoOpenTerminalOnCreate: true,
          confirmDangerousActions: true,
          permissionMode: "ask-write",
          commitGuidancePrompt: "",
          codeFont: "IBM Plex Mono",
          hiddenModels: [],
        }}
        onAppPreferencesChange={() => undefined}
        onGetServerDiagnostics={vi.fn(async () => diagnostics)}
        onRepairRuntime={vi.fn(async () => diagnostics)}
        onGetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onSetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onCheckForUpdates={vi.fn(async () => ({ ok: true, status: "started" as const }))}
        onGetMemorySettings={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onUpdateMemorySettings={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onListMemoryTemplates={vi.fn(async () => [])}
        onApplyMemoryTemplate={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onBackfillMemory={vi.fn(async () => ({
          running: false,
          progress: 1,
          scannedSessions: 0,
          totalSessions: 0,
          inserted: 0,
          updated: 0,
        }))}
        onClearWorkspaceMemory={vi.fn(async () => true)}
        onChangeMode={vi.fn(async () => undefined)}
        allModelOptions={[]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "App" })[0]!);
    expect(screen.queryByText("Commit message guidance prompt")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Git" })[0]!);
    expect(screen.getByText("Commit message guidance prompt")).toBeInTheDocument();
  });

  it("allows editing global AGENTS.md on the Personalization page", async () => {
    const rawDoc: RawConfigDocument = { scope: "global", path: "config.json", content: "{}" };
    const orxaDoc: RawConfigDocument = { scope: "global", path: "orxa.json", content: "{}" };
    const savedAgent: OrxaAgentDocument = { name: "orxa", mode: "primary", path: "orxa.yaml", source: "override" };
    const diagnostics: ServerDiagnostics = {
      runtime: { status: "disconnected", managedServer: false },
      health: "disconnected",
      plugin: {
        specifier: "@reliabilityworks/opencode-orxa@1.0.43",
        configPath: "opencode.jsonc",
        installedPath: "node_modules/@reliabilityworks/opencode-orxa",
        configured: false,
        installed: false,
      },
    };
    const readGlobalAgentsMd = vi.fn(async () => ({
      path: "/Users/test/.config/opencode/AGENTS.md",
      content: "# Global Rules\n",
      exists: true,
    }));
    const writeGlobalAgentsMd = vi.fn(async (content: string) => ({
      path: "/Users/test/.config/opencode/AGENTS.md",
      content,
      exists: true,
    }));

    render(
      <SettingsDrawer
        open
        mode="standard"
        modeSwitching={false}
        directory={undefined}
        onClose={() => undefined}
        onReadRaw={vi.fn(async () => rawDoc)}
        onWriteRaw={vi.fn(async () => rawDoc)}
        onReadGlobalAgentsMd={readGlobalAgentsMd}
        onWriteGlobalAgentsMd={writeGlobalAgentsMd}
        onReadOrxa={vi.fn(async () => orxaDoc)}
        onWriteOrxa={vi.fn(async () => orxaDoc)}
        onListOrxaAgents={vi.fn(async () => [])}
        onSaveOrxaAgent={vi.fn(async () => savedAgent)}
        onGetOrxaAgentDetails={vi.fn(async () => ({ history: [] }))}
        onResetOrxaAgent={vi.fn(async () => undefined)}
        onRestoreOrxaAgentHistory={vi.fn(async () => undefined)}
        appPreferences={{
          showOperationsPane: true,
          autoOpenTerminalOnCreate: true,
          confirmDangerousActions: true,
          permissionMode: "ask-write",
          commitGuidancePrompt: "",
          codeFont: "IBM Plex Mono",
          hiddenModels: [],
        }}
        onAppPreferencesChange={() => undefined}
        onGetServerDiagnostics={vi.fn(async () => diagnostics)}
        onRepairRuntime={vi.fn(async () => diagnostics)}
        onGetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onSetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onCheckForUpdates={vi.fn(async () => ({ ok: true, status: "started" as const }))}
        onGetMemorySettings={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onUpdateMemorySettings={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onListMemoryTemplates={vi.fn(async () => [])}
        onApplyMemoryTemplate={vi.fn(async () => ({
          global: {
            enabled: false,
            mode: "balanced" as const,
            guidance: "",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          hasWorkspaceOverride: false,
        }))}
        onBackfillMemory={vi.fn(async () => ({
          running: false,
          progress: 1,
          scannedSessions: 0,
          totalSessions: 0,
          inserted: 0,
          updated: 0,
        }))}
        onClearWorkspaceMemory={vi.fn(async () => true)}
        onChangeMode={vi.fn(async () => undefined)}
        allModelOptions={[]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Personalization" })[0]!);
    expect(screen.getByText("Your global AGENTS.md which will apply to all workspace sessions.")).toBeInTheDocument();
    await waitFor(() => expect(readGlobalAgentsMd).toHaveBeenCalled());
    expect(screen.getByText("/Users/test/.config/opencode/AGENTS.md")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Global AGENTS.md"), { target: { value: "# Updated Global Rules\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(writeGlobalAgentsMd).toHaveBeenCalledWith("# Updated Global Rules\n");
  });

  it("renders memory settings section with template controls", async () => {
    const rawDoc: RawConfigDocument = { scope: "global", path: "config.json", content: "{}" };
    const orxaDoc: RawConfigDocument = { scope: "global", path: "orxa.json", content: "{}" };
    const savedAgent: OrxaAgentDocument = { name: "orxa", mode: "primary", path: "orxa.yaml", source: "override" };
    const diagnostics: ServerDiagnostics = {
      runtime: { status: "disconnected", managedServer: false },
      health: "disconnected",
      plugin: {
        specifier: "@reliabilityworks/opencode-orxa@1.0.43",
        configPath: "opencode.jsonc",
        installedPath: "node_modules/@reliabilityworks/opencode-orxa",
        configured: false,
        installed: false,
      },
    };

    render(
      <SettingsDrawer
        open
        mode="standard"
        modeSwitching={false}
        directory="/repo"
        onClose={() => undefined}
        onReadRaw={vi.fn(async () => rawDoc)}
        onWriteRaw={vi.fn(async () => rawDoc)}
        onReadGlobalAgentsMd={vi.fn(async () => ({ path: "/Users/test/.config/opencode/AGENTS.md", content: "", exists: false }))}
        onWriteGlobalAgentsMd={vi.fn(async () => ({ path: "/Users/test/.config/opencode/AGENTS.md", content: "", exists: true }))}
        onReadOrxa={vi.fn(async () => orxaDoc)}
        onWriteOrxa={vi.fn(async () => orxaDoc)}
        onListOrxaAgents={vi.fn(async () => [])}
        onSaveOrxaAgent={vi.fn(async () => savedAgent)}
        onGetOrxaAgentDetails={vi.fn(async () => ({ history: [] }))}
        onResetOrxaAgent={vi.fn(async () => undefined)}
        onRestoreOrxaAgentHistory={vi.fn(async () => undefined)}
        appPreferences={{
          showOperationsPane: true,
          autoOpenTerminalOnCreate: true,
          confirmDangerousActions: true,
          permissionMode: "ask-write",
          commitGuidancePrompt: "",
          codeFont: "IBM Plex Mono",
          hiddenModels: [],
        }}
        onAppPreferencesChange={() => undefined}
        onGetServerDiagnostics={vi.fn(async () => diagnostics)}
        onRepairRuntime={vi.fn(async () => diagnostics)}
        onGetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onSetUpdatePreferences={vi.fn(async () => ({ autoCheckEnabled: true, releaseChannel: "stable" as const }))}
        onCheckForUpdates={vi.fn(async () => ({ ok: true, status: "started" as const }))}
        onGetMemorySettings={vi.fn(async () => ({
          global: {
            enabled: true,
            mode: "balanced" as const,
            guidance: "Capture durable facts.",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          directory: "/repo",
          hasWorkspaceOverride: false,
        }))}
        onUpdateMemorySettings={vi.fn(async () => ({
          global: {
            enabled: true,
            mode: "balanced" as const,
            guidance: "Capture durable facts.",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          directory: "/repo",
          hasWorkspaceOverride: false,
        }))}
        onListMemoryTemplates={vi.fn(async () => [
          {
            id: "balanced",
            name: "Balanced",
            description: "Balanced memory capture",
            policy: {
              enabled: true,
              mode: "balanced" as const,
              guidance: "Capture durable facts.",
              maxPromptMemories: 6,
              maxCapturePerSession: 24,
            },
          },
        ])}
        onApplyMemoryTemplate={vi.fn(async () => ({
          global: {
            enabled: true,
            mode: "balanced" as const,
            guidance: "Capture durable facts.",
            maxPromptMemories: 6,
            maxCapturePerSession: 24,
          },
          directory: "/repo",
          hasWorkspaceOverride: false,
        }))}
        onBackfillMemory={vi.fn(async () => ({
          running: false,
          progress: 1,
          scannedSessions: 1,
          totalSessions: 1,
          inserted: 2,
          updated: 0,
        }))}
        onClearWorkspaceMemory={vi.fn(async () => true)}
        onChangeMode={vi.fn(async () => undefined)}
        allModelOptions={[]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Memory" })[0]!);
    expect(screen.getByText("Template Import")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Import Balanced" })).toBeInTheDocument();
  });
});
