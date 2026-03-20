import { useState } from "react";
import { renderMarkdownText } from "../../lib/markdown";

interface ReasoningPartProps {
  content: string;
  summary?: string;
  defaultExpanded?: boolean;
}

export function ReasoningPart({ content, summary, defaultExpanded = false }: ReasoningPartProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const label = summary ?? "Reasoning...";

  return (
    <div className="reasoning-part">
      <button
        type="button"
        className="reasoning-part-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="reasoning-part-chevron" aria-hidden="true">
          {expanded ? "▾" : "›"}
        </span>
        <span className="reasoning-part-label">{label}</span>
      </button>
      {expanded ? (
        <div
          className="reasoning-part-body"
          dangerouslySetInnerHTML={{ __html: renderMarkdownText(content) }}
        />
      ) : null}
    </div>
  );
}
