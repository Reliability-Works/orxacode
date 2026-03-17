import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { DockSurface } from "./DockSurface";

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

export function QuestionDock({ questions, onSubmit, onReject }: QuestionDockProps) {
  const [tab, setTab] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [customText, setCustomText] = useState<Record<number, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const total = questions.length;
  const question = questions[tab];
  const isMulti = question?.multiSelect === true;
  const hasOptions = (question?.options?.length ?? 0) > 0;
  const isLast = tab >= total - 1;

  const currentAnswer = question ? answers[question.id] : undefined;

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [customText, tab]);

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

  const handleNext = () => {
    if (isLast) {
      handleSubmit();
    } else {
      setTab((t) => t + 1);
    }
  };

  const handleBack = () => {
    setTab((t) => Math.max(0, t - 1));
  };

  const handleSubmit = () => {
    onSubmit(answers);
  };

  const allAnswered = questions.every((q) => {
    const ans = answers[q.id];
    if (!ans) return false;
    if (Array.isArray(ans)) return ans.length > 0;
    return ans.trim().length > 0;
  });

  if (!question) return null;

  const selectedCount = Array.isArray(currentAnswer) ? currentAnswer.length : 0;

  const footer = (
    <div className="question-dock-footer">
      <button
        type="button"
        className="question-dock-reject"
        onClick={onReject}
      >
        Reject
      </button>
      <div className="question-dock-footer-actions">
        {tab > 0 ? (
          <button
            type="button"
            className="question-dock-back"
            onClick={handleBack}
          >
            <ChevronLeft size={13} aria-hidden="true" />
            Back
          </button>
        ) : null}
        <button
          type="button"
          className={`question-dock-submit ${allAnswered && isLast ? "is-ready" : ""}`.trim()}
          onClick={handleNext}
          disabled={false}
        >
          {isLast ? "Submit" : (
            <>
              Next
              <ChevronRight size={13} aria-hidden="true" />
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <DockSurface footer={footer}>
      <div className="question-dock">
        {question.header ? (
          <div className="question-dock-header-text">{question.header}</div>
        ) : null}

        <div className="question-dock-top">
          {total > 1 ? (
            <div className="question-dots" role="tablist" aria-label="Question progress">
              {questions.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  role="tab"
                  aria-selected={i === tab}
                  className={`question-dot ${i === tab ? "question-dot--active" : ""}`.trim()}
                  onClick={() => setTab(i)}
                  aria-label={`Question ${i + 1}`}
                />
              ))}
            </div>
          ) : null}

          {total > 1 ? (
            <span className="question-dock-progress">
              {tab + 1} / {total}
            </span>
          ) : null}
        </div>

        <p className="question-dock-text">{question.text}</p>

        {hasOptions ? (
          <div className="question-dock-options" role={isMulti ? "group" : "radiogroup"}>
            {isMulti && selectedCount > 0 ? (
              <span className="question-dock-selected-count">{selectedCount} selected</span>
            ) : null}
            {question.options!.map((opt) => {
              const selected = isSelected(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  role={isMulti ? "checkbox" : "radio"}
                  aria-checked={selected}
                  className={`question-option ${selected ? "question-option--selected" : ""}`.trim()}
                  onClick={() => selectOption(opt.value)}
                >
                  {selected ? (
                    <Check size={11} aria-hidden="true" className="question-option-check" />
                  ) : null}
                  <span>{opt.label}</span>
                </button>
              );
            })}
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
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleNext();
                }
              }}
            />
          </div>
        )}
      </div>
    </DockSurface>
  );
}
