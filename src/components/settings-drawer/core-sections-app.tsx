import type { UpdatePreferences } from "@shared/ipc";
import type { AppPreferences } from "~/types/app";

type UpdateCheckStatus = {
  checkedAt: number;
  state: "started" | "skipped" | "error";
  message?: string;
};

type AppSettingsSectionProps = {
  appPreferences: AppPreferences;
  onAppPreferencesChange: (next: AppPreferences) => void;
  updatePreferences: UpdatePreferences;
  onSetUpdatePreferences: (input: Partial<UpdatePreferences>) => Promise<UpdatePreferences>;
  checkingForUpdates: boolean;
  setCheckingForUpdates: (value: boolean) => void;
  onCheckForUpdates: () => Promise<{ ok: boolean; status: "started" | "skipped" | "error"; message?: string }>;
  updateUpdateCheckStatus: (status: UpdateCheckStatus) => void;
  setFeedback: (message: string) => void;
  updateCheckStatus: UpdateCheckStatus | null;
  formatUpdateCheckStatus: (status: UpdateCheckStatus | null) => string;
  setUpdatePreferences: (input: UpdatePreferences) => void;
  appVersion: string;
};

export function AppSettingsSection({
  appPreferences,
  onAppPreferencesChange,
  updatePreferences,
  onSetUpdatePreferences,
  checkingForUpdates,
  setCheckingForUpdates,
  onCheckForUpdates,
  updateUpdateCheckStatus,
  setFeedback,
  updateCheckStatus,
  formatUpdateCheckStatus,
  setUpdatePreferences,
  appVersion,
}: AppSettingsSectionProps) {
  const applyUpdatePreferences = (patch: Partial<UpdatePreferences>) => {
    void onSetUpdatePreferences(patch)
      .then((next) => {
        setUpdatePreferences(next);
        setFeedback("Update preferences saved");
      })
      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)));
  };

  return (
    <section className="settings-section-card">
      <h3>app settings</h3>

      <div className="settings-toggle-group">
        <label className="settings-inline-toggle">
          auto-open terminal when creating PTY
          <input
            type="checkbox"
            checked={appPreferences.autoOpenTerminalOnCreate}
            onChange={(event) =>
              onAppPreferencesChange({ ...appPreferences, autoOpenTerminalOnCreate: event.target.checked })
            }
          />
        </label>
        <label className="settings-inline-toggle">
          confirm dangerous actions (reject buttons)
          <input
            type="checkbox"
            checked={appPreferences.confirmDangerousActions}
            onChange={(event) =>
              onAppPreferencesChange({ ...appPreferences, confirmDangerousActions: event.target.checked })
            }
          />
        </label>
        <label className="settings-inline-toggle">
          automatically check for updates
          <input
            type="checkbox"
            checked={updatePreferences.autoCheckEnabled}
            onChange={(event) => applyUpdatePreferences({ autoCheckEnabled: event.target.checked })}
          />
        </label>
        <label className="settings-inline-toggle">
          notify when agent is waiting for input
          <input
            type="checkbox"
            checked={appPreferences.notifyOnAwaitingInput}
            onChange={(e) => onAppPreferencesChange({ ...appPreferences, notifyOnAwaitingInput: e.target.checked })}
          />
        </label>
        <label className="settings-inline-toggle">
          notify when agent finishes a task
          <input
            type="checkbox"
            checked={appPreferences.notifyOnTaskComplete}
            onChange={(e) => onAppPreferencesChange({ ...appPreferences, notifyOnTaskComplete: e.target.checked })}
          />
        </label>
        <p className="settings-inline-note">
          Desktop notifications are experimental right now and are not recommended to be enabled by default.
        </p>
        <label className="settings-inline-toggle">
          enable collaboration modes (codex)
          <input
            type="checkbox"
            checked={appPreferences.collaborationModesEnabled}
            onChange={(e) => onAppPreferencesChange({ ...appPreferences, collaborationModesEnabled: e.target.checked })}
          />
        </label>
        <label className="settings-inline-toggle">
          notify on subagent system events
          <input
            type="checkbox"
            checked={appPreferences.subagentSystemNotificationsEnabled}
            onChange={(e) => onAppPreferencesChange({ ...appPreferences, subagentSystemNotificationsEnabled: e.target.checked })}
          />
        </label>
        <label className="settings-inline-toggle">
          stream assistant responses
          <input
            type="checkbox"
            checked={appPreferences.enableAssistantStreaming}
            onChange={(e) => onAppPreferencesChange({ ...appPreferences, enableAssistantStreaming: e.target.checked })}
          />
        </label>
        <p className="settings-inline-note">
          Show output token-by-token while agent is responding. When off, messages appear all at once when complete.
        </p>
      </div>

      <div className="settings-divider" />

      <div className="settings-update-row">
        <label className="settings-update-channel">
          release_channel
          <select
            value={updatePreferences.releaseChannel}
            onChange={(event) =>
              applyUpdatePreferences({ releaseChannel: event.target.value as UpdatePreferences["releaseChannel"] })
            }
          >
            <option value="stable">stable</option>
            <option value="prerelease">prerelease</option>
          </select>
        </label>
      </div>

      <div className="settings-divider" />

      <div className="settings-update-section">
        <button
          type="button"
          className="settings-update-check-btn"
          disabled={checkingForUpdates}
          onClick={() => {
            setCheckingForUpdates(true);
            void onCheckForUpdates()
              .then((result) => {
                updateUpdateCheckStatus({
                  checkedAt: Date.now(),
                  state: result.status,
                  message: result.message,
                });
                if (result.status === "started") {
                  setFeedback("Update check started");
                } else if (result.message) {
                  setFeedback(result.message);
                } else {
                  setFeedback("Update check skipped");
                }
              })
              .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                updateUpdateCheckStatus({
                  checkedAt: Date.now(),
                  state: "error",
                  message,
                });
                setFeedback(message);
              })
              .finally(() => setCheckingForUpdates(false));
          }}
        >
          {checkingForUpdates ? "checking..." : "check for updates now"}
        </button>
        <p className="settings-update-last-checked">{formatUpdateCheckStatus(updateCheckStatus)}</p>
      </div>

      <p className="settings-version-label">Version: v{appVersion}</p>
    </section>
  );
}
