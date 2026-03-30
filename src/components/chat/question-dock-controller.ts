import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { AgentQuestion, QuestionOption } from './QuestionDock'

type ControllerInput = {
  questions: AgentQuestion[]
  onSubmit: (answers: Record<string, string | string[]>) => void
  onReject: () => void
}

type ControllerOutput = {
  questions: AgentQuestion[]
  question: AgentQuestion | undefined
  total: number
  tab: number
  resolvedQuestionText: string
  hasOptions: boolean
  resolvedOptions: QuestionOption[] | null
  isMulti: boolean
  isShowingCustomInput: boolean
  customValue: string
  canContinue: boolean
  containerRef: RefObject<HTMLDivElement | null>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  onBack: () => void
  onNext: () => void
  onSetTab: Dispatch<SetStateAction<number>>
  onSelectOption: (value: string) => void
  onCustomChange: (value: string) => void
  onShowCustomInput: () => void
  onDismissCustomInput: () => void
  onSubmit: () => void
  onReject: () => void
  isSelected: (value: string) => boolean
}

function useQuestionDockTextareaAutosize(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  customText: Record<number, string>,
  tab: number,
  isShowingCustomInput: boolean
) {
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = '0px'
    ta.style.height = `${ta.scrollHeight}px`
  }, [customText, tab, isShowingCustomInput, textareaRef])
}

function useQuestionDockCustomInputFocus(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  isShowingCustomInput: boolean
) {
  useEffect(() => {
    if (isShowingCustomInput) {
      setTimeout(() => textareaRef.current?.focus(), 0)
    }
  }, [isShowingCustomInput, textareaRef])
}

function parseNumberedOptions(
  text: string
): { questionText: string; options: QuestionOption[] } | null {
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean)
  const optionPattern = /^(\d+)\.\s+(.+)$/
  const optionLines: Array<{ num: number; text: string }> = []
  const questionLines: string[] = []
  let seenFirstOption = false
  for (const line of lines) {
    const match = optionPattern.exec(line)
    if (match) {
      seenFirstOption = true
      optionLines.push({ num: Number(match[1]), text: match[2] })
      continue
    }
    if (!seenFirstOption) {
      questionLines.push(line)
    }
  }
  if (optionLines.length < 2) return null
  return {
    questionText: questionLines.join(' ').trim() || text,
    options: optionLines.map(option => ({ label: option.text, value: String(option.num) })),
  }
}

function resolveQuestionContent(question: AgentQuestion | undefined) {
  if (!question) {
    return { questionText: '', options: null as QuestionOption[] | null }
  }
  if (question.options && question.options.length > 0) {
    return { questionText: question.text, options: question.options }
  }
  const parsed = parseNumberedOptions(question.text)
  return {
    questionText: parsed ? parsed.questionText : question.text,
    options: parsed ? parsed.options : null,
  }
}

function canContinueWithAnswer(
  isShowingCustomInput: boolean,
  customValue: string,
  currentAnswer: string | string[] | undefined
) {
  if (isShowingCustomInput) return customValue.trim().length > 0
  if (!currentAnswer) return false
  if (Array.isArray(currentAnswer)) return currentAnswer.length > 0
  return currentAnswer.trim().length > 0
}

export function useQuestionDockController({
  questions,
  onSubmit,
  onReject,
}: ControllerInput): ControllerOutput {
  const [tab, setTab] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [customText, setCustomText] = useState<Record<number, string>>({})
  const [showCustomInput, setShowCustomInput] = useState<Record<number, boolean>>({})
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const total = questions.length
  const question = questions[tab]
  const { questionText: resolvedQuestionText, options: resolvedOptions } = resolveQuestionContent(
    question
  )
  const isMulti = question?.multiSelect === true
  const isShowingCustomInput = showCustomInput[tab] === true
  const currentAnswer = question ? answers[question.id] : undefined
  const customValue = customText[tab] ?? ''
  const canContinue = canContinueWithAnswer(isShowingCustomInput, customValue, currentAnswer)

  useQuestionDockTextareaAutosize(textareaRef, customText, tab, isShowingCustomInput)
  useQuestionDockCustomInputFocus(textareaRef, isShowingCustomInput)

  const setAnswer = useCallback((qid: string, value: string | string[]) => {
    setAnswers(prev => ({ ...prev, [qid]: value }))
  }, [])

  const selectOption = useCallback(
    (optValue: string) => {
      if (!question) return
      if (isMulti) {
        const prev = Array.isArray(currentAnswer) ? currentAnswer : []
        setAnswer(
          question.id,
          prev.includes(optValue) ? prev.filter(value => value !== optValue) : [...prev, optValue]
        )
      } else {
        setAnswer(question.id, optValue)
        setShowCustomInput(prev => ({ ...prev, [tab]: false }))
      }
    },
    [currentAnswer, isMulti, question, setAnswer, tab]
  )

  const isSelected = useCallback(
    (optValue: string) => {
      if (!currentAnswer) return false
      return Array.isArray(currentAnswer) ? currentAnswer.includes(optValue) : currentAnswer === optValue
    },
    [currentAnswer]
  )

  const handleCustomChange = useCallback(
    (value: string) => {
      setCustomText(prev => ({ ...prev, [tab]: value }))
      if (question) {
        setAnswer(question.id, value)
      }
    },
    [question, setAnswer, tab]
  )

  const handleNext = useCallback(() => {
    if (tab >= total - 1) {
      onSubmit(answers)
    } else {
      setTab(current => current + 1)
    }
  }, [answers, onSubmit, tab, total])

  const handleBack = useCallback(() => {
    setTab(current => Math.max(0, current - 1))
  }, [])

  const dismissCustomInput = useCallback(() => {
    setShowCustomInput(prev => ({ ...prev, [tab]: false }))
    if (question) setAnswer(question.id, '')
    setCustomText(prev => ({ ...prev, [tab]: '' }))
  }, [question, setAnswer, tab])

  return {
    questions,
    question,
    total,
    tab,
    resolvedQuestionText,
    hasOptions: Boolean(resolvedOptions && resolvedOptions.length > 0),
    resolvedOptions,
    isMulti,
    isShowingCustomInput,
    customValue,
    canContinue,
    containerRef,
    textareaRef,
    onBack: handleBack,
    onNext: () => setTab(current => Math.min(total - 1, current + 1)),
    onSetTab: setTab,
    onSelectOption: selectOption,
    onCustomChange: handleCustomChange,
    onShowCustomInput: () => setShowCustomInput(prev => ({ ...prev, [tab]: true })),
    onDismissCustomInput: dismissCustomInput,
    onSubmit: handleNext,
    onReject,
    isSelected,
  }
}
