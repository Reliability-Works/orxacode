import { useState } from "react";

export interface ContextToolItem {
  toolName: string;
  title: string;
  status: string;
  detail?: string;
}

interface ContextToolGroupProps {
  items: ContextToolItem[];
}

function toolIcon(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name === "read") return "file";
  if (name === "list" || name === "glob") return "folder";
  if (name === "grep" || name === "search" || name === "codesearch") return "search";
  if (name === "webfetch" || name === "websearch") return "globe";
  return "file";
}

function toolLabel(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name === "read") return "Read";
  if (name === "list") return "List";
  if (name === "glob") return "Glob";
  if (name === "grep") return "Grep";
  if (name === "search" || name === "codesearch") return "Search";
  if (name === "webfetch") return "Fetch";
  if (name === "websearch") return "Search";
  return toolName;
}

interface StatusDotProps {
  status: string;
}

function StatusDot({ status }: StatusDotProps) {
  return (
    <span
      className={`context-tool-status context-tool-status--${status}`}
      aria-label={status}
    />
  );
}

interface IconProps {
  type: string;
}

function ToolIcon({ type }: IconProps) {
  if (type === "search") {
    return (
      <svg
        className="context-tool-icon"
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    );
  }

  if (type === "folder") {
    return (
      <svg
        className="context-tool-icon"
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    );
  }

  if (type === "globe") {
    return (
      <svg
        className="context-tool-icon"
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    );
  }

  // Default: file
  return (
    <svg
      className="context-tool-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function ContextToolLine({ item }: { item: ContextToolItem }) {
  const icon = toolIcon(item.toolName);
  const label = toolLabel(item.toolName);

  return (
    <div className="context-tool-item">
      <ToolIcon type={icon} />
      <span className="context-tool-item-label">{label}</span>
      <span className="context-tool-item-title">{item.title}</span>
      {item.detail ? <span className="context-tool-item-detail">{item.detail}</span> : null}
      <StatusDot status={item.status} />
    </div>
  );
}

export function ContextToolGroup({ items }: ContextToolGroupProps) {
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;

  if (items.length === 1) {
    return (
      <div className="context-tool-group context-tool-group--single">
        <ContextToolLine item={items[0]} />
      </div>
    );
  }

  // Determine overall group status
  const allDone = items.every((i) => i.status === "completed");
  const anyError = items.some((i) => i.status === "error");
  const anyRunning = items.some((i) => i.status === "running");
  const groupStatus = anyError ? "error" : anyRunning ? "running" : allDone ? "completed" : "pending";

  const summary = `${items.length} files explored`;

  return (
    <div className="context-tool-group context-tool-group--multi">
      <button
        type="button"
        className="context-tool-group-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <StatusDot status={groupStatus} />
        <span className="context-tool-group-summary">{summary}</span>
        <span className="context-tool-group-chevron" aria-hidden="true">
          {expanded ? "▾" : "›"}
        </span>
      </button>

      {expanded ? (
        <div className="context-tool-group-body">
          {items.map((item, i) => (
            <ContextToolLine key={i} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
