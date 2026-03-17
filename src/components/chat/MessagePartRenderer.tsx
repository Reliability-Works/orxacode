import { TextPart } from "./TextPart";
import { ReasoningPart } from "./ReasoningPart";
import { ThinkingShimmer } from "./ThinkingShimmer";
import { ToolPart, type ToolChange } from "./ToolPart";

export type MessagePart =
  | { type: "text"; content: string }
  | {
      type: "tool";
      toolName: string;
      status: string;
      title?: string;
      input?: unknown;
      output?: string;
      error?: string;
      command?: string;
      exitCode?: number;
      changes?: ToolChange[];
    }
  | { type: "reasoning"; content: string; summary?: string }
  | { type: "compaction" }
  | { type: "file"; filename?: string; url?: string }
  | { type: "thinking" };

interface MessagePartRendererProps {
  part: MessagePart;
  role: "user" | "assistant";
  isLast?: boolean;
  showCopy?: boolean;
}

export function MessagePartRenderer({ part, role, showCopy }: MessagePartRendererProps) {
  if (part.type === "text") {
    return (
      <TextPart
        content={part.content}
        role={role}
        showCopy={showCopy}
      />
    );
  }

  if (part.type === "reasoning") {
    return (
      <ReasoningPart
        content={part.content}
        summary={part.summary}
      />
    );
  }

  if (part.type === "thinking") {
    return <ThinkingShimmer />;
  }

  if (part.type === "compaction") {
    return (
      <div className="compaction-divider" aria-label="Conversation compacted">
        <span className="compaction-divider-line" aria-hidden="true" />
        <span className="compaction-divider-label">Conversation compacted</span>
        <span className="compaction-divider-line" aria-hidden="true" />
      </div>
    );
  }

  if (part.type === "file") {
    const label = part.filename ?? part.url ?? "file";
    return (
      <div className="file-attachment">
        <span className="file-attachment-icon" aria-hidden="true">
          <svg
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
        </span>
        <span className="file-attachment-label">{label}</span>
      </div>
    );
  }

  if (part.type === "tool") {
    return (
      <ToolPart
        toolName={part.toolName}
        status={part.status}
        title={part.title}
        input={part.input}
        output={part.output}
        error={part.error}
        command={part.command}
        exitCode={part.exitCode}
        changes={part.changes}
      />
    );
  }

  return null;
}
