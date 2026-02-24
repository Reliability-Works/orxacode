import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { OrxaAgentDocument, RawConfigDocument, ServerDiagnostics } from "@shared/ipc";
import { SettingsDrawer } from "./SettingsDrawer";

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
        onChangeMode={vi.fn(async () => undefined)}
        allModelOptions={[]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Orxa Agents" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Orxa JSON Editor" })).not.toBeInTheDocument();
  });
});
