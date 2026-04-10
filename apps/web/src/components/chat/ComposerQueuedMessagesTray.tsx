import { Button } from '../ui/button'
import { cn } from '~/lib/utils'
import { useChatViewCtx } from './ChatViewContext'
import { summarizeQueuedComposerMessage } from './queuedComposerMessages'

function ComposerQueuedMessageRow(props: {
  queueIndex: number
  message: ReturnType<typeof useChatViewCtx>['ls']['queuedComposerMessages'][number]
}) {
  const c = useChatViewCtx()
  const summary = summarizeQueuedComposerMessage(props.message)

  return (
    <div
      data-testid="composer-queued-message"
      className={cn(
        'flex items-start justify-between gap-3 rounded-xl px-1 py-1',
        props.queueIndex > 0 ? 'border-t border-border/40 pt-2' : ''
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
          <span className="rounded-full border border-border/70 bg-background/50 px-2 py-0.5 font-medium text-foreground/85">
            Queued
          </span>
          <span className="truncate">
            {summary.providerLabel} / {summary.modelLabel}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm leading-5 text-foreground/90">
          {summary.previewText}
        </p>
        {summary.attachmentSummary ? (
          <p className="mt-1 text-[11px] text-muted-foreground/75">{summary.attachmentSummary}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 rounded-full px-2.5 text-xs"
          onClick={() => c.restoreQueuedComposerMessage(props.message)}
        >
          Restore
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => c.removeQueuedComposerMessage(props.message)}
          aria-label="Remove queued message"
        >
          Remove
        </Button>
      </div>
    </div>
  )
}

export function ComposerQueuedMessagesTray() {
  const c = useChatViewCtx()
  const queuedMessages = c.ls.queuedComposerMessages
  if (queuedMessages.length === 0) {
    return null
  }

  return (
    <div className="mx-4 -mb-px sm:mx-6" data-testid="composer-queued-messages">
      <div className="rounded-t-[18px] border border-b-0 border-border/80 bg-muted/55 px-3 py-2 backdrop-blur-sm">
        {queuedMessages.map((message, index) => (
          <ComposerQueuedMessageRow key={message.id} queueIndex={index} message={message} />
        ))}
      </div>
    </div>
  )
}
