import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { Attachment } from '../hooks/useComposerState'
import { IconButton } from './IconButton'
import { isImageAttachment } from './composer-panel-utils'
import { useComposerInputInteractions } from './composer/useComposerInputInteractions'
import type { ComposerPanelProps } from './ComposerPanel.impl'

type ComposerInputSectionProps = Pick<
  ComposerPanelProps,
  | 'placeholder'
  | 'composer'
  | 'setComposer'
  | 'composerAttachments'
  | 'removeAttachment'
  | 'slashMenuOpen'
  | 'filteredSlashCommands'
  | 'slashSelectedIndex'
  | 'insertSlashCommand'
  | 'handleSlashKeyDown'
  | 'addComposerAttachments'
  | 'sendPrompt'
  | 'abortActiveSession'
  | 'isSessionBusy'
  | 'isSendingPrompt'
  | 'pickImageAttachment'
  | 'hasActiveSession'
  | 'guardrailState'
  | 'compactionProgress'
  | 'compactionHint'
  | 'compactionCompacted'
  | 'onQueueMessage'
>

function handleComposerTextareaKeyDown(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  props: Pick<
    ComposerInputSectionProps,
    | 'slashMenuOpen'
    | 'handleSlashKeyDown'
    | 'filteredSlashCommands'
    | 'slashSelectedIndex'
    | 'insertSlashCommand'
    | 'isSessionBusy'
    | 'composer'
    | 'composerAttachments'
    | 'onQueueMessage'
    | 'isSendingPrompt'
    | 'sendPrompt'
  >
) {
  const {
    slashMenuOpen,
    handleSlashKeyDown,
    filteredSlashCommands,
    slashSelectedIndex,
    insertSlashCommand,
    isSessionBusy,
    composer,
    composerAttachments,
    onQueueMessage,
    isSendingPrompt,
    sendPrompt,
  } = props
  if (
    slashMenuOpen &&
    (event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Tab' ||
      event.key === 'Escape')
  ) {
    handleSlashKeyDown(event)
    return
  }
  if (event.key !== 'Enter' || event.shiftKey) {
    return
  }
  event.preventDefault()
  if (slashMenuOpen) {
    const command = filteredSlashCommands[slashSelectedIndex]
    if (command) {
      insertSlashCommand(command)
    }
    return
  }
  if (isSessionBusy) {
    const trimmed = composer.trim()
    if (trimmed && onQueueMessage) {
      onQueueMessage(trimmed, composerAttachments.length > 0 ? composerAttachments : undefined)
    }
    return
  }
  if (!isSendingPrompt) {
    void sendPrompt()
  }
}

function ComposerAttachmentPreviewOverlay({
  previewAttachment,
  clearPreviewAttachment,
}: {
  previewAttachment: Attachment | null
  clearPreviewAttachment: () => void
}) {
  if (!previewAttachment) {
    return null
  }
  return (
    <div className="composer-image-preview-overlay" onClick={clearPreviewAttachment}>
      <section
        className="composer-image-preview-modal"
        role="dialog"
        aria-label="Attachment preview"
        onClick={event => event.stopPropagation()}
      >
        <button
          type="button"
          className="composer-image-preview-close"
          onClick={clearPreviewAttachment}
          aria-label="Close attachment preview"
        >
          <X size={14} aria-hidden="true" />
        </button>
        <img src={previewAttachment.url} alt={previewAttachment.filename} />
        <p>{previewAttachment.filename}</p>
      </section>
    </div>
  )
}

function ComposerSlashCommandMenu({
  slashMenuOpen,
  filteredSlashCommands,
  slashSelectedIndex,
  insertSlashCommand,
}: Pick<
  ComposerInputSectionProps,
  'slashMenuOpen' | 'filteredSlashCommands' | 'slashSelectedIndex' | 'insertSlashCommand'
>) {
  if (!slashMenuOpen || filteredSlashCommands.length === 0) {
    return null
  }
  return (
    <div className="slash-command-menu">
      <small>Suggestions</small>
      <div className="slash-command-list">
        {filteredSlashCommands.map((command, index) => (
          <button
            key={command.id}
            type="button"
            className={index === slashSelectedIndex ? 'active' : ''}
            onClick={() => insertSlashCommand(command)}
          >
            <span className="slash-command-name">{`${command.trigger ?? '/'}${command.name}`}</span>
            <span className="slash-command-desc">{command.description}</span>
            {command.meta ? <span className="slash-command-desc">{command.meta}</span> : null}
          </button>
        ))}
      </div>
    </div>
  )
}

