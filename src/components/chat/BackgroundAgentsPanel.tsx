import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Bot, ChevronDown, ChevronLeft } from "lucide-react";
import { DockSurface } from "./DockSurface";
import type { UnifiedBackgroundAgentSummary } from "../../lib/session-presentation";
import { agentColorForId } from "../../hooks/useCodexSession";

interface BackgroundAgentsPanelProps {
  agents: UnifiedBackgroundAgentSummary[];
  selectedAgentId?: string | null;
  onOpenAgent: (id: string) => void;
  onBack: () => void;
  detailBody?: ReactNode;
  detailLoading?: boolean;
  detailError?: string | null;
}

export function BackgroundAgentsPanel({
  agents,
  selectedAgentId,
  onOpenAgent,
  onBack,
  detailBody,
  detailLoading = false,
  detailError = null,
}: BackgroundAgentsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );

  if (agents.length === 0) {
    return null;
  }

  if (selectedAgent) {
    return (
      <DockSurface
        title="Background agent"
        icon={<Bot size={13} />}
      >
        <div className="agent-dock-detail">
          <button type="button" className="agent-dock-back" onClick={onBack}>
            <ChevronLeft size={13} aria-hidden="true" />
            Back to parent thread
          </button>

          <div className="agent-dock-detail-card">
            <div className="agent-dock-detail-header">
              <div className="agent-dock-detail-heading">
                <span className="agent-dock-detail-name" style={{ color: agentColorForId(selectedAgent.id) }}>
                  {selectedAgent.name}
                </span>
                {selectedAgent.role ? <span className="agent-dock-detail-role">({selectedAgent.role})</span> : null}
              </div>
              <span className={`agent-dock-status agent-dock-status--${selectedAgent.status}`.trim()}>
                {selectedAgent.statusText}
              </span>
            </div>

            {selectedAgent.modelLabel ? (
              <div className="agent-dock-meta-row">
                <span className="agent-dock-meta-label">Model</span>
                <code>{selectedAgent.modelLabel}</code>
              </div>
            ) : null}

            {selectedAgent.command ? (
              <div className="agent-dock-meta-row">
                <span className="agent-dock-meta-label">Command</span>
                <code>{selectedAgent.command}</code>
              </div>
            ) : null}

            {selectedAgent.prompt ? (
              <div className="agent-dock-prompt">
                <span className="agent-dock-meta-label">Prompt</span>
                <pre>{selectedAgent.prompt}</pre>
              </div>
            ) : null}
          </div>

          <div className="agent-dock-detail-body">
            {detailError ? <p className="agent-dock-detail-state agent-dock-detail-state--error">{detailError}</p> : null}
            {!detailError && detailLoading ? <p className="agent-dock-detail-state">Loading agent thread…</p> : null}
            {!detailError && !detailLoading && detailBody ? detailBody : null}
            {!detailError && !detailLoading && !detailBody ? (
              <p className="agent-dock-detail-state">This background agent has not produced any visible output yet.</p>
            ) : null}
          </div>
        </div>
      </DockSurface>
    );
  }

  return (
    <DockSurface
      title={`${agents.length} background agent${agents.length === 1 ? "" : "s"}`}
      icon={<Bot size={13} />}
    >
      <div className="agent-dock">
        <button
          type="button"
          className="agent-dock-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
        >
          <span className="agent-dock-toggle-text">
            {agents.length} background agent{agents.length === 1 ? "" : "s"}
          </span>
          <span className="agent-dock-toggle-hint">(@ to tag agents)</span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`agent-dock-toggle-chevron ${expanded ? "is-open" : ""}`.trim()}
          />
        </button>

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
                <button type="button" className="agent-dock-open" onClick={() => onOpenAgent(agent.id)}>
                  Open
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </DockSurface>
  );
}
