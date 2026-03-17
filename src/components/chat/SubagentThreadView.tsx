import { ArrowLeft } from "lucide-react";
import type { SubagentInfo } from "../../hooks/useCodexSession";
import { agentColor } from "../../hooks/useCodexSession";
import type { CodexMessageItem } from "../../hooks/useCodexSession";

interface SubagentThreadViewProps {
  agent: SubagentInfo;
  agentIndex: number;
  messages: CodexMessageItem[];
  onBack: () => void;
  /** Render function for individual message items (reuses CodexMessageRenderer) */
  renderItem: (item: CodexMessageItem) => React.ReactNode;
}

export function SubagentThreadView({ agent, agentIndex, messages, onBack, renderItem }: SubagentThreadViewProps) {
  const color = agentColor(agentIndex);

  return (
    <div className="subagent-thread-view">
      <button
        type="button"
        className="subagent-back-btn"
        onClick={onBack}
      >
        <ArrowLeft size={14} />
        Parent thread
      </button>

      <div className="subagent-thread-header">
        <span className="subagent-thread-name" style={{ color }}>
          {agent.nickname}
        </span>
        <span className="subagent-thread-role">({agent.role})</span>
        <span className={`subagent-thread-status subagent-status-${agent.status}`}>
          {agent.statusText}
        </span>
      </div>

      <div className="subagent-thread-messages">
        {messages.length === 0 ? (
          <div className="subagent-thread-empty">
            <p>This agent's thread content will appear here as it works.</p>
            <p className="subagent-thread-empty-hint">
              Agent is currently: {agent.statusText}
            </p>
          </div>
        ) : (
          messages.map((item) => (
            <div key={item.id}>{renderItem(item)}</div>
          ))
        )}
      </div>
    </div>
  );
}
