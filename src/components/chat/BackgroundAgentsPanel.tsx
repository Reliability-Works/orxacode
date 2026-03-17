import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import type { SubagentInfo } from "../../hooks/useCodexSession";
import { agentColorForId } from "../../hooks/useCodexSession";

interface BackgroundAgentsPanelProps {
  agents: SubagentInfo[];
  onOpenAgent: (threadId: string) => void;
}

export function BackgroundAgentsPanel({ agents, onOpenAgent }: BackgroundAgentsPanelProps) {
  const [expanded, setExpanded] = useState(true);

  if (agents.length === 0) return null;

  return (
    <div className="bg-agents-panel">
      <button
        type="button"
        className="bg-agents-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="bg-agents-count">
          {agents.length} background agent{agents.length !== 1 ? "s" : ""}
        </span>
        <span className="bg-agents-hint">(@ to tag agents)</span>
      </button>

      {expanded ? (
        <div className="bg-agents-list">
          {agents.map((agent) => (
            <div key={agent.threadId} className="bg-agent-row">
              <span className="bg-agent-name" style={{ color: agentColorForId(agent.threadId) }}>
                {agent.nickname}
              </span>
              <span className="bg-agent-role">({agent.role})</span>
              <span className="bg-agent-status">{agent.statusText}</span>
              <button
                type="button"
                className="bg-agent-open"
                onClick={() => onOpenAgent(agent.threadId)}
                title={`Open ${agent.nickname}'s thread`}
              >
                Open
                <ExternalLink size={11} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
