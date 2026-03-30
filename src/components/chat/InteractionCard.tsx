import { useState, useCallback, useEffect, useRef } from 'react'
import { flushSync } from 'react-dom'

export interface InteractionCardOption {
  id: string
  label: string
  /** When true, selecting this option reveals a textarea for custom input. */
  isCustomInput?: boolean
}

export interface InteractionCardProps {
  title: string
  options: InteractionCardOption[]
  onSubmit: (selectedOptionId: string, customText?: string) => void
  onDismiss: () => void
}

export function InteractionCard({ title, options, onSubmit, onDismiss }: InteractionCardProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [customText, setCustomText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const submitTimerRef = useRef<number | null>(null)

  const selectedOption = options.find(o => o.id === selectedId)
  const isCustomSelected = selectedOption?.isCustomInput === true
  const canSubmit =
    !isSubmitting && selectedId !== null && (!isCustomSelected || customText.trim().length > 0)

  const handleOptionSelect = useCallback(
    (optionId: string) => {
      if (selectedId === optionId && !isSubmitting) {
        return
      }
      flushSync(() => {
        setSelectedId(optionId)
        setIsSubmitting(false)
      })
    },
    [isSubmitting, selectedId]
  )

  const handleSubmit = useCallback(() => {
    if (!canSubmit || !selectedId) return
    const nextCustomText = isCustomSelected ? customText.trim() : undefined
    flushSync(() => {
      setIsSubmitting(true)
    })
    if (submitTimerRef.current !== null) {
      window.clearTimeout(submitTimerRef.current)
    }
    submitTimerRef.current = window.setTimeout(() => {
      submitTimerRef.current = null
      try {
        onSubmit(selectedId, nextCustomText)
      } catch {
        flushSync(() => {
          setIsSubmitting(false)
        })
      }
    }, 0)
  }, [canSubmit, customText, isCustomSelected, onSubmit, selectedId])

  // Focus textarea when custom option is selected
  useEffect(() => {
    if (isCustomSelected && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isCustomSelected])

  useEffect(
    () => () => {
      if (submitTimerRef.current !== null) {
        window.clearTimeout(submitTimerRef.current)
      }
    },
    []
  )

  useInteractionCardKeyboard({ canSubmit, handleOptionSelect, handleSubmit, onDismiss, options })

  const optionButtons = options.map((option, index) => (
    <InteractionOptionButton
      key={option.id}
      option={option}
      index={index}
      selected={selectedId === option.id}
      onSelect={handleOptionSelect}
    />
  ))

  return (
    <div className="interaction-card">
      <div className="interaction-card-header">
        <p className="interaction-card-title">{title}</p>
      </div>

      <div className="interaction-card-options">{optionButtons}</div>

      {isCustomSelected ? (
        <div className="interaction-card-textarea-wrap">
          <textarea
            ref={textareaRef}
            className="interaction-card-textarea"
            value={customText}
            onChange={e => setCustomText(e.target.value)}
            placeholder="Tell Codex what to do differently..."
            rows={3}
          />
        </div>
      ) : null}

      <InteractionCardFooter canSubmit={canSubmit} isSubmitting={isSubmitting} onDismiss={onDismiss} onSubmit={handleSubmit} />
    </div>
  )
}

function useInteractionCardKeyboard({
  canSubmit,
  handleOptionSelect,
  handleSubmit,
  onDismiss,
  options,
}: {
  canSubmit: boolean
  handleOptionSelect: (optionId: string) => void
  handleSubmit: () => void
  onDismiss: () => void
  options: InteractionCardOption[]
}) {
  // Keyboard handler: ESC to dismiss, Enter to submit, number keys to select
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onDismiss()
        return
      }

      // Enter to submit (but not inside textarea unless Cmd/Ctrl is held)
      if (e.key === 'Enter') {
        const inTextarea = (e.target as HTMLElement)?.tagName === 'TEXTAREA'
        if (inTextarea && !e.metaKey && !e.ctrlKey) return
        if (canSubmit) {
          e.preventDefault()
          handleSubmit()
        }
        return
      }

      // Number keys to select options (1-9)
      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= options.length) {
        e.preventDefault()
        handleOptionSelect(options[num - 1].id)
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [canSubmit, handleOptionSelect, handleSubmit, onDismiss, options])
}

function InteractionOptionButton({
  option,
  index,
  selected,
  onSelect,
}: {
  option: InteractionCardOption
  index: number
  selected: boolean
  onSelect: (optionId: string) => void
}) {
  return (
    <button
      type="button"
      className={`interaction-card-option${selected ? ' interaction-card-option--selected' : ''}${option.isCustomInput ? ' interaction-card-option--custom' : ''}`}
      onMouseDown={() => onSelect(option.id)}
      onClick={() => onSelect(option.id)}
    >
      <span className="interaction-card-option-number">{index + 1}.</span>
      <span className="interaction-card-option-label">{option.label}</span>
      <span className="interaction-card-option-radio" />
    </button>
  )
}

function InteractionCardFooter({
  canSubmit,
  isSubmitting,
  onDismiss,
  onSubmit,
}: {
  canSubmit: boolean
  isSubmitting: boolean
  onDismiss: () => void
  onSubmit: () => void
}) {
  return (
    <div className="interaction-card-footer">
      <button
        type="button"
        className="interaction-card-dismiss"
        disabled={isSubmitting}
        onClick={onDismiss}
      >
        Dismiss <kbd>ESC</kbd>
      </button>
      <button
        type="button"
        className={`interaction-card-submit${canSubmit ? ' is-ready' : ''}`}
        disabled={!canSubmit}
        onClick={onSubmit}
      >
        Submit <kbd>{'\u21B5'}</kbd>
      </button>
    </div>
  )
}
