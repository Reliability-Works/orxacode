import type { Part } from "@opencode-ai/sdk/v2/client";
import type { SessionMessageBundle } from "@shared/ipc";

type Props = {
  messages: SessionMessageBundle[];
  showAssistantPlaceholder?: boolean;
  assistantLabel?: string;
};

type InternalEvent = {
  id: string;
  summary: string;
  details?: string;
};

function getRoleLabel(role: string, assistantLabel: string) {
  if (role === "assistant") {
    return assistantLabel;
  }
  if (role === "user") {
    return "User";
  }
  return role;
}

function getVisibleParts(role: string, parts: Part[]) {
  if (role !== "user") {
    return parts.filter((part) => part.type === "text" || part.type === "file");
  }

  const firstUserText = parts.find((part) => {
    if (part.type !== "text") {
      return false;
    }
    const text = part.text.trim();
    if (text.length === 0 || text.startsWith("[SUPERMEMORY]")) {
      return false;
    }
    if ("ignored" in part && part.ignored) {
      return false;
    }
    if ("synthetic" in part && part.synthetic) {
      return false;
    }
    return true;
  });
  const fileParts = parts.filter((part) => part.type === "file");
  const filtered = [...(firstUserText ? [firstUserText] : []), ...fileParts];

  if (filtered.length > 0) {
    return filtered;
  }
  return [];
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function isLikelyTelemetryJson(value: string) {
  const parsed = parseJsonObject(value);
  if (!parsed) {
    return false;
  }
  const type = typeof parsed.type === "string" ? parsed.type : undefined;
  if (type === "step-start" || type === "step-finish") {
    return true;
  }
  return typeof parsed.sessionID === "string" && typeof parsed.messageID === "string";
}

function shouldHideAssistantText(value: string) {
  const text = value.trim();
  if (text.length === 0) {
    return true;
  }
  if (isLikelyTelemetryJson(text)) {
    return true;
  }
  if (text.includes("Prioritizing mandatory TODO creation")) {
    return true;
  }
  return false;
}

function summarizeAssistantInternalPart(part: Part): InternalEvent | null {
  if (part.type === "step-start") {
    return { id: part.id, summary: "Step started" };
  }
  if (part.type === "step-finish") {
    const tokens = part.tokens;
    const details = `reason: ${part.reason} | input: ${tokens.input} | output: ${tokens.output} | cache read: ${tokens.cache.read}`;
    return { id: part.id, summary: "Step finished", details };
  }
  if (part.type === "tool") {
    return { id: part.id, summary: `${part.tool} (${part.state.status})` };
  }
  if (part.type === "reasoning") {
    return { id: part.id, summary: "Reasoning update" };
  }
  if (part.type === "retry") {
    return { id: part.id, summary: `Retry attempt ${part.attempt}` };
  }
  if (part.type === "compaction") {
    return { id: part.id, summary: "Context compaction" };
  }
  if (part.type === "snapshot") {
    return { id: part.id, summary: "Snapshot update" };
  }
  if (part.type === "patch") {
    return { id: part.id, summary: "Patch update" };
  }
  if (part.type === "agent") {
    return { id: part.id, summary: `Agent: ${part.name}` };
  }
  if (part.type === "subtask") {
    return { id: part.id, summary: `Task: ${part.description}` };
  }
  if (part.type === "text") {
    const text = part.text.trim();
    if (shouldHideAssistantText(text)) {
      const parsed = parseJsonObject(text);
      const summary = typeof parsed?.type === "string" ? parsed.type : "Assistant internal event";
      return { id: part.id, summary };
    }
    return null;
  }
  if (part.type === "file") {
    return null;
  }
  return null;
}

function classifyAssistantParts(parts: Part[]) {
  const visible: Part[] = [];
  const internal: InternalEvent[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      if (shouldHideAssistantText(part.text)) {
        const event = summarizeAssistantInternalPart(part);
        if (event) {
          internal.push(event);
        }
        continue;
      }
      visible.push(part);
      continue;
    }

    if (part.type === "file") {
      visible.push(part);
      continue;
    }

    const event = summarizeAssistantInternalPart(part);
    if (event) {
      internal.push(event);
    }
  }

  return { visible, internal };
}

function renderPart(part: Part) {
  if (part.type === "text") {
    return <pre className="part-text">{part.text}</pre>;
  }

  if (part.type === "file") {
    return <div className="part-file">Attached file: {part.filename ?? part.url}</div>;
  }
  return null;
}

export function MessageFeed({ messages, showAssistantPlaceholder = false, assistantLabel = "Orxa" }: Props) {
  if (messages.length === 0) {
    return <div className="messages-empty">No messages yet. Start by sending a prompt.</div>;
  }

  const liveInternalEvents: InternalEvent[] = [];

  return (
    <div className="messages-scroll">
      {messages.map((bundle, messageIndex) => {
        const message = bundle.info;
        const role = message.role;
        const assistantClassification = role === "assistant" ? classifyAssistantParts(bundle.parts) : undefined;
        const visibleParts = assistantClassification?.visible ?? getVisibleParts(role, bundle.parts);
        const assistantInternalParts = assistantClassification?.internal ?? [];
        if (assistantInternalParts.length > 0) {
          liveInternalEvents.push(...assistantInternalParts);
        }
        if (visibleParts.length === 0) {
          return null;
        }
        return (
          <article key={`${message.id}:${message.time.created}:${messageIndex}`} className={`message-card message-${role}`}>
            <header className="message-header">
              <span className="message-role">{getRoleLabel(role, assistantLabel)}</span>
              <span className="message-time">{new Date(message.time.created).toLocaleTimeString()}</span>
            </header>
            <div className="message-parts">
              {visibleParts.map((part, partIndex) => (
                <section key={`${part.id}:${partIndex}`} className="message-part">
                  {renderPart(part)}
                </section>
              ))}
            </div>
          </article>
        );
      })}
      {showAssistantPlaceholder ? (
        <article className="message-card message-assistant">
          <header className="message-header">
            <span className="message-role">{assistantLabel}</span>
            <span className="message-time">{new Date().toLocaleTimeString()}</span>
          </header>
          <div className="message-parts">
            <section className="message-part">
              <pre className="part-text message-thinking">Thinking...</pre>
              {liveInternalEvents.length > 0 ? (
                <details className="thinking-events">
                  <summary>Live events ({liveInternalEvents.length})</summary>
                  <ul>
                    {liveInternalEvents.slice(-5).map((event) => (
                      <li key={event.id}>
                        <span>{event.summary}</span>
                        {event.details ? <small>{event.details}</small> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          </div>
        </article>
      ) : null}
    </div>
  );
}
