import { useState } from "react";
import { ChatFileIcon, ChatFolderIcon, ChatGlobeIcon, ChatSearchIcon } from "./chat-icons";

export interface ContextToolItem {
  toolName: string;
  title: string;
  status: string;
  detail?: string;
}

interface ContextToolGroupProps {
  items: ContextToolItem[];
}

function toolIcon(toolName: string): IconProps["type"] {
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
  type: "search" | "folder" | "globe" | "file";
}

function ToolIcon({ type }: IconProps) {
  if (type === "search") {
    return <ChatSearchIcon className="context-tool-icon" />;
  }

  if (type === "folder") {
    return <ChatFolderIcon className="context-tool-icon" />;
  }

  if (type === "globe") {
    return <ChatGlobeIcon className="context-tool-icon" />;
  }

  // Default: file
  return <ChatFileIcon className="context-tool-icon" />;
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
