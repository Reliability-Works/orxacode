import type { OpenCodeAgentFile, OpenDirectoryTarget } from "@shared/ipc";

export type OcAgentFilenameDialog =
  | { kind: "create"; title: string }
  | { kind: "duplicate"; title: string; content: string };

type OpenCodeAgentsSectionProps = {
  ocAgents: OpenCodeAgentFile[];
  selectedOcAgent: string | undefined;
  setSelectedOcAgent: (value: string | undefined) => void;
  ocAgentDraft: string;
  setOcAgentDraft: (value: string) => void;
  ocAgentSaving: boolean;
  setOcAgentSaving: (value: boolean) => void;
  ocOpenInMenu: boolean;
  setOcOpenInMenu: (value: boolean | ((prev: boolean) => boolean)) => void;
  setFeedback: (message: string) => void;
  loadOcAgents: () => Promise<void>;
  setOcFilenameDialog: (value: OcAgentFilenameDialog) => void;
  setOcFilenameValue: (value: string) => void;
  setOcFilenameError: (value: string | null) => void;
};

export function OpenCodeAgentsSection({
  ocAgents,
  selectedOcAgent,
  setSelectedOcAgent,
  ocAgentDraft,
  setOcAgentDraft,
  ocAgentSaving,
  setOcAgentSaving,
  ocOpenInMenu,
  setOcOpenInMenu,
  setFeedback,
  loadOcAgents,
  setOcFilenameDialog,
  setOcFilenameValue,
  setOcFilenameError,
}: OpenCodeAgentsSectionProps) {
  const currentOcAgent = ocAgents.find((a) => a.filename === selectedOcAgent);

  const saveOcAgent = async () => {
    if (!selectedOcAgent) {
      return;
    }
    setOcAgentSaving(true);
    try {
      await window.orxa.opencode.writeAgentFile(selectedOcAgent, ocAgentDraft);
      await loadOcAgents();
      setFeedback(`Saved ${selectedOcAgent}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    } finally {
      setOcAgentSaving(false);
    }
  };

  const deleteOcAgent = async () => {
    if (!selectedOcAgent || !window.confirm(`Delete agent file ${selectedOcAgent}?`)) {
      return;
    }
    try {
      await window.orxa.opencode.deleteAgentFile(selectedOcAgent);
      setSelectedOcAgent(undefined);
      setOcAgentDraft("");
      await loadOcAgents();
      setFeedback(`Deleted ${selectedOcAgent}`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const createOcAgent = async () => {
    const existing = new Set(ocAgents.map((a) => a.filename.toLowerCase()));
    let index = 1;
    let filenameStem = "new-agent";
    while (existing.has(`${filenameStem}.md`)) {
      index += 1;
      filenameStem = `new-agent-${index}`;
    }
    setOcFilenameDialog({ kind: "create", title: "Create new agent file" });
    setOcFilenameValue(filenameStem);
    setOcFilenameError(null);
  };

  const openOcAgentIn = async (target: OpenDirectoryTarget) => {
    if (!currentOcAgent) {
      return;
    }
    try {
      await window.orxa.opencode.openFileIn(currentOcAgent.path, target);
      setOcOpenInMenu(false);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : String(error));
    }
  };

  const duplicateOcAgent = async () => {
    if (!currentOcAgent) {
      return;
    }
    const existing = new Set(ocAgents.map((a) => a.filename.toLowerCase()));
    const baseName = currentOcAgent.filename.replace(/\.md$/i, "");
    let index = 1;
    let filenameStem = `${baseName}-copy`;
    while (existing.has(`${filenameStem}.md`)) {
      index += 1;
      filenameStem = `${baseName}-copy-${index}`;
    }
    const content = ocAgentDraft || currentOcAgent.content;
    setOcFilenameDialog({ kind: "duplicate", title: `Duplicate ${currentOcAgent.filename} as`, content });
    setOcFilenameValue(filenameStem);
    setOcFilenameError(null);
  };

  return (
    <section className="settings-section-card settings-pad oc-agents-section">
      <div className="oc-agents-toolbar">
        <select
          className="oc-agents-select"
          value={selectedOcAgent ?? ""}
          onChange={(e) => {
            const filename = e.target.value;
            if (!filename) {
              setSelectedOcAgent(undefined);
              setOcAgentDraft("");
              return;
            }
            const agent = ocAgents.find((a) => a.filename === filename);
            if (agent) {
              setSelectedOcAgent(filename);
              setOcAgentDraft(agent.content);
            }
          }}
        >
          <option value="">Select agent...</option>
          {ocAgents.map((agent) => (
            <option key={agent.filename} value={agent.filename}>
              {agent.name} ({agent.mode})
            </option>
          ))}
        </select>
        <button type="button" className="oc-agents-new-btn" onClick={() => void createOcAgent()}>+ create new agent</button>
        {currentOcAgent ? (
          <button type="button" className="oc-agents-new-btn" onClick={() => void duplicateOcAgent()}>duplicate</button>
        ) : null}
      </div>

      {selectedOcAgent ? (
        <div className="oc-agents-editor">
          <div className="oc-agents-meta">
            <span className="oc-agents-filename">{selectedOcAgent}</span>
            {currentOcAgent?.model ? <span className="oc-agents-model">{currentOcAgent.model}</span> : null}
          </div>
          <textarea
            className="oc-agents-textarea"
            value={ocAgentDraft}
            onChange={(event) => setOcAgentDraft(event.target.value)}
          />
          <div className="oc-agents-actions">
            <button type="button" className="oc-agents-action-btn oc-agents-action-btn--save" disabled={ocAgentSaving} onClick={() => void saveOcAgent()}>
              {ocAgentSaving ? "saving..." : "save"}
            </button>
            <button type="button" className="oc-agents-action-btn" onClick={() => void loadOcAgents()}>reload</button>
            <button type="button" className="oc-agents-action-btn oc-agents-action-btn--danger" onClick={() => void deleteOcAgent()}>delete</button>
            <div className="oc-agents-openin-wrap">
              <button
                type="button"
                className="oc-agents-action-btn"
                onClick={() => setOcOpenInMenu((v) => !v)}
                disabled={!currentOcAgent}
              >
                open in...
              </button>
              {ocOpenInMenu ? (
                <div className="oc-agents-openin-menu">
                  <button type="button" onClick={() => void openOcAgentIn("cursor")}>Cursor</button>
                  <button type="button" onClick={() => void openOcAgentIn("zed")}>Zed</button>
                  <button type="button" onClick={() => void openOcAgentIn("finder")}>Finder</button>
                  <button type="button" onClick={() => void openOcAgentIn("terminal")}>Terminal</button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <p className="oc-agents-empty">Select an agent to edit, or create a new one.</p>
      )}
    </section>
  );
}
