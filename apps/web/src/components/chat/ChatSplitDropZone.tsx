/**
 * Drop zone wrapping the chat thread layout. Accepts a thread being dragged
 * from the sidebar and opens it as the split-pane secondary (or replaces the
 * current secondary). Rejects cross-project drags and drops of the primary
 * thread onto itself.
 */
import { type DragEvent, type ReactNode, useState } from 'react'
import { type ProjectId, type ThreadId } from '@orxa-code/contracts'

import { THREAD_DRAG_MIME, useThreadDragStore } from '../../threadDragStore'

interface ChatSplitDropZoneProps {
  readonly primaryThreadId: ThreadId
  readonly primaryProjectId: ProjectId | null
  readonly secondaryThreadId: ThreadId | null
  readonly onOpenSecondary: (threadId: ThreadId) => void
  readonly children: ReactNode
}

interface DropDecision {
  readonly accept: boolean
  readonly label: string | null
}

function decideDrop(params: {
  dragging: { threadId: ThreadId; projectId: ProjectId | null } | null
  primaryThreadId: ThreadId
  primaryProjectId: ProjectId | null
  secondaryThreadId: ThreadId | null
}): DropDecision {
  const { dragging, primaryThreadId, primaryProjectId, secondaryThreadId } = params
  if (!dragging) return { accept: false, label: null }
  if (dragging.threadId === primaryThreadId) return { accept: false, label: null }
  if (dragging.threadId === secondaryThreadId) return { accept: false, label: null }
  if (!primaryProjectId || dragging.projectId !== primaryProjectId) {
    return { accept: false, label: null }
  }
  return {
    accept: true,
    label: secondaryThreadId ? 'Replace split pane with this session' : 'Open in split view',
  }
}

function readDroppedThreadId(event: DragEvent<HTMLDivElement>): ThreadId | null {
  try {
    const raw = event.dataTransfer.getData(THREAD_DRAG_MIME)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { threadId?: string }
    return parsed.threadId ? (parsed.threadId as ThreadId) : null
  } catch {
    return null
  }
}

export function ChatSplitDropZone(props: ChatSplitDropZoneProps) {
  const dragging = useThreadDragStore(store => store.draggingThread)
  const [isOver, setIsOver] = useState(false)
  const decision = decideDrop({
    dragging,
    primaryThreadId: props.primaryThreadId,
    primaryProjectId: props.primaryProjectId,
    secondaryThreadId: props.secondaryThreadId,
  })

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!decision.accept) return
    if (!event.dataTransfer.types.includes(THREAD_DRAG_MIME)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'link'
    if (!isOver) setIsOver(true)
  }
  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsOver(false)
  }
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    setIsOver(false)
    if (!decision.accept) return
    const threadId = readDroppedThreadId(event)
    if (!threadId) return
    event.preventDefault()
    props.onOpenSecondary(threadId)
  }

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {props.children}
      {isOver && decision.label ? (
        <div
          className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/60 bg-primary/10 backdrop-blur-[2px]"
          aria-hidden="true"
        >
          <span className="rounded-md bg-background/90 px-3 py-1.5 text-sm font-medium text-foreground shadow-sm">
            {decision.label}
          </span>
        </div>
      ) : null}
    </div>
  )
}
