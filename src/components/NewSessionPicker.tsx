import { useEffect, useRef } from "react";
import { Bot, LayoutGrid, Zap } from "lucide-react";
import type { SessionType } from "../types/canvas";

type NewSessionPickerProps = {
  isOpen: boolean;
  onPick: (type: SessionType) => void;
  onClose: () => void;
};

export function NewSessionPicker({ isOpen, onPick, onClose }: NewSessionPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div ref={containerRef} className="new-session-picker" role="menu" aria-label="New session type">
      <div className="new-session-picker-header">new session</div>
      <button
        type="button"
        className="new-session-picker-option"
        role="menuitem"
        onClick={() => onPick("canvas")}
      >
        <span className="new-session-picker-icon new-session-picker-icon--canvas" aria-hidden="true">
          <LayoutGrid size={14} />
        </span>
        <span className="new-session-picker-text">
          <span className="new-session-picker-title">canvas session</span>
          <span className="new-session-picker-subtitle">// free-form tiled workspace</span>
        </span>
      </button>
      <button
        type="button"
        className="new-session-picker-option"
        role="menuitem"
        onClick={() => onPick("claude")}
      >
        <span className="new-session-picker-icon new-session-picker-icon--claude" aria-hidden="true">
          <Bot size={14} />
        </span>
        <span className="new-session-picker-text">
          <span className="new-session-picker-title">claude session</span>
          <span className="new-session-picker-subtitle">// claude code cli terminal</span>
        </span>
      </button>
      <button
        type="button"
        className="new-session-picker-option"
        role="menuitem"
        onClick={() => onPick("codex")}
      >
        <span className="new-session-picker-icon new-session-picker-icon--codex" aria-hidden="true">
          <Zap size={14} />
        </span>
        <span className="new-session-picker-text">
          <span className="new-session-picker-title">codex session</span>
          <span className="new-session-picker-subtitle">// openai codex app server</span>
        </span>
      </button>
      <button
        type="button"
        className="new-session-picker-option"
        role="menuitem"
        onClick={() => onPick("standalone")}
      >
        <span className="new-session-picker-icon" aria-hidden="true">&gt;_</span>
        <span className="new-session-picker-text">
          <span className="new-session-picker-title">opencode session</span>
          <span className="new-session-picker-subtitle">// opencode ai chat session</span>
        </span>
      </button>
    </div>
  );
}
