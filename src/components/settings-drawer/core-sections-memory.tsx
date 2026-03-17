import type {
  MemoryBackfillStatus,
  MemoryPolicyMode,
  MemorySettings,
  MemorySettingsUpdateInput,
  MemoryTemplate,
} from "@shared/ipc";

type MemorySectionProps = {
  memorySettings: MemorySettings | null;
  directory: string | undefined;
  memoryLoading: boolean;
  setMemoryLoading: (value: boolean) => void;
  onUpdateMemorySettings: (input: MemorySettingsUpdateInput) => Promise<MemorySettings>;
  setMemorySettings: (settings: MemorySettings) => void;
  setFeedback: (message: string) => void;
  memoryTemplates: MemoryTemplate[];
  onApplyMemoryTemplate: (templateID: string, directory?: string, scope?: "global" | "workspace") => Promise<MemorySettings>;
  onBackfillMemory: (directory?: string) => Promise<MemoryBackfillStatus>;
  setMemoryBackfillStatus: (status: MemoryBackfillStatus) => void;
  memoryBackfillStatus: MemoryBackfillStatus | null;
  onClearWorkspaceMemory: (directory: string) => Promise<boolean>;
};

export function MemorySection({
  memorySettings,
  directory,
  memoryLoading,
  setMemoryLoading,
  onUpdateMemorySettings,
  setMemorySettings,
  setFeedback,
  memoryTemplates,
  onApplyMemoryTemplate,
  onBackfillMemory,
  setMemoryBackfillStatus,
  memoryBackfillStatus,
  onClearWorkspaceMemory,
}: MemorySectionProps) {
  const settings = memorySettings;
  const globalPolicy = settings?.global;
  const workspacePolicy = settings?.workspace;
  const hasWorkspaceOverride = Boolean(settings?.hasWorkspaceOverride);

  const applyGlobalPatch = (patch: MemorySettingsUpdateInput["global"]) => {
    setMemoryLoading(true);
    void onUpdateMemorySettings({
      directory,
      global: patch,
    })
      .then((next) => {
        setMemorySettings(next);
        setFeedback("Memory settings updated");
      })
      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
      .finally(() => setMemoryLoading(false));
  };

  const applyWorkspacePatch = (patch: MemorySettingsUpdateInput["workspace"]) => {
    if (!directory) {
      setFeedback("Select a workspace to edit workspace memory settings.");
      return;
    }
    setMemoryLoading(true);
    void onUpdateMemorySettings({
      directory,
      workspace: patch,
    })
      .then((next) => {
        setMemorySettings(next);
        setFeedback("Workspace memory settings updated");
      })
      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
      .finally(() => setMemoryLoading(false));
  };

  return (
    <section className="settings-section-card settings-pad">
      <h2 className="settings-memory-title">memory</h2>
      <p className="settings-memory-desc">
        memory is scoped by workspace for retrieval. graph view can aggregate all workspaces.
      </p>

      <div className="settings-memory-section">
        <p className="settings-memory-section-label">// global settings</p>
        <div className="settings-memory-row">
          <span className="settings-memory-row-label">global mode</span>
          <select
            className="settings-memory-select"
            value={globalPolicy?.mode ?? "balanced"}
            onChange={(event) => applyGlobalPatch({ mode: event.target.value as MemoryPolicyMode })}
            disabled={memoryLoading}
          >
            <option value="conservative">conservative</option>
            <option value="balanced">balanced</option>
            <option value="aggressive">aggressive</option>
            <option value="codebase-facts">codebase-facts</option>
          </select>
        </div>
        <label className="settings-inline-toggle">
          enable memory globally
          <input
            type="checkbox"
            checked={globalPolicy?.enabled ?? false}
            onChange={(event) => applyGlobalPatch({ enabled: event.target.checked })}
            disabled={memoryLoading}
          />
        </label>
        <div className="settings-memory-row">
          <span className="settings-memory-row-label">prompt memory limit</span>
          <input
            type="number"
            className="settings-memory-number"
            min={1}
            max={12}
            value={globalPolicy?.maxPromptMemories ?? 6}
            onChange={(event) => applyGlobalPatch({ maxPromptMemories: Number(event.target.value) })}
            disabled={memoryLoading}
          />
        </div>
        <div className="settings-memory-textarea-group">
          <span className="settings-memory-textarea-label">global memory guidance</span>
          <textarea
            className="settings-memory-textarea"
            rows={5}
            value={globalPolicy?.guidance ?? ""}
            placeholder="enter guidance for how memory should behave globally..."
            onChange={(event) => applyGlobalPatch({ guidance: event.target.value })}
            disabled={memoryLoading}
          />
        </div>
      </div>

      <div className="settings-memory-section">
        <p className="settings-memory-section-label">// workspace override</p>
        <p className="settings-memory-path">{directory ?? "no workspace selected"}</p>
        <div className="settings-memory-row">
          <span className="settings-memory-row-label">workspace mode</span>
          <select
            className="settings-memory-select"
            value={workspacePolicy?.mode ?? globalPolicy?.mode ?? "balanced"}
            onChange={(event) => applyWorkspacePatch({ mode: event.target.value as MemoryPolicyMode })}
            disabled={!directory || memoryLoading}
          >
            <option value="conservative">conservative</option>
            <option value="balanced">balanced</option>
            <option value="aggressive">aggressive</option>
            <option value="codebase-facts">codebase-facts</option>
          </select>
        </div>
        <label className="settings-inline-toggle">
          enable memory for workspace
          <input
            type="checkbox"
            checked={workspacePolicy?.enabled ?? globalPolicy?.enabled ?? false}
            onChange={(event) => applyWorkspacePatch({ enabled: event.target.checked })}
            disabled={!directory || memoryLoading}
          />
        </label>
        <div className="settings-memory-row">
          <span className="settings-memory-row-label">capture limit/session</span>
          <input
            type="number"
            className="settings-memory-number"
            min={1}
            max={60}
            value={workspacePolicy?.maxCapturePerSession ?? globalPolicy?.maxCapturePerSession ?? 24}
            onChange={(event) => applyWorkspacePatch({ maxCapturePerSession: Number(event.target.value) })}
            disabled={!directory || memoryLoading}
          />
        </div>
        <div className="settings-memory-textarea-group">
          <span className="settings-memory-textarea-label">workspace guidance</span>
          <textarea
            className="settings-memory-textarea"
            rows={4}
            value={workspacePolicy?.guidance ?? ""}
            placeholder="enter workspace-specific memory guidance..."
            onChange={(event) => applyWorkspacePatch({ guidance: event.target.value })}
            disabled={!directory || memoryLoading}
          />
        </div>
        <button
          type="button"
          className="settings-memory-ws-clear-btn"
          disabled={!directory || !hasWorkspaceOverride || memoryLoading}
          onClick={() => {
            if (!directory) {
              return;
            }
            setMemoryLoading(true);
            void onUpdateMemorySettings({ directory, clearWorkspaceOverride: true })
              .then((next) => {
                setMemorySettings(next);
                setFeedback("Workspace override cleared");
              })
              .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
              .finally(() => setMemoryLoading(false));
          }}
        >
          clear workspace override
        </button>
      </div>

      <div className="settings-memory-section">
        <p className="settings-memory-section-label">// template import</p>
        <div className="settings-memory-template-row">
          {memoryTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              className="settings-memory-tpl-btn"
              disabled={memoryLoading}
              onClick={() => {
                setMemoryLoading(true);
                void onApplyMemoryTemplate(template.id, directory, directory ? "workspace" : "global")
                  .then((next) => {
                    setMemorySettings(next);
                    setFeedback(`Applied ${template.name} template`);
                  })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                  .finally(() => setMemoryLoading(false));
              }}
            >
              {template.name}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-memory-section">
        <p className="settings-memory-section-label">// maintenance</p>
        <div className="settings-memory-maint-row">
          <button
            type="button"
            className="settings-memory-maint-btn"
            disabled={memoryLoading}
            onClick={() => {
              setMemoryLoading(true);
              void onBackfillMemory(directory)
                .then((status) => {
                  setMemoryBackfillStatus(status);
                  setFeedback(status.message ?? "Memory backfill completed");
                })
                .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                .finally(() => setMemoryLoading(false));
            }}
          >
            backfill now
          </button>
          <button
            type="button"
            className="settings-memory-maint-btn settings-memory-maint-btn--danger"
            disabled={!directory || memoryLoading}
            onClick={() => {
              if (!directory) {
                return;
              }
              if (!window.confirm(`Clear all stored memory for ${directory}?`)) {
                return;
              }
              setMemoryLoading(true);
              void onClearWorkspaceMemory(directory)
                .then(() => setFeedback("Workspace memory cleared"))
                .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
                .finally(() => setMemoryLoading(false));
            }}
          >
            clear workspace memory
          </button>
        </div>
        {memoryBackfillStatus ? (
          <p className="settings-memory-path" style={{ marginTop: "4px" }}>
            {memoryBackfillStatus.message ?? "Backfill"} ({Math.round(memoryBackfillStatus.progress * 100)}% •{" "}
            {memoryBackfillStatus.scannedSessions}/{memoryBackfillStatus.totalSessions})
          </p>
        ) : null}
      </div>
    </section>
  );
}
