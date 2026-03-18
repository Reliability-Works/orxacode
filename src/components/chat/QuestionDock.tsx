import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface QuestionOption {
  label: string;
  value: string;
}

export interface AgentQuestion {
  id: string;
  header?: string;
  text: string;
  options?: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionDockProps {
  questions: AgentQuestion[];
  onSubmit: (answers: Record<string, string | string[]>) => void;
  onReject: () => void;
}

// Parse a free-text message to extract numbered options like "1. Option text"
function parseNumberedOptions(text: string): { questionText: string; options: QuestionOption[] } | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const optionPattern = /^(\d+)\.\s+(.+)$/;

  const optionLines: Array<{ num: number; text: string }> = [];
  const questionLines: string[] = [];
  let seenFirstOption = false;

  for (const line of lines) {
    const match = optionPattern.exec(line);
    if (match) {
      seenFirstOption = true;
      optionLines.push({ num: parseInt(match[1], 10), text: match[2] });
    } else if (!seenFirstOption) {
      questionLines.push(line);
    }
  }

  if (optionLines.length < 2) return null;

  return {
    questionText: questionLines.join(" ").trim() || text,
    options: optionLines.map((o) => ({ label: o.text, value: String(o.num) })),
  };
}

export function QuestionDock({ questions, onSubmit, onReject }: QuestionDockProps) {
  const [tab, setTab] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [customText, setCustomText] = useState<Record<number, string>>({});
  const [showCustomInput, setShowCustomInput] = useState<Record<number, boolean>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const total = questions.length;
  const question = questions[tab];
  const isLast = tab >= total - 1;

  // Resolve options: use explicit options, or parse from text, or none (free-text)
  const resolvedOptions: QuestionOption[] | null = (() => {
    if (question?.options && question.options.length > 0) return question.options;
    if (question) {
      const parsed = parseNumberedOptions(question.text);
      if (parsed) return parsed.options;
    }
    return null;
  })();

  const resolvedQuestionText = (() => {
    if (!question) return "";
    if (question.options && question.options.length > 0) return question.text;
    const parsed = parseNumberedOptions(question.text);
    return parsed ? parsed.questionText : question.text;
  })();

  const isMulti = question?.multiSelect === true;
  const hasOptions = resolvedOptions !== null;
  const isShowingCustomInput = showCustomInput[tab] === true;

  const currentAnswer = question ? answers[question.id] : undefined;

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [customText, tab, isShowingCustomInput]);

  const setAnswer = (qid: string, value: string | string[]) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  };

  const selectOption = (optValue: string) => {
    if (!question) return;
    if (isMulti) {
      const prev = Array.isArray(currentAnswer) ? currentAnswer : [];
      if (prev.includes(optValue)) {
        setAnswer(question.id, prev.filter((v) => v !== optValue));
      } else {
        setAnswer(question.id, [...prev, optValue]);
      }
    } else {
      setAnswer(question.id, optValue);
      setShowCustomInput((prev) => ({ ...prev, [tab]: false }));
    }
  };

  const isSelected = (optValue: string): boolean => {
    if (!currentAnswer) return false;
    if (Array.isArray(currentAnswer)) return currentAnswer.includes(optValue);
    return currentAnswer === optValue;
  };

  const handleCustomChange = (value: string) => {
    setCustomText((prev) => ({ ...prev, [tab]: value }));
    if (question) {
      setAnswer(question.id, value);
    }
  };

  const handleNext = useCallback(() => {
    if (isLast) {
      onSubmit(answers);
    } else {
      setTab((t) => t + 1);
    }
  }, [isLast, answers, onSubmit]);

  const handleBack = () => {
    setTab((t) => Math.max(0, t - 1));
  };

  // Keyboard navigation
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      // Only intercept if focus is inside our container or body
      if (!el.contains(document.activeElement) && document.activeElement !== document.body) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (isShowingCustomInput) {
          setShowCustomInput((prev) => ({ ...prev, [tab]: false }));
          if (question) setAnswer(question.id, "");
          setCustomText((prev) => ({ ...prev, [tab]: "" }));
        } else {
          onReject();
        }
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        if (isShowingCustomInput) {
          const text = customText[tab] ?? "";
          if (text.trim()) {
            e.preventDefault();
            handleNext();
          }
          return;
        }
        e.preventDefault();
        handleNext();
        return;
      }

      // Arrow key navigation for options
      if (!isShowingCustomInput && hasOptions && resolvedOptions) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const values = resolvedOptions.map((o) => o.value);
          const currentIdx = values.indexOf(
            Array.isArray(currentAnswer) ? currentAnswer[0] : (currentAnswer ?? "")
          );
          let nextIdx: number;
          if (e.key === "ArrowDown") {
            nextIdx = currentIdx < values.length - 1 ? currentIdx + 1 : 0;
          } else {
            nextIdx = currentIdx > 0 ? currentIdx - 1 : values.length - 1;
          }
          if (question) selectOption(values[nextIdx]);
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, isShowingCustomInput, customText, hasOptions, resolvedOptions, currentAnswer, handleNext, onReject, question]);

  // Focus textarea when shown
  useEffect(() => {
    if (isShowingCustomInput) {
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [isShowingCustomInput]);

  if (!question) return null;

  const canContinue = (() => {
    if (isShowingCustomInput) return (customText[tab] ?? "").trim().length > 0;
    if (!currentAnswer) return false;
    if (Array.isArray(currentAnswer)) return currentAnswer.length > 0;
    return currentAnswer.trim().length > 0;
  })();

  return (
    <div ref={containerRef} className="question-dock">
      {/* "Asking questions" section label */}
      <div className="question-dock-asking-label">Asking questions</div>

      {/* Question card */}
      <div className="question-card">
        {/* Card header: question text + pagination */}
        <div className="question-card-header">
          <p className="question-card-text">{resolvedQuestionText}</p>
          {total > 1 ? (
            <div className="question-card-pagination">
              <button
                type="button"
                className="question-card-nav"
                onClick={handleBack}
                disabled={tab === 0}
                aria-label="Previous question"
              >
                <ChevronLeft size={12} aria-hidden="true" />
              </button>
              <span className="question-card-counter">{tab + 1} of {total}</span>
              <button
                type="button"
                className="question-card-nav"
                onClick={() => setTab((t) => Math.min(total - 1, t + 1))}
                disabled={tab >= total - 1}
                aria-label="Next question"
              >
                <ChevronRight size={12} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>

        {/* Options or free-text input */}
        {isShowingCustomInput ? (
          <div className="question-custom-input-wrap">
            <textarea
              ref={textareaRef}
              className="question-custom-input"
              placeholder="Tell Codex what to do differently..."
              value={customText[tab] ?? ""}
              rows={2}
              onChange={(e) => handleCustomChange(e.target.value)}
            />
          </div>
        ) : hasOptions && resolvedOptions ? (
          <div className="question-options-list" role={isMulti ? "group" : "radiogroup"} aria-label="Options">
            {resolvedOptions.map((opt, idx) => {
              const selected = isSelected(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  role={isMulti ? "checkbox" : "radio"}
                  aria-checked={selected}
                  className={`question-option${selected ? " question-option--selected" : ""}`}
                  onClick={() => selectOption(opt.value)}
                  onMouseEnter={() => !isMulti && selectOption(opt.value)}
                >
                  <span className="question-option-number">{idx + 1}.</span>
                  <span className="question-option-label">{opt.label}</span>
                  <span className="question-option-radio" aria-hidden="true" />
                </button>
              );
            })}
            {/* "Tell Codex what to do differently" as special last option */}
            <button
              type="button"
              className={`question-option question-option--custom${isShowingCustomInput ? " question-option--selected" : ""}`}
              onClick={() => setShowCustomInput((prev) => ({ ...prev, [tab]: true }))}
            >
              <span className="question-option-number">{(resolvedOptions?.length ?? 0) + 1}.</span>
              <span className="question-option-label">No, and tell Codex what to do differently</span>
            </button>
          </div>
        ) : (
          <div className="question-dock-textarea-wrap">
            <textarea
              ref={textareaRef}
              className="question-textarea"
              placeholder="Type your answer..."
              value={customText[tab] ?? ""}
              rows={2}
              onChange={(e) => handleCustomChange(e.target.value)}
            />
          </div>
        )}

        {/* Footer */}
        <div className="question-card-footer">
          <button
            type="button"
            className="question-dismiss-btn"
            onClick={onReject}
          >
            Dismiss <kbd>esc</kbd>
          </button>
          <button
            type="button"
            className={`question-continue-btn${canContinue ? " is-ready" : ""}`}
            onClick={handleNext}
          >
            {isLast ? "Continue" : "Next"} <kbd>enter</kbd>
          </button>
        </div>
      </div>

      {/* Legacy progress dots (for backward compat with tests) */}
      {total > 1 ? (
        <div className="question-dots" role="tablist" aria-label="Question progress" style={{ display: "none" }}>
          {questions.map((q, i) => (
            <button
              key={q.id}
              type="button"
              role="tab"
              aria-selected={i === tab}
              className={`question-dot${i === tab ? " question-dot--active" : ""}`}
              onClick={() => setTab(i)}
              aria-label={`Question ${i + 1}`}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
