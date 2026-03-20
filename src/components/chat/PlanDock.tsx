import { useEffect, useRef, useState } from "react";
import { ClipboardList } from "lucide-react";
import { DockSurface } from "./DockSurface";

export interface PlanDockProps {
  onAccept: () => void;
  onSubmitChanges: (changes: string) => void;
  onDismiss: () => void;
}

export function PlanDock({ onAccept, onSubmitChanges, onDismiss }: PlanDockProps) {
  const [selectedOption, setSelectedOption] = useState<0 | 1>(0);
  const [showInput, setShowInput] = useState(false);
  const [changes, setChanges] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!showInput) {
      return;
    }
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [showInput]);

  return (
    <DockSurface
      title={showInput ? "Revise plan" : "Plan ready"}
      icon={<ClipboardList size={13} />}
      onClose={onDismiss}
    >
      <div className="plan-dock">
        {showInput ? (
          <>
            <p className="plan-dock-description">Tell the agent what to do differently.</p>
            <textarea
              ref={inputRef}
              className="plan-dock-input"
              value={changes}
              onChange={(event) => setChanges(event.target.value)}
              placeholder="Describe what should change..."
              rows={3}
            />
            <div className="plan-dock-actions">
              <button
                type="button"
                className="plan-dock-btn plan-dock-btn--secondary"
                onClick={() => {
                  setShowInput(false);
                  setChanges("");
                }}
              >
                Back
              </button>
              <button
                type="button"
                className="plan-dock-btn plan-dock-btn--primary"
                disabled={!changes.trim()}
                onClick={() => {
                  const trimmed = changes.trim();
                  if (!trimmed) {
                    return;
                  }
                  onSubmitChanges(trimmed);
                }}
              >
                Submit changes
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="plan-dock-description">Review the proposed plan before the agent continues.</p>
            <div className="plan-dock-options" role="radiogroup" aria-label="Plan review">
              <button
                type="button"
                role="radio"
                aria-checked={selectedOption === 0}
                className={`plan-dock-option ${selectedOption === 0 ? "is-selected" : ""}`.trim()}
                onClick={() => setSelectedOption(0)}
              >
                Yes, implement this plan
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={selectedOption === 1}
                className={`plan-dock-option ${selectedOption === 1 ? "is-selected" : ""}`.trim()}
                onClick={() => setSelectedOption(1)}
              >
                No, I want to change it
              </button>
            </div>
            <div className="plan-dock-actions">
              <button type="button" className="plan-dock-btn plan-dock-btn--secondary" onClick={onDismiss}>
                Dismiss
              </button>
              <button
                type="button"
                className="plan-dock-btn plan-dock-btn--primary"
                onClick={() => {
                  if (selectedOption === 0) {
                    onAccept();
                    return;
                  }
                  setShowInput(true);
                }}
              >
                Continue
              </button>
            </div>
          </>
        )}
      </div>
    </DockSurface>
  );
}
