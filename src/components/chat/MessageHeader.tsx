interface MessageHeaderProps {
  role: "user" | "assistant";
  label?: string;
  timestamp?: number;
  agent?: string;
  model?: string;
  durationMs?: number;
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function MessageHeader({ role, label, timestamp, agent, model, durationMs }: MessageHeaderProps) {
  const displayLabel = label ?? (role === "assistant" ? "Assistant" : "User");

  const timeString = timestamp
    ? new Date(timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : null;

  const metaParts: string[] = [];
  if (agent) metaParts.push(agent);
  if (model) metaParts.push(model);
  if (typeof durationMs === "number") metaParts.push(formatDuration(durationMs));
  const meta = metaParts.join(" \u00B7 ");

  return (
    <header className={`message-header message-header--${role}`}>
      <span className="message-role">{displayLabel}</span>
      {timeString ? <span className="message-time">{timeString}</span> : null}
      {meta ? <span className="message-header-meta">{meta}</span> : null}
    </header>
  );
}
