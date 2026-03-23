import { useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { ClaudeChatEffort } from "@shared/ipc";
import {
  getClaudeReasoningEffortOptions,
  getDefaultClaudeReasoningEffort,
  supportsClaudeFastMode,
  supportsClaudeThinkingToggle,
} from "../lib/claude-models";

const EFFORT_LABELS: Record<ClaudeChatEffort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
  ultrathink: "Ultrathink",
};

type ClaudeTraitsPickerProps = {
  model: string | undefined;
  effort?: ClaudeChatEffort;
  thinking?: boolean;
  fastMode?: boolean;
  onEffortChange: (value: ClaudeChatEffort | undefined) => void;
  onThinkingChange: (value: boolean) => void;
  onFastModeChange: (value: boolean) => void;
};

export function ClaudeTraitsPicker({
  model,
  effort,
  thinking,
  fastMode = false,
  onEffortChange,
  onThinkingChange,
  onFastModeChange,
}: ClaudeTraitsPickerProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const effortOptions = useMemo(() => getClaudeReasoningEffortOptions(model), [model]);
  const supportsThinking = supportsClaudeThinkingToggle(model);
  const supportsFast = supportsClaudeFastMode(model);

  const triggerLabel = useMemo(() => {
    const parts: string[] = [];
    if (effortOptions.length > 0) {
      parts.push(EFFORT_LABELS[effort ?? getDefaultClaudeReasoningEffort()]);
    } else if (supportsThinking) {
      parts.push(`Thinking ${thinking === false ? "Off" : "On"}`);
    }
    if (supportsFast && fastMode) {
      parts.push("Fast");
    }
    return parts.length > 0 ? parts.join(" · ") : "Claude";
  }, [effort, effortOptions.length, fastMode, supportsFast, supportsThinking, thinking]);

  if (effortOptions.length === 0 && !supportsThinking && !supportsFast) {
    return null;
  }

  return (
    <div ref={menuRef} className={`composer-model-dropdown-wrap ${open ? "open" : ""}`.trim()}>
      <button
        type="button"
        className="composer-select composer-model-btn"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Claude traits"
      >
        <span className="composer-model-btn-label">{triggerLabel}</span>
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {open ? (
        <div className="composer-model-dropdown-menu" role="menu" aria-label="Claude traits">
          {effortOptions.length > 0 ? (
            <>
              <small>Effort</small>
              <div className="composer-model-dropdown-list">
                {effortOptions.map((option) => {
                  const active = (effort ?? getDefaultClaudeReasoningEffort()) === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        onEffortChange(option);
                        setOpen(false);
                      }}
                    >
                      <span className="composer-model-dropdown-item-main">
                        <span>{EFFORT_LABELS[option]}</span>
                      </span>
                      {active ? <Check size={13} aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
          {supportsThinking ? (
            <>
              <small>Thinking</small>
              <div className="composer-model-dropdown-list">
                {[
                  { value: true, label: "On" },
                  { value: false, label: "Off" },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    role="menuitemradio"
                    aria-checked={(thinking ?? true) === option.value}
                    onClick={() => {
                      onThinkingChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span className="composer-model-dropdown-item-main">
                      <span>{option.label}</span>
                    </span>
                    {(thinking ?? true) === option.value ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {supportsFast ? (
            <>
              <small>Fast Mode</small>
              <div className="composer-model-dropdown-list">
                {[
                  { value: false, label: "Off" },
                  { value: true, label: "On" },
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    role="menuitemradio"
                    aria-checked={fastMode === option.value}
                    onClick={() => {
                      onFastModeChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span className="composer-model-dropdown-item-main">
                      <span>{option.label}</span>
                    </span>
                    {fastMode === option.value ? <Check size={13} aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
