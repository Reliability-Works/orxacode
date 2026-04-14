import { ArrowUpIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import type React from 'react'
import { Button } from '../ui/button'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import { cn } from '~/lib/utils'
import { useChatViewCtx } from './ChatViewContext'
import {
  summarizeQueuedComposerMessage,
  type QueuedComposerMessage,
} from './queuedComposerMessages'

export interface ComposerLiveRailCardProps {
  readonly children: React.ReactNode
  readonly className?: string
  readonly testId?: string
}

function QueuedMessageActionButton(props: {
  label: string
  icon: React.ReactNode
  onClick: () => void
  tone?: 'default' | 'destructive'
  testId?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={props.label}
            onClick={props.onClick}
            className={cn(
              'text-muted-foreground hover:text-foreground',
              props.tone === 'destructive' && 'hover:text-destructive-foreground'
            )}
            data-testid={props.testId}
          />
        }
      >
        {props.icon}
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  )
}

function ComposerQueuedMessageRow(props: { queueIndex: number; message: QueuedComposerMessage }) {
  const c = useChatViewCtx()
  const summary = summarizeQueuedComposerMessage(props.message)
  const isHead = props.queueIndex === 0

  return (
    <div
      data-testid="composer-queued-message"
      className={cn(
        'flex items-start justify-between gap-3 rounded-xl px-1 py-1',
        props.queueIndex > 0 ? 'border-t border-border/40 pt-2' : ''
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-caption text-muted-foreground/80">
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
          <p className="mt-1 text-caption text-muted-foreground/75">{summary.attachmentSummary}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <QueuedMessageActionButton
          label="Edit"
          icon={<PencilIcon className="size-3.5" />}
          onClick={() => c.restoreQueuedComposerMessage(props.message)}
          testId="composer-queued-message-edit"
        />
        {isHead ? (
          <QueuedMessageActionButton
            label="Send now and interrupt"
            icon={<ArrowUpIcon className="size-3.5" />}
            onClick={() => void c.onInterrupt()}
            testId="composer-queued-message-send-now"
          />
        ) : null}
        <QueuedMessageActionButton
          label="Remove from queue"
          icon={<Trash2Icon className="size-3.5" />}
          onClick={() => c.removeQueuedComposerMessage(props.message)}
          tone="destructive"
          testId="composer-queued-message-remove"
        />
      </div>
    </div>
  )
}

export function ComposerQueuedMessagesRailCard() {
  const c = useChatViewCtx()
  const queuedMessages = c.ls.queuedComposerMessages
  if (queuedMessages.length === 0) {
    return null
  }

  return (
    <div className="px-3 py-2">
      {queuedMessages.map((message, index) => (
        <ComposerQueuedMessageRow key={message.id} queueIndex={index} message={message} />
      ))}
    </div>
  )
}
