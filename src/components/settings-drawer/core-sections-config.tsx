import type { RawConfigDocument } from "@shared/ipc";

type ConfigSectionProps = {
  effectiveScope: "project" | "global";
  directory: string | undefined;
  setScope: (scope: "project" | "global") => void;
  openEditor: () => void;
  rawDoc: RawConfigDocument | null;
  rawText: string;
  setRawText: (value: string) => void;
  onWriteRaw: (scope: "project" | "global", content: string, directory?: string) => Promise<RawConfigDocument>;
  setRawDoc: (doc: RawConfigDocument) => void;
  setFeedback: (message: string) => void;
  onReadRaw: (scope: "project" | "global", directory?: string) => Promise<RawConfigDocument>;
};

export function ConfigSection({
  effectiveScope,
  directory,
  setScope,
  openEditor,
  rawDoc,
  rawText,
  setRawText,
  onWriteRaw,
  setRawDoc,
  setFeedback,
  onReadRaw,
}: ConfigSectionProps) {
  return (
    <section className="settings-section-card settings-pad settings-config">
      <div className="settings-config-top-row">
        <div className="settings-config-segment">
          <button
            type="button"
            className={`settings-config-segment-btn${effectiveScope === "project" ? " active" : ""}`}
            disabled={!directory}
            onClick={() => setScope("project")}
          >
            workspace
          </button>
          <button
            type="button"
            className={`settings-config-segment-btn${effectiveScope === "global" ? " active" : ""}`}
            onClick={() => setScope("global")}
          >
            global
          </button>
        </div>
        <span className="settings-config-spacer" />
        <button type="button" className="settings-config-top-btn" onClick={openEditor}>
          open opencode json editor
        </button>
      </div>

      <div className="settings-config-grid settings-config-grid--single">
        <article className="settings-config-card">
          <h4>opencode json</h4>
          <p className="raw-path">{rawDoc?.path}</p>
          <textarea value={rawText} onChange={(event) => setRawText(event.target.value)} />
          <div className="settings-actions">
            <button
              type="button"
              className="settings-config-card-save"
              onClick={() =>
                void onWriteRaw(effectiveScope, rawText, directory)
                  .then((next) => {
                    setRawDoc(next);
                    setFeedback("OpenCode config saved");
                  })
                  .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
              }
            >
              save
            </button>
            <button
              type="button"
              onClick={() =>
                void onReadRaw(effectiveScope, directory).then((next) => {
                  setRawDoc(next);
                  setRawText(next.content);
                })
              }
            >
              reload
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
