import { useState, useCallback, useEffect, useRef } from "react";

export interface InteractionCardOption {
  id: string;
  label: string;
  /** When true, selecting this option reveals a textarea for custom input. */
  isCustomInput?: boolean;
}

export interface InteractionCardProps {
  title: string;
  options: InteractionCardOption[];
  onSubmit: (selectedOptionId: string, customText?: string) => void;
  onDismiss: () => void;
}

export function InteractionCard({ title, options, onSubmit, onDismiss }: InteractionCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedOption = options.find((o) => o.id === selectedId);
  const isCustomSelected = selectedOption?.isCustomInput === true;
  const canSubmit = selectedId !== null && (!isCustomSelected || customText.trim().length > 0);

  const handleSubmit = useCallback(() => {
    if (!canSubmit || !selectedId) return;
    onSubmit(selectedId, isCustomSelected ? customText.trim() : undefined);
  }, [canSubmit, customText, isCustomSelected, onSubmit, selectedId]);

  // Focus textarea when custom option is selected
  useEffect(() => {
    if (isCustomSelected && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isCustomSelected]);

  // Keyboard handler: ESC to dismiss, Enter to submit, number keys to select
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDismiss();
        return;
      }

      // Enter to submit (but not inside textarea unless Cmd/Ctrl is held)
      if (e.key === "Enter") {
        const inTextarea = (e.target as HTMLElement)?.tagName === "TEXTAREA";
        if (inTextarea && !e.metaKey && !e.ctrlKey) return;
        if (canSubmit) {
          e.preventDefault();
          handleSubmit();
        }
        return;
      }

      // Number keys to select options (1-9)
      const num = parseInt(e.key, 10);
      if (num >= 1 && num <= options.length) {
        e.preventDefault();
        setSelectedId(options[num - 1].id);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [canSubmit, handleSubmit, onDismiss, options]);

  return (
    <div className="interaction-card">
      <div className="interaction-card-header">
        <p className="interaction-card-title">{title}</p>
      </div>

      <div className="interaction-card-options">
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            className={`interaction-card-option${selectedId === option.id ? " interaction-card-option--selected" : ""}${option.isCustomInput ? " interaction-card-option--custom" : ""}`}
            onClick={() => setSelectedId(option.id)}
          >
            <span className="interaction-card-option-number">{index + 1}.</span>
            <span className="interaction-card-option-label">{option.label}</span>
            <span className="interaction-card-option-radio" />
          </button>
        ))}
      </div>

      {isCustomSelected ? (
        <div className="interaction-card-textarea-wrap">
          <textarea
            ref={textareaRef}
            className="interaction-card-textarea"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            placeholder="Tell Codex what to do differently..."
            rows={3}
          />
        </div>
      ) : null}

      <div className="interaction-card-footer">
        <button
          type="button"
          className="interaction-card-dismiss"
          onClick={onDismiss}
        >
          Dismiss <kbd>ESC</kbd>
        </button>
        <button
          type="button"
          className={`interaction-card-submit${canSubmit ? " is-ready" : ""}`}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          Submit <kbd>{"\u21B5"}</kbd>
        </button>
      </div>
    </div>
  );
}
