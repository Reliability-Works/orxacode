import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { Archive, Bot, ChevronDown, ExternalLink } from "lucide-react";
import { DockSurface } from "./DockSurface";
import type { UnifiedBackgroundAgentSummary } from "../../lib/session-presentation";
import { agentColorForId } from "../../hooks/useCodexSession";

interface BackgroundAgentsPanelProps {
  agents: UnifiedBackgroundAgentSummary[];
  selectedAgentId?: string | null;
  onOpenAgent: (id: string) => void;
  onBack: () => void;
  onArchiveAgent?: (agent: UnifiedBackgroundAgentSummary) => void;
  detailBody?: ReactNode;
  detailTaskText?: string | null;
  detailLoading?: boolean;
  detailError?: string | null;
  taggingHint?: string | null;
}

export function BackgroundAgentsPanel({
  agents,
  selectedAgentId,
  onOpenAgent,
  onBack,
  onArchiveAgent,
  detailBody,
  detailTaskText = null,
  detailLoading = false,
  detailError = null,
  taggingHint = "(@ to tag agents)",
}: BackgroundAgentsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [taskExpanded, setTaskExpanded] = useState(false);
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  useEffect(() => {
    setPromptExpanded(false);
    setTaskExpanded(false);
  }, [selectedAgentId]);

  if (agents.length === 0) {
    return null;
  }

  return (
    <>
      <DockSurface
        title={`${agents.length} background agent${agents.length === 1 ? "" : "s"}`}
        icon={<Bot size={13} />}
        headerAction={(
          <button
            type="button"
            className="agent-dock-header-toggle"
            aria-label={expanded ? "Collapse background agents" : "Expand background agents"}
            aria-expanded={expanded}
            title={taggingHint ?? undefined}
            onClick={() => setExpanded((value) => !value)}
          >
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={`agent-dock-toggle-chevron ${expanded ? "is-open" : ""}`.trim()}
            />
          </button>
        )}
        className={`dock-surface--compact-width${expanded ? "" : " dock-surface--collapsed-inline"}`.trim()}
        bodyClassName="agent-dock-surface-body"
      >
        <div className="agent-dock">
          {expanded ? (
            <div className="agent-dock-list" role="list">
              {agents.map((agent) => (
                <div key={agent.id} className="agent-dock-row" role="listitem">
                  <div className="agent-dock-row-main">
                    <span className="agent-dock-row-name" style={{ color: agentColorForId(agent.id) }}>
                      {agent.name}
                    </span>
                    {agent.role ? <span className="agent-dock-row-role">({agent.role})</span> : null}
                    <span className={`agent-dock-status agent-dock-status--${agent.status}`.trim()}>
                      {agent.statusText}
                    </span>
                  </div>
                  <div className="agent-dock-row-actions">
                    {agent.sessionID ? (
                      <button
                        type="button"
                        className="agent-dock-action"
                        aria-label={`Open ${agent.name}`}
                        title={`Open ${agent.name}`}
                        onClick={() => onOpenAgent(agent.id)}
                      >
                        <ExternalLink size={13} aria-hidden="true" />
                      </button>
                    ) : (
                      <button type="button" className="agent-dock-action" disabled aria-disabled="true" aria-label={`${agent.name} pending`}>
                        <ExternalLink size={13} aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="agent-dock-action"
                      onClick={() => onArchiveAgent?.(agent)}
                      disabled={!onArchiveAgent || !agent.sessionID}
                      aria-disabled={!onArchiveAgent || !agent.sessionID}
                      aria-label={`Archive ${agent.name}`}
                      title={`Archive ${agent.name}`}
                    >
                      <Archive size={13} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </DockSurface>

      {selectedAgent ? (
        <div className="overlay" onClick={onBack}>
          <section
            className="modal agent-dock-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="background-agent-modal-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="modal-header">
              <h2 id="background-agent-modal-title">Background agent</h2>
              <div className="agent-dock-modal-actions">
                <button
                  type="button"
                  className="agent-dock-action"
                  onClick={() => onArchiveAgent?.(selectedAgent)}
                  disabled={!onArchiveAgent || !selectedAgent.sessionID}
                  aria-disabled={!onArchiveAgent || !selectedAgent.sessionID}
                  aria-label="Archive background agent"
                  title={`Archive ${selectedAgent.name}`}
                >
                  <Archive size={13} aria-hidden="true" />
                </button>
                <button type="button" className="modal-close-btn" aria-label="Close background agent" onClick={onBack}>
                  ×
                </button>
              </div>
            </header>

            <div className="agent-dock-detail agent-dock-modal-body">
              <div className="agent-dock-detail-header agent-dock-detail-header--summary">
                <div className="agent-dock-detail-heading">
                  <span className="agent-dock-detail-name" style={{ color: agentColorForId(selectedAgent.id) }}>
                    {selectedAgent.name}
                  </span>
                  {selectedAgent.role ? <span className="agent-dock-detail-role">({selectedAgent.role})</span> : null}
                  {selectedAgent.modelLabel ? <code className="agent-dock-detail-model">{selectedAgent.modelLabel}</code> : null}
                </div>
                <span className={`agent-dock-status agent-dock-status--${selectedAgent.status}`.trim()}>
                  {selectedAgent.statusText}
                </span>
              </div>

              {selectedAgent.prompt ? (
                <section className="agent-dock-collapsible">
                  <button
                    type="button"
                    className="agent-dock-collapsible-header"
                    aria-expanded={promptExpanded}
                    onClick={() => setPromptExpanded((value) => !value)}
                  >
                    <span className="agent-dock-collapsible-title">Prompt</span>
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className={`agent-dock-collapsible-chevron ${promptExpanded ? "is-open" : ""}`.trim()}
                    />
                  </button>
                  {promptExpanded ? (
                    <div className="agent-dock-collapsible-body">
                      <pre className="agent-dock-collapsible-text">{selectedAgent.prompt}</pre>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {detailTaskText ? (
                <section className="agent-dock-collapsible">
                  <button
                    type="button"
                    className="agent-dock-collapsible-header"
                    aria-expanded={taskExpanded}
                    onClick={() => setTaskExpanded((value) => !value)}
                  >
                    <span className="agent-dock-collapsible-title">Task</span>
                    <ChevronDown
                      size={14}
                      aria-hidden="true"
                      className={`agent-dock-collapsible-chevron ${taskExpanded ? "is-open" : ""}`.trim()}
                    />
                  </button>
                  {taskExpanded ? (
                    <div className="agent-dock-collapsible-body">
                      <pre className="agent-dock-collapsible-text">{detailTaskText}</pre>
                    </div>
                  ) : null}
                </section>
              ) : null}

              <div className="agent-dock-detail-body">
                {detailError ? <p className="agent-dock-detail-state agent-dock-detail-state--error">{detailError}</p> : null}
                {!detailError && detailLoading ? <p className="agent-dock-detail-state">Loading agent thread…</p> : null}
                {!detailError && !detailLoading && detailBody ? detailBody : null}
                {!detailError && !detailLoading && !detailBody ? (
                  <p className="agent-dock-detail-state">This background agent has not produced any visible output yet.</p>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
