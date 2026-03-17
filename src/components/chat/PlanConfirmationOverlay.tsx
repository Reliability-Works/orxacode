import { useCallback, useEffect, useRef, useState } from "react";

export interface PlanConfirmationOverlayProps {
  onAccept: () => void;
  onSubmitChanges: (changes: string) => void;
  onDismiss: () => void;
}

export function PlanConfirmationOverlay({
  onAccept,
  onSubmitChanges,
  onDismiss,
}: PlanConfirmationOverlayProps) {
  const [selectedOption, setSelectedOption] = useState<0 | 1>(0);
  const [showInput, setShowInput] = useState(false);
  const [changes, setChanges] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleSubmit = useCallback(() => {
    if (showInput) {
      if (changes.trim()) {
        onSubmitChanges(changes.trim());
      }
      return;
    }
    if (selectedOption === 0) {
      onAccept();
    } else {
      setShowInput(true);
    }
  }, [selectedOption, showInput, changes, onAccept, onSubmitChanges]);

  useEffect(() => {
    if (showInput) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [showInput]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      // Only intercept if focus is inside our overlay (or nothing specific is focused)
      if (!el.contains(document.activeElement) && document.activeElement !== document.body) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (showInput) {
          setShowInput(false);
          setChanges("");
        } else {
          onDismiss();
        }
        return;
      }

      if (showInput) {
        // In input mode, Enter submits (without shift)
        if (e.key === "Enter" && !e.shiftKey && changes.trim()) {
          e.preventDefault();
          onSubmitChanges(changes.trim());
        }
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedOption((prev) => (prev === 0 ? 1 : 0));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showInput, changes, handleSubmit, onDismiss, onSubmitChanges]);

  if (showInput) {
    return (
      <div ref={containerRef} className="plan-confirm-overlay">
        <div className="plan-confirm-header">Tell Codex what to do differently</div>
        <textarea
          ref={inputRef}
          className="plan-confirm-input"
          value={changes}
          onChange={(e) => setChanges(e.target.value)}
          placeholder="Describe what you want to change..."
          rows={3}
        />
        <div className="plan-confirm-footer">
          <button
            type="button"
            className="plan-confirm-dismiss"
            onClick={() => { setShowInput(false); setChanges(""); }}
          >
            Back <kbd>esc</kbd>
          </button>
          <button
            type="button"
            className="plan-confirm-submit"
            disabled={!changes.trim()}
            onClick={() => {
              if (changes.trim()) onSubmitChanges(changes.trim());
            }}
          >
            Submit <kbd>enter</kbd>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="plan-confirm-overlay">
      <div className="plan-confirm-header">Implement this plan?</div>
      <div className="plan-confirm-options" role="radiogroup" aria-label="Plan confirmation">
        <button
          type="button"
          role="radio"
          aria-checked={selectedOption === 0}
          className={`plan-confirm-option${selectedOption === 0 ? " selected" : ""}`}
          onClick={() => { setSelectedOption(0); onAccept(); }}
          onMouseEnter={() => setSelectedOption(0)}
        >
          <span className="plan-confirm-radio" />
          <span>Yes, implement this plan</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={selectedOption === 1}
          className={`plan-confirm-option${selectedOption === 1 ? " selected" : ""}`}
          onClick={() => { setSelectedOption(1); setShowInput(true); }}
          onMouseEnter={() => setSelectedOption(1)}
        >
          <span className="plan-confirm-radio" />
          <span>No, and tell Codex what to do differently</span>
        </button>
      </div>
      <div className="plan-confirm-footer">
        <button type="button" className="plan-confirm-dismiss" onClick={onDismiss}>
          Dismiss <kbd>esc</kbd>
        </button>
        <button type="button" className="plan-confirm-submit" onClick={handleSubmit}>
          Submit <kbd>enter</kbd>
        </button>
      </div>
    </div>
  );
}
