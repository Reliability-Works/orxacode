import { useState, type ReactNode } from "react";
import { ToolTypeIcon } from "./tool-type-icon";

export type ToolCallStatus = "pending" | "running" | "completed" | "error";

interface ToolCallCardProps {
  title: string;
  expandedTitle?: string;
  subtitle?: string;
  status: ToolCallStatus;
  command?: string;
  output?: string;
  error?: string;
  defaultExpanded?: boolean;
  /** Override the auto-detected icon hint (e.g. "bash" forces Terminal icon). */
  iconHint?: string;
  children?: ReactNode;
}

export function ToolCallCard({
  title,
  subtitle,
  status,
  command,
  output,
  error,
  defaultExpanded = false,
  iconHint,
  children,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const hasBody = !!(children ?? command ?? output ?? error);

  return (
    <div
      className={`tool-call-card tool-call-card--${status} ${expanded ? "is-expanded" : "is-collapsed"}`.trim()}
      data-expanded={expanded ? "true" : "false"}
    >
      <button
        type="button"
        className="tool-call-card-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        disabled={!hasBody}
      >
        <ToolTypeIcon title={iconHint ?? title} className={`tool-call-card-icon tool-call-card-icon--${status}`} />
        <span className={`tool-call-card-status tool-call-card-status--${status}`} aria-label={status} />
        <span className="tool-call-card-title">{title}</span>
        {subtitle ? <span className="tool-call-card-subtitle">{subtitle}</span> : null}
        {hasBody ? (
          <span className="tool-call-card-chevron" aria-hidden="true">
            {expanded ? "▾" : "›"}
          </span>
        ) : null}
      </button>

      {expanded && hasBody ? (
        <div className="tool-call-card-body">
          {children ?? (
            <>
              {command ? (
                <div className="tool-call-card-command">
                  <span className="tool-call-card-command-prompt">$</span>
                  <span>{command}</span>
                </div>
              ) : null}
              {output ? <pre className="tool-call-card-output">{output}</pre> : null}
              {error ? <pre className="tool-call-card-error">{error}</pre> : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
