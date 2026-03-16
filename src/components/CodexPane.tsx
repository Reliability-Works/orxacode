import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AlertTriangle, Check, Send, X, Zap } from "lucide-react";
import { useCodexSession } from "../hooks/useCodexSession";

interface Props {
  directory: string;
  onExit: () => void;
}

export function CodexPane({ directory, onExit }: Props) {
  const {
    connectionStatus,
    serverInfo,
    thread,
    messages,
    pendingApproval,
    isStreaming,
    lastError,
    connect,
    disconnect,
    startThread,
    sendMessage,
    approveAction,
    denyAction,
  } = useCodexSession(directory);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-connect on mount
  useEffect(() => {
    if (connectionStatus === "disconnected") {
      void connect();
    }
    return () => {
      void disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start thread when connected and no thread exists
  useEffect(() => {
    if (connectionStatus === "connected" && !thread) {
      void startThread({ title: "Orxa Code Session" });
    }
  }, [connectionStatus, thread, startThread]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages]);

  // Focus input when ready
  useEffect(() => {
    if (connectionStatus === "connected" && thread && inputRef.current) {
      inputRef.current.focus();
    }
  }, [connectionStatus, thread]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    void sendMessage(trimmed);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // -- Status bar label --
  const statusLabel =
    connectionStatus === "connected"
      ? serverInfo
        ? `connected to ${serverInfo.name} ${serverInfo.version}`
        : "connected"
      : connectionStatus === "connecting"
        ? "connecting..."
        : connectionStatus === "error"
          ? lastError ?? "error"
          : "disconnected";

  const statusDotClass = `codex-status-dot codex-status-dot--${connectionStatus}`;

  // -- Unavailable state --
  if (!window.orxa?.codex) {
    return (
      <div className="codex-pane">
        <div className="codex-toolbar">
          <Zap size={14} color="#f59e0b" />
          <span className="codex-toolbar-label">codex</span>
          <span className="codex-toolbar-path">{directory}</span>
          <button type="button" className="codex-toolbar-btn" onClick={onExit}>
            exit
          </button>
        </div>
        <div className="codex-unavailable">
          <Zap size={32} color="var(--text-muted)" />
          <span>Codex is not available. Make sure the codex CLI is installed.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="codex-pane">
      {/* Toolbar */}
      <div className="codex-toolbar">
        <Zap size={14} color="#f59e0b" />
        <span className="codex-toolbar-label">codex</span>
        <span className="codex-toolbar-path">{directory}</span>
        <span className="codex-status">
          <span className={statusDotClass} />
          <span className="codex-status-text">{statusLabel}</span>
        </span>
        <button type="button" className="codex-toolbar-btn" onClick={onExit} aria-label="exit">
          <X size={11} />
          exit
        </button>
      </div>

      {/* Messages */}
      <div className="codex-messages" role="log" aria-label="codex conversation">
        {messages.length === 0 && connectionStatus === "connected" && thread ? (
          <div className="codex-empty">
            <Zap size={24} color="var(--text-muted)" />
            <span>Send a prompt to start coding with Codex.</span>
          </div>
        ) : null}

        {messages.map((msg) => (
          <div key={msg.id} className={`codex-message codex-message--${msg.role}`}>
            <div className="codex-message-role">{msg.role === "user" ? "you" : "codex"}</div>
            <div className="codex-message-content">{msg.content || (isStreaming ? "\u2588" : "")}</div>
          </div>
        ))}

        {isStreaming && messages.length > 0 && messages[messages.length - 1].role === "assistant" && !messages[messages.length - 1].content ? (
          <div className="codex-streaming-indicator">thinking...</div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      {/* Approval modal */}
      {pendingApproval ? (
        <div className="codex-approval" role="alertdialog" aria-label="approval request">
          <div className="codex-approval-header">
            <AlertTriangle size={14} color="#f59e0b" />
            <span>Approval Required</span>
          </div>
          <div className="codex-approval-reason">{pendingApproval.reason}</div>
          {pendingApproval.command ? (
            <div className="codex-approval-command">
              <code>{pendingApproval.command.join(" ")}</code>
            </div>
          ) : null}
          {pendingApproval.changes?.map((change, i) => (
            <div key={change.path + i} className="codex-approval-change">
              {change.type} {change.path}
              {change.insertions != null ? ` +${change.insertions}` : ""}
              {change.deletions != null ? ` -${change.deletions}` : ""}
            </div>
          ))}
          <div className="codex-approval-actions">
            <button
              type="button"
              className="codex-approval-btn codex-approval-btn--accept"
              onClick={() => void approveAction("accept")}
            >
              <Check size={12} />
              approve
            </button>
            <button
              type="button"
              className="codex-approval-btn codex-approval-btn--deny"
              onClick={() => void denyAction()}
            >
              <X size={12} />
              deny
            </button>
          </div>
        </div>
      ) : null}

      {/* Composer */}
      <form className="codex-composer" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="codex-composer-input"
          placeholder={
            connectionStatus === "error"
              ? (lastError ?? "error connecting to Codex")
              : connectionStatus === "disconnected"
                ? "Codex disconnected. Click to reconnect."
                : connectionStatus === "connecting"
                  ? "Connecting to Codex..."
                  : !thread
                    ? "Starting thread..."
                    : "Send a message..."
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={connectionStatus !== "connected" || !thread}
          rows={1}
        />
        <button
          type="submit"
          className="codex-composer-send"
          disabled={!input.trim() || isStreaming || connectionStatus !== "connected" || !thread}
          aria-label="send"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
