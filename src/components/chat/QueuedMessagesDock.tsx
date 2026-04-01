import { Clock, CornerDownRight, Image, Send, X } from 'lucide-react'
import { DockSurface } from './DockSurface'
import type { Attachment } from '../../hooks/useComposerState'

export interface QueuedMessage {
  id: string
  text: string
  timestamp: number
  attachments?: Attachment[]
}

interface QueuedMessagesDockProps {
  messages: QueuedMessage[]
  sendingId?: string
  actionKind?: 'send' | 'steer'
  onPrimaryAction: (id: string) => void
  onEdit: (id: string) => void
  onRemove: (id: string) => void
}

const MAX_TEXT_LENGTH = 60

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts)
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

export function QueuedMessagesDock({
  messages,
  sendingId,
  actionKind = 'send',
  onPrimaryAction,
  onEdit,
  onRemove,
}: QueuedMessagesDockProps) {
  if (messages.length === 0) {
    return null
  }

  const count = messages.length
  const label = count === 1 ? '1 followup message queued' : `${count} followup messages queued`
  const actionLabel = actionKind === 'steer' ? 'Steer' : 'Send now'
  const actionBusyLabel = actionKind === 'steer' ? 'Steering' : 'Sending'
  const actionAriaLabel = actionKind === 'steer' ? 'Steer message' : 'Send now'

  return (
    <DockSurface
      title={label}
      icon={<Clock size={12} aria-hidden="true" />}
      className="dock-surface--compact-width"
    >
      <div className="queued-messages-dock">
        {messages.map(msg => {
          const isSending = sendingId === msg.id
          return (
            <div key={msg.id} className="queued-message-item">
              <span
                className="queued-message-text"
                title={msg.text.length > MAX_TEXT_LENGTH ? msg.text : undefined}
              >
                {msg.attachments && msg.attachments.length > 0 ? (
                  <span
                    className="queued-message-attachment-badge"
                    title={`${msg.attachments.length} image${msg.attachments.length > 1 ? 's' : ''} attached`}
                  >
                    <Image size={11} aria-hidden="true" />
                    {msg.attachments.length}
                  </span>
                ) : null}
                {truncate(msg.text, MAX_TEXT_LENGTH)}
              </span>
              <span className="queued-message-time">{formatTimestamp(msg.timestamp)}</span>
              <div className="queued-message-actions" role="group" aria-label="Message actions">
                <button
                  type="button"
                  className={`queued-message-action queued-message-action--${actionKind}`.trim()}
                  onClick={() => onPrimaryAction(msg.id)}
                  disabled={isSending || Boolean(sendingId)}
                  aria-label={actionAriaLabel}
                  title={actionAriaLabel}
                >
                  {actionKind === 'steer' ? (
                    <CornerDownRight size={11} aria-hidden="true" />
                  ) : (
                    <Send size={11} aria-hidden="true" />
                  )}
                  <span>{isSending ? actionBusyLabel : actionLabel}</span>
                </button>
                <button
                  type="button"
                  className="queued-message-action queued-message-action--edit"
                  onClick={() => onEdit(msg.id)}
                  disabled={Boolean(sendingId)}
                  aria-label="Edit message"
                  title="Edit message"
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="queued-message-action queued-message-action--remove"
                  onClick={() => onRemove(msg.id)}
                  disabled={isSending}
                  aria-label="Remove from queue"
                  title="Remove from queue"
                >
                  <X size={11} aria-hidden="true" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </DockSurface>
  )
}
