import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { IconButton } from './IconButton'
import { useComposerInputInteractions } from './composer/useComposerInputInteractions'
import type { ComposerPanelProps } from './ComposerPanel.impl'

type ComposerInputStripProps = Pick<
  ComposerPanelProps,
  | 'placeholder'
  | 'composer'
  | 'setComposer'
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
  | 'compactionProgress'
  | 'compactionHint'
  | 'compactionCompacted'
  | 'onQueueMessage'
  | 'composerAttachments'
>

function ComposerInputActions({
  compactionProgress,
  compactionHint,
  compactionCompacted,
  isSessionBusy,
  hasActiveSession,
  pickImageAttachment,
  abortActiveSession,
  sendPrompt,
}: Pick<
  ComposerInputStripProps,
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

export function ComposerInputStrip(props: ComposerInputStripProps) {
  const {
    placeholder,
    composer,
    setComposer,
    slashMenuOpen,
    filteredSlashCommands,
    slashSelectedIndex,
    insertSlashCommand,
    handleSlashKeyDown,
    addComposerAttachments,
    sendPrompt,
    abortActiveSession,
    isSessionBusy,
    isSendingPrompt,
    pickImageAttachment,
    hasActiveSession,
    compactionProgress,
    compactionHint,
    compactionCompacted,
    onQueueMessage,
    composerAttachments,
  } = props
  const {
    composerHeight,
    composerResizeActive,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
    isDragOver,
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
            handleComposerKeyDown(event as ReactKeyboardEvent<HTMLTextAreaElement>, {
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
    </div>
  )
}

function handleComposerKeyDown(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
  props: Pick<
    ComposerInputStripProps,
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
      insertSlashCommand(command.name)
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
