import { useEffect, useRef } from 'react'
import type { SessionType } from '../types/canvas'
import { OpenCodeLogo, OpenAILogo, AnthropicLogo, CanvasLogo } from './ProviderLogos'

type NewSessionPickerProps = {
  isOpen: boolean
  onPick: (type: SessionType) => void
  onBrowseClaudeSessions?: () => void
  onBrowseCodexSessions?: () => void
  onClose: () => void
}

const SESSION_OPTIONS = [
  {
    type: 'canvas' as const,
    title: 'canvas session',
    subtitle: '// free-form tiled workspace',
    iconClassName: 'new-session-picker-icon new-session-picker-icon--canvas',
    Icon: CanvasLogo,
  },
  {
    type: 'claude-chat' as const,
    title: 'claude chat session',
    subtitle: '// claude code chat',
    iconClassName: 'new-session-picker-icon new-session-picker-icon--claude',
    Icon: AnthropicLogo,
  },
  {
    type: 'claude' as const,
    title: 'claude terminal session',
    subtitle: '// claude code cli terminal',
    iconClassName: 'new-session-picker-icon new-session-picker-icon--claude',
    Icon: AnthropicLogo,
  },
  {
    type: 'codex' as const,
    title: 'codex session',
    subtitle: '// openai codex app server',
    iconClassName: 'new-session-picker-icon new-session-picker-icon--codex',
    Icon: OpenAILogo,
  },
  {
    type: 'opencode' as const,
    title: 'opencode session',
    subtitle: '// opencode ai chat session',
    iconClassName: 'new-session-picker-icon',
    Icon: OpenCodeLogo,
  },
]

function SessionOptionButton({
  onPick,
  option,
}: {
  onPick: (type: SessionType) => void
  option: (typeof SESSION_OPTIONS)[number]
}) {
  return (
    <button
      type="button"
      className="new-session-picker-option"
      role="menuitem"
      onClick={() => onPick(option.type)}
    >
      <span className={option.iconClassName} aria-hidden="true">
        <option.Icon size={14} />
      </span>
      <span className="new-session-picker-text">
        <span className="new-session-picker-title">{option.title}</span>
        <span className="new-session-picker-subtitle">{option.subtitle}</span>
      </span>
    </button>
  )
}

export function NewSessionPicker({
  isOpen,
  onPick,
  onBrowseClaudeSessions,
  onBrowseCodexSessions,
  onClose,
}: NewSessionPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('pointerdown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div ref={containerRef} className="new-session-picker" role="menu" aria-label="New session type">
      <div className="new-session-picker-header">new session</div>
      {SESSION_OPTIONS.map(option => (
        <SessionOptionButton key={option.type} onPick={onPick} option={option} />
      ))}
      {onBrowseClaudeSessions ? (
        <button
          type="button"
          className="new-session-picker-option new-session-picker-option--secondary"
          role="menuitem"
          onClick={onBrowseClaudeSessions}
        >
          <span className="new-session-picker-icon new-session-picker-icon--claude" aria-hidden="true">
            <AnthropicLogo size={14} />
          </span>
          <span className="new-session-picker-text">
            <span className="new-session-picker-title">browse claude sessions</span>
            <span className="new-session-picker-subtitle">// import or resume a past Claude chat</span>
          </span>
        </button>
      ) : null}
      {onBrowseCodexSessions ? (
        <button
          type="button"
          className="new-session-picker-option new-session-picker-option--secondary"
          role="menuitem"
          onClick={onBrowseCodexSessions}
        >
          <span className="new-session-picker-icon new-session-picker-icon--codex" aria-hidden="true">
            <OpenAILogo size={14} />
          </span>
          <span className="new-session-picker-text">
            <span className="new-session-picker-title">browse codex threads</span>
            <span className="new-session-picker-subtitle">// import or resume a past Codex thread</span>
          </span>
        </button>
      ) : null}
    </div>
  )
}
