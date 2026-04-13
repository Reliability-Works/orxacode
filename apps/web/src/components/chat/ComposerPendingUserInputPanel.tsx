import { type ApprovalRequestId } from '@orxa-code/contracts'
import { memo, useCallback, useEffect, useRef } from 'react'
import { type PendingUserInput } from '../../session-logic'
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from '../../pendingUserInput'
import { CheckIcon } from 'lucide-react'
import { cn } from '~/lib/utils'

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[]
  respondingRequestIds: ApprovalRequestId[]
  answers: Record<string, PendingUserInputDraftAnswer>
  questionIndex: number
  onSelectOption: (questionId: string, optionLabel: string) => void
  onAdvance: () => void
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  respondingRequestIds,
  answers,
  questionIndex,
  onSelectOption,
  onAdvance,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null
  const activePrompt = pendingUserInputs[0]
  if (!activePrompt) return null

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onSelectOption={onSelectOption}
      onAdvance={onAdvance}
    />
  )
})

function PendingUserInputCardHeader(props: {
  questionCount: number
  questionIndex: number
  header: string
  question: string
}) {
  const { questionCount, questionIndex, header, question } = props
  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {questionCount > 1 ? (
            <span className="flex h-5 items-center rounded-md bg-muted/60 px-1.5 text-mini font-medium tabular-nums text-muted-foreground/60">
              {questionIndex + 1}/{questionCount}
            </span>
          ) : null}
          <span className="text-caption font-semibold tracking-widest text-muted-foreground/50 uppercase">
            {header}
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-sm text-foreground/90">{question}</p>
    </>
  )
}

function PendingUserInputOptionButton(props: {
  questionId: string
  optionLabel: string
  optionDescription: string
  shortcutKey: number | null
  isSelected: boolean
  isResponding: boolean
  onSelect: (questionId: string, optionLabel: string) => void
}) {
  const {
    questionId,
    optionLabel,
    optionDescription,
    shortcutKey,
    isSelected,
    isResponding,
    onSelect,
  } = props
  return (
    <button
      type="button"
      disabled={isResponding}
      onClick={() => onSelect(questionId, optionLabel)}
      className={cn(
        'group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all duration-150',
        isSelected
          ? 'border-blue-500/40 bg-blue-500/8 text-foreground'
          : 'border-transparent bg-muted/20 text-foreground/80 hover:bg-muted/40 hover:border-border/40',
        isResponding && 'opacity-50 cursor-not-allowed'
      )}
    >
      {shortcutKey !== null ? (
        <kbd
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded text-caption font-medium tabular-nums transition-colors duration-150',
            isSelected
              ? 'bg-blue-500/20 text-blue-400'
              : 'bg-muted/40 text-muted-foreground/50 group-hover:bg-muted/60 group-hover:text-muted-foreground/70'
          )}
        >
          {shortcutKey}
        </kbd>
      ) : null}
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium">{optionLabel}</span>
        {optionDescription && optionDescription !== optionLabel ? (
          <span className="ml-2 text-xs text-muted-foreground/50">{optionDescription}</span>
        ) : null}
      </div>
      {isSelected ? <CheckIcon className="size-3.5 shrink-0 text-blue-400" /> : null}
    </button>
  )
}

function usePendingUserInputNumberShortcuts(props: {
  activeQuestion: PendingUserInput['questions'][number] | undefined
  isResponding: boolean
  customAnswerLength: number
  onSelect: (questionId: string, optionLabel: string) => void
}) {
  const { activeQuestion, isResponding, customAnswerLength, onSelect } = props
  useEffect(() => {
    if (!activeQuestion || isResponding) return
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return
      }
      if (target instanceof HTMLElement && target.isContentEditable && customAnswerLength > 0) {
        return
      }
      const digit = Number.parseInt(event.key, 10)
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return
      const option = activeQuestion.options[digit - 1]
      if (!option) return
      event.preventDefault()
      onSelect(activeQuestion.id, option.label)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [activeQuestion, isResponding, customAnswerLength, onSelect])
}

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  isResponding,
  answers,
  questionIndex,
  onSelectOption,
  onAdvance,
}: {
  prompt: PendingUserInput
  isResponding: boolean
  answers: Record<string, PendingUserInputDraftAnswer>
  questionIndex: number
  onSelectOption: (questionId: string, optionLabel: string) => void
  onAdvance: () => void
}) {
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex)
  const activeQuestion = progress.activeQuestion
  const autoAdvanceTimerRef = useRef<number | null>(null)

  // Clear auto-advance timer on unmount
  useEffect(() => {
    return () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current)
      }
    }
  }, [])

  const selectOptionAndAutoAdvance = useCallback(
    (questionId: string, optionLabel: string) => {
      onSelectOption(questionId, optionLabel)
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current)
      }
      autoAdvanceTimerRef.current = window.setTimeout(() => {
        autoAdvanceTimerRef.current = null
        onAdvance()
      }, 200)
    },
    [onSelectOption, onAdvance]
  )

  usePendingUserInputNumberShortcuts({
    activeQuestion: activeQuestion ?? undefined,
    isResponding,
    customAnswerLength: progress.customAnswer.length,
    onSelect: selectOptionAndAutoAdvance,
  })

  if (!activeQuestion) {
    return null
  }

  return (
    <div className="px-4 py-3 sm:px-5">
      <PendingUserInputCardHeader
        questionCount={prompt.questions.length}
        questionIndex={questionIndex}
        header={activeQuestion.header}
        question={activeQuestion.question}
      />
      <div className="mt-3 space-y-1">
        {activeQuestion.options.map((option, index) => {
          return (
            <PendingUserInputOptionButton
              key={`${activeQuestion.id}:${option.label}`}
              questionId={activeQuestion.id}
              optionLabel={option.label}
              optionDescription={option.description}
              shortcutKey={index < 9 ? index + 1 : null}
              isSelected={progress.selectedOptionLabel === option.label}
              isResponding={isResponding}
              onSelect={selectOptionAndAutoAdvance}
            />
          )
        })}
      </div>
    </div>
  )
})
