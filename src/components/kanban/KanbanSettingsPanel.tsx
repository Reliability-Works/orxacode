import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, WandSparkles } from "lucide-react";
import type { KanbanSettings } from "@shared/ipc";
import { providerLabel } from "./kanban-utils";
import { KanbanTaskProviderConfigFields } from "./KanbanTaskProviderConfigFields";

type Props = {
  workspaceDir: string;
};

export function KanbanSettingsPanel({ workspaceDir }: Props) {
  const [settings, setSettings] = useState<KanbanSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [presetProvider, setPresetProvider] = useState<KanbanSettings["defaultProvider"]>("opencode");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await window.orxa.kanban.getSettings(workspaceDir);
      setSettings(next);
    } catch { /* ignore */ }
    setLoading(false);
  }, [workspaceDir]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (settings) {
      setPresetProvider(settings.defaultProvider);
    }
  }, [settings]);

  const update = useCallback(async (patch: Partial<KanbanSettings>) => {
    if (!settings) return;
    try {
      const next = await window.orxa.kanban.updateSettings({ workspaceDir, ...patch });
      setSettings(next);
    } catch { /* ignore */ }
  }, [workspaceDir, settings]);

  if (loading || !settings) {
    return <div className="kanban-empty-state" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>Loading settings…</div>;
  }

  return (
    <section className="kanban-settings">
      <div className="kanban-settings-section">
        <h3>General</h3>
        <label className="kanban-toggle-row">
          <span>Auto commit on completion</span>
          <button type="button" role="switch" aria-checked={settings.autoCommit} className={`kanban-switch${settings.autoCommit ? " on" : ""}`} onClick={() => void update({ autoCommit: !settings.autoCommit })}>
            <span className="kanban-switch-thumb" />
          </button>
        </label>
        <label className="kanban-toggle-row">
          <span>Auto open PR on completion</span>
          <button type="button" role="switch" aria-checked={settings.autoPr} className={`kanban-switch${settings.autoPr ? " on" : ""}`} onClick={() => void update({ autoPr: !settings.autoPr })}>
            <span className="kanban-switch-thumb" />
          </button>
        </label>
        <div className="kanban-field">
          <span>Default provider</span>
          <div className="kanban-segmented-control">
            {(["opencode", "codex", "claude"] as const).map((p) => (
              <button key={p} type="button" className={settings.defaultProvider === p ? "active" : ""} onClick={() => void update({ defaultProvider: p })}>
                {providerLabel(p)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="kanban-settings-section">
        <div className="kanban-settings-section-header">
          <h3>Task provider defaults</h3>
        </div>
        <p className="kanban-settings-help">
          New tasks inherit these provider-specific defaults. You can still override them per task.
        </p>
        <div className="kanban-field">
          <span>Preset provider</span>
          <div className="kanban-segmented-control">
            {(["opencode", "codex", "claude"] as const).map((provider) => (
              <button
                key={provider}
                type="button"
                className={presetProvider === provider ? "active" : ""}
                onClick={() => setPresetProvider(provider)}
              >
                {providerLabel(provider)}
              </button>
            ))}
          </div>
        </div>
        <KanbanTaskProviderConfigFields
          workspaceDir={workspaceDir}
          provider={presetProvider}
          providerConfig={settings.providerDefaults}
          onChange={(providerDefaults) => void update({ providerDefaults: providerDefaults ?? {} })}
        />
      </div>

      <div className="kanban-settings-section">
        <div className="kanban-settings-section-header">
          <h3>Script shortcuts</h3>
          <button type="button" className="kanban-icon-btn" title="Add shortcut" onClick={() => {
            const id = `sc_${Date.now()}`;
            void update({ scriptShortcuts: [...settings.scriptShortcuts, { id, name: "", command: "" }] });
          }}>
            <Plus size={14} />
          </button>
        </div>
        {settings.scriptShortcuts.map((shortcut, index) => (
          <div key={shortcut.id} className="kanban-settings-shortcut-row">
            <input
              value={shortcut.name}
              placeholder="Name"
              onChange={(e) => {
                const next = [...settings.scriptShortcuts];
                next[index] = { ...shortcut, name: e.target.value };
                void update({ scriptShortcuts: next });
              }}
            />
            <input
              value={shortcut.command}
              placeholder="Command"
              onChange={(e) => {
                const next = [...settings.scriptShortcuts];
                next[index] = { ...shortcut, command: e.target.value };
                void update({ scriptShortcuts: next });
              }}
            />
            <button type="button" className="kanban-icon-btn" title="Remove" onClick={() => {
              void update({ scriptShortcuts: settings.scriptShortcuts.filter((s) => s.id !== shortcut.id) });
            }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {settings.scriptShortcuts.length === 0 ? <div className="kanban-empty-state">No shortcuts configured</div> : null}
      </div>

      <div className="kanban-settings-section">
        <div className="kanban-settings-section-header">
          <h3>.worktreeinclude</h3>
          <button type="button" className="kanban-filter-toggle" onClick={() => void window.orxa.kanban.createWorktreeIncludeFromGitignore(workspaceDir).then(setSettings)}>
            <WandSparkles size={12} /> Generate from `.gitignore`
          </button>
        </div>
        <div className="kanban-task-detail-runtime-grid">
          <span>Detected</span><span>{settings.worktreeInclude.detected ? "Yes" : "No"}</span>
          <span>Source</span><span>{settings.worktreeInclude.source}</span>
          <span>File</span><span className="kanban-detail-mono">{settings.worktreeInclude.filePath || `${workspaceDir}/.worktreeinclude`}</span>
        </div>
        <div className="kanban-settings-path-list">
          {settings.worktreeInclude.entries.map((entry, index) => (
            <div key={index} className="kanban-settings-shortcut-row">
              <input
                value={entry}
                placeholder="node_modules"
                onChange={(e) => {
                  const next = [...settings.worktreeInclude.entries];
                  next[index] = e.target.value;
                  void update({ worktreeInclude: { ...settings.worktreeInclude, entries: next } });
                }}
              />
              <button type="button" className="kanban-icon-btn" title="Remove" onClick={() => {
                void update({ worktreeInclude: { ...settings.worktreeInclude, entries: settings.worktreeInclude.entries.filter((_, i) => i !== index) } });
              }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button type="button" className="kanban-filter-toggle" onClick={() => {
            void update({ worktreeInclude: { ...settings.worktreeInclude, entries: [...settings.worktreeInclude.entries, ""] } });
          }}>
            <Plus size={12} /> Add include
          </button>
          {settings.worktreeInclude.entries.length === 0 ? <div className="kanban-empty-state">No `.worktreeinclude` entries configured</div> : null}
        </div>
      </div>
    </section>
  );
}
