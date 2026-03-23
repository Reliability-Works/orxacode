import { ThinkingShimmer } from "./ThinkingShimmer";

interface ThinkingRowProps {
  summary?: string;
  content?: string;
}

export function ThinkingRow({ summary = "", content = "" }: ThinkingRowProps) {
  const normalizedSummary = summary
    .replace(/^thinking(?:\.\.\.)?[:\s-]*/i, "")
    .replace(/^working(?:\.\.\.)?[:\s-]*/i, "")
    .trim();
  const summaryText = normalizedSummary || "...";
  const hasContent = content.trim().length > 0;

  if (!hasContent) {
    return (
      <div className="thinking-inline">
        <ThinkingShimmer label="Thinking" />
        {normalizedSummary ? <span className="thinking-summary">{summaryText}</span> : null}
      </div>
    );
  }

  return (
    <details className="message-exploration thinking-disclosure">
      <summary className="message-exploration-summary thinking-disclosure-summary">
        <ThinkingShimmer label="Thinking" />
      </summary>
      <div className="thinking-row-content">
        <pre className="thinking-row-text">{content}</pre>
      </div>
    </details>
  );
}
