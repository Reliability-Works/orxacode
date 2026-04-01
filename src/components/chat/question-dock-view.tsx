import { type Dispatch, type RefObject, type SetStateAction } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { AgentQuestion, QuestionOption } from './QuestionDock'

type QuestionDockViewProps = {
  containerRef: RefObject<HTMLDivElement | null>
  questions: AgentQuestion[]
  total: number
  tab: number
  resolvedQuestionText: string
  isShowingCustomInput: boolean
  hasOptions: boolean
  resolvedOptions: QuestionOption[] | null
  isMulti: boolean
  customValue: string
  canContinue: boolean
  onReject: () => void
  onBack: () => void
  onNext: () => void
  onSubmit: () => void
  onSelectOption: (value: string) => void
  onSetTab: Dispatch<SetStateAction<number>>
  isSelected: (value: string) => boolean
  onCustomChange: (value: string) => void
  onShowCustomInput: () => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
}

export function QuestionDockView({
  containerRef,
  questions,
  total,
  tab,
  resolvedQuestionText,
  isShowingCustomInput,
  hasOptions,
  resolvedOptions,
  isMulti,
  customValue,
  canContinue,
  onReject,
  onBack,
  onNext,
  onSubmit,
  onSelectOption,
  onSetTab,
  isSelected,
  onCustomChange,
  onShowCustomInput,
  textareaRef,
}: QuestionDockViewProps) {
  const question = questions[tab]
  if (!question) return null

  return (
    <div ref={containerRef} className="question-dock">
      <div className="question-dock-asking-label">Asking questions</div>
      <div className="question-card">
        <QuestionDockHeader
          total={total}
          tab={tab}
          resolvedQuestionText={resolvedQuestionText}
          onBack={onBack}
          onNext={onNext}
        />
        <QuestionDockInput
          isShowingCustomInput={isShowingCustomInput}
          hasOptions={hasOptions}
          resolvedOptions={resolvedOptions}
          isMulti={isMulti}
          customValue={customValue}
          textareaRef={textareaRef}
          onCustomChange={onCustomChange}
          onSelectOption={onSelectOption}
          onShowCustomInput={onShowCustomInput}
          isSelected={isSelected}
        />
        <QuestionDockFooter
          canContinue={canContinue}
          onReject={onReject}
          onSubmit={onSubmit}
          isLast={tab >= total - 1}
        />
      </div>
      <QuestionDockLegacyDots questions={questions} tab={tab} onSetTab={onSetTab} />
    </div>
  )
}

function QuestionDockHeader({
  total,
  tab,
  resolvedQuestionText,
  onBack,
  onNext,
}: {
  total: number
  tab: number
  resolvedQuestionText: string
  onBack: () => void
  onNext: () => void
}) {
  return (
    <div className="question-card-header">
      <p className="question-card-text">{resolvedQuestionText}</p>
      {total > 1 ? (
        <div className="question-card-pagination">
          <button
            type="button"
            className="question-card-nav"
            onClick={onBack}
            disabled={tab === 0}
            aria-label="Previous question"
          >
            <ChevronLeft size={12} aria-hidden="true" />
          </button>
          <span className="question-card-counter">
            {tab + 1} of {total}
          </span>
          <button
            type="button"
            className="question-card-nav"
            onClick={onNext}
            disabled={tab >= total - 1}
            aria-label="Next question"
          >
            <ChevronRight size={12} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function QuestionDockInput({
  isShowingCustomInput,
  hasOptions,
  resolvedOptions,
  isMulti,
  customValue,
  textareaRef,
  onCustomChange,
  onSelectOption,
  onShowCustomInput,
  isSelected,
}: {
  isShowingCustomInput: boolean
  hasOptions: boolean
  resolvedOptions: QuestionOption[] | null
  isMulti: boolean
  customValue: string
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onCustomChange: (value: string) => void
  onSelectOption: (value: string) => void
  onShowCustomInput: () => void
  isSelected: (value: string) => boolean
}) {
  if (isShowingCustomInput) {
    return (
      <div className="question-custom-input-wrap">
        <textarea
          ref={textareaRef}
          className="question-custom-input"
          placeholder="Tell Codex what to do differently..."
          value={customValue}
          rows={2}
          onChange={e => onCustomChange(e.target.value)}
        />
      </div>
    )
  }

  if (hasOptions && resolvedOptions) {
    return (
      <div
        className="question-options-list"
        role={isMulti ? 'group' : 'radiogroup'}
        aria-label="Options"
      >
        {resolvedOptions.map((opt, idx) => {
          const selected = isSelected(opt.value)
          return (
            <button
              key={opt.value}
              type="button"
              role={isMulti ? 'checkbox' : 'radio'}
              aria-checked={selected}
              className={`question-option${selected ? ' question-option--selected' : ''}`}
              onClick={() => onSelectOption(opt.value)}
            >
              <span className="question-option-number">{idx + 1}.</span>
              <span className="question-option-label">{opt.label}</span>
              <span className="question-option-radio" aria-hidden="true" />
            </button>
          )
        })}
        <button
          type="button"
          className="question-option question-option--custom"
          onClick={onShowCustomInput}
        >
          <span className="question-option-number">{(resolvedOptions?.length ?? 0) + 1}.</span>
          <span className="question-option-label">No, and tell Codex what to do differently</span>
        </button>
      </div>
    )
  }

  return (
    <div className="question-dock-textarea-wrap">
      <textarea
        ref={textareaRef}
        className="question-textarea"
        placeholder="Type your answer..."
        value={customValue}
        rows={2}
        onChange={e => onCustomChange(e.target.value)}
      />
    </div>
  )
}

function QuestionDockFooter({
  canContinue,
  isLast,
  onReject,
  onSubmit,
}: {
  canContinue: boolean
  isLast: boolean
  onReject: () => void
  onSubmit: () => void
}) {
  return (
    <div className="question-card-footer">
      <button type="button" className="question-dismiss-btn" onClick={onReject}>
        Dismiss <kbd>esc</kbd>
      </button>
      <button
        type="button"
        className={`question-continue-btn${canContinue ? ' is-ready' : ''}`}
        onClick={onSubmit}
      >
        {isLast ? 'Continue' : 'Next'} <kbd>enter</kbd>
      </button>
    </div>
  )
}

function QuestionDockLegacyDots({
  questions,
  tab,
  onSetTab,
}: {
  questions: AgentQuestion[]
  tab: number
  onSetTab: Dispatch<SetStateAction<number>>
}) {
  if (questions.length <= 1) return null

  return (
    <div
      className="question-dots"
      role="tablist"
      aria-label="Question progress"
      style={{ display: 'none' }}
    >
      {questions.map((q, i) => (
        <button
          key={q.id}
          type="button"
          role="tab"
          aria-selected={i === tab}
          className={`question-dot${i === tab ? ' question-dot--active' : ''}`}
          onClick={() => onSetTab(i)}
          aria-label={`Question ${i + 1}`}
        />
      ))}
    </div>
  )
}