function ComposerAttachmentsList({
  attachments,
  removeAttachment,
  setPreviewAttachment,
}: {
  attachments: Attachment[]
  removeAttachment: (url: string) => void
  setPreviewAttachment: (attachment: Attachment) => void
}) {
  if (attachments.length === 0) {
    return null
  }
  return (
    <div className="composer-attachments">
      {attachments.map(attachment => (
        <div key={attachment.url} className="attachment-chip-wrap">
          <button
            type="button"
            className="attachment-chip attachment-chip-preview"
            onClick={() => {
              if (isImageAttachment(attachment)) {
                setPreviewAttachment(attachment)
              }
            }}
            title={
              isImageAttachment(attachment) ? `Preview ${attachment.filename}` : attachment.filename
            }
            aria-label={
              isImageAttachment(attachment) ? `Preview ${attachment.filename}` : attachment.filename
            }
          >
            <img src={attachment.url} alt="" className="attachment-chip-thumb" />
            <span className="attachment-chip-name">{attachment.filename}</span>
          </button>
          <button
            type="button"
            className="attachment-chip-remove"
            onClick={() => removeAttachment(attachment.url)}
            title={`Remove ${attachment.filename}`}
            aria-label={`Remove ${attachment.filename}`}
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  )
}

function ComposerInputActions({
  guardrailState,
  compactionProgress,
  compactionHint,
  compactionCompacted,
  isSessionBusy,
  hasActiveSession,
  pickImageAttachment,
  abortActiveSession,
  sendPrompt,
}: Pick<
  ComposerInputSectionProps,
  | 'guardrailState'
  | 'compactionProgress'
  | 'compactionHint'
  | 'compactionCompacted'
  | 'isSessionBusy'
  | 'hasActiveSession'
  | 'pickImageAttachment'
  | 'abortActiveSession'
  | 'sendPrompt'
>) {
  const clampedProgress = Math.max(0, Math.min(1, compactionProgress))
  const progressStyle = {
    '--compaction-progress': `${Math.round(clampedProgress * 100)}%`,
  } as React.CSSProperties

  return (
    <div className="composer-input-actions">
      {guardrailState ? (
        <div className="composer-compaction-inline" title={guardrailState.detail}>
          <span className="composer-compaction-label">
            {guardrailState.status === 'disabled'
              ? 'limits off'
              : `limits ${Math.round(
                  Math.max(guardrailState.tokenRatio, guardrailState.runtimeRatio) * 100
                )}%`}
          </span>
        </div>
      ) : null}
      <div
        className={`composer-compaction-inline ${compactionCompacted ? 'compacted' : ''}`.trim()}
        title={compactionHint}
      >
        <span className="composer-compaction-glyph" style={progressStyle} aria-hidden="true" />
        <span className="composer-compaction-label">{Math.round(clampedProgress * 100)}%</span>
      </div>
      <div className="composer-action-group">
        <IconButton
          icon="plus"
          className="composer-attach-button"
          label="Add attachment"
          onClick={() => void pickImageAttachment()}
        />
        {isSessionBusy ? (
          <IconButton
            icon="stop"
            className="composer-send-button composer-stop-button"
            label="Stop"
            onClick={() => void abortActiveSession()}
          />
        ) : (
          <IconButton
            icon="send"
            className="composer-send-button"
            label="Send prompt"
            onClick={() => void sendPrompt()}
            disabled={!hasActiveSession}
          />
        )}
      </div>
    </div>
  )
}

export function ComposerInputSection(props: ComposerInputSectionProps) {
  const {
    placeholder, composer, setComposer, composerAttachments, removeAttachment, slashMenuOpen,
    filteredSlashCommands, slashSelectedIndex, insertSlashCommand, handleSlashKeyDown,
    addComposerAttachments, sendPrompt, abortActiveSession, isSessionBusy, isSendingPrompt,
    pickImageAttachment, hasActiveSession, guardrailState, compactionProgress, compactionHint,
    compactionCompacted, onQueueMessage,
  } = props

  const {
    clearPreviewAttachment, composerHeight, composerResizeActive, handleDragLeave, handleDragOver,
    handleDrop, handlePaste, isDragOver, previewAttachment, setPreviewAttachment,
    startComposerResize,
  } = useComposerInputInteractions({ addComposerAttachments })

  return (
    <div
      className={`composer-input-section${isDragOver ? ' drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="composer-input-wrap">
        <button
          type="button"
          className={`composer-resize-handle ${composerResizeActive ? 'is-active' : ''}`.trim()}
          aria-label="Resize composer"
          onMouseDown={startComposerResize}
        />
        <textarea
          placeholder={placeholder}
          value={composer}
          style={{ height: `${composerHeight}px` }}
          onChange={event => setComposer(event.target.value)}
          onPaste={handlePaste}
          onKeyDown={event =>
            handleComposerTextareaKeyDown(event, {
              slashMenuOpen,
              handleSlashKeyDown,
              filteredSlashCommands,
              slashSelectedIndex,
              insertSlashCommand,
              isSessionBusy,
              composer,
              composerAttachments,
              onQueueMessage,
              isSendingPrompt,
              sendPrompt,
            })
          }
        />
        <ComposerInputActions
          guardrailState={guardrailState}
          compactionProgress={compactionProgress}
          compactionHint={compactionHint}
          compactionCompacted={compactionCompacted}
          isSessionBusy={isSessionBusy}
          hasActiveSession={hasActiveSession}
          pickImageAttachment={pickImageAttachment}
          abortActiveSession={abortActiveSession}
          sendPrompt={sendPrompt}
        />
      </div>

      <ComposerSlashCommandMenu
        slashMenuOpen={slashMenuOpen}
        filteredSlashCommands={filteredSlashCommands}
        slashSelectedIndex={slashSelectedIndex}
        insertSlashCommand={insertSlashCommand}
      />

      <ComposerAttachmentsList
        attachments={composerAttachments}
        removeAttachment={removeAttachment}
        setPreviewAttachment={setPreviewAttachment}
      />

      <ComposerAttachmentPreviewOverlay
        previewAttachment={previewAttachment}
        clearPreviewAttachment={clearPreviewAttachment}
      />
    </div>
  )
}
