import { CheckIcon, ClipboardCopyIcon, CrosshairIcon, Trash2Icon, XIcon } from 'lucide-react'

import { Button } from '../ui/button'
import { Input } from '../ui/input'
import type { BrowserAnnotation } from './browserSidebar.annotations'

export function BrowserInspectToggle(props: {
  inspectMode: boolean
  disabled: boolean
  onToggle: () => void
}) {
  const { inspectMode, disabled, onToggle } = props
  return (
    <Button
      type="button"
      size="xs"
      variant={inspectMode ? 'secondary' : 'outline'}
      onClick={onToggle}
      disabled={disabled}
      aria-label={inspectMode ? 'Exit inspect mode' : 'Enter inspect mode'}
    >
      <CrosshairIcon className="size-3" />
      {inspectMode ? 'Inspecting' : 'Inspect'}
    </Button>
  )
}

export function BrowserInspectOverlay(props: { inspectMode: boolean }) {
  const { inspectMode } = props
  if (!inspectMode) return null
  return (
    <div
      className="pointer-events-none absolute left-3 top-3 z-10 rounded-full border border-emerald-500/35 bg-background/90 px-2 py-1 text-caption text-emerald-300 shadow-sm backdrop-blur"
      aria-live="polite"
    >
      Click elements in the browser to annotate them.
    </div>
  )
}

export function BrowserAnnotationsPanel(props: {
  annotations: BrowserAnnotation[]
  copied: boolean
  onClear: () => void
  onCopyPrompt: () => void
  onRemove: (id: string) => void
  onUpdateComment: (id: string, comment: string) => void
}) {
  const { annotations, copied, onClear, onCopyPrompt, onRemove, onUpdateComment } = props
  if (annotations.length === 0) return null
  return (
    <div className="border-b border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">
          Annotations ({annotations.length})
        </span>
        <div className="flex items-center gap-1.5">
          <Button type="button" size="xs" variant="outline" onClick={onCopyPrompt}>
            {copied ? <CheckIcon className="size-3" /> : <ClipboardCopyIcon className="size-3" />}
            {copied ? 'Copied' : 'Copy prompt'}
          </Button>
          <Button type="button" size="xs" variant="outline" onClick={onClear}>
            <Trash2Icon className="size-3" />
            Clear
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {annotations.map(annotation => (
          <div key={annotation.id} className="rounded-lg border border-border p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-xs font-medium text-foreground">{annotation.element}</p>
                <p className="truncate font-mono text-caption text-muted-foreground">
                  {annotation.selector}
                </p>
              </div>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="h-5 w-5 p-0"
                onClick={() => onRemove(annotation.id)}
                aria-label={`Remove annotation for ${annotation.element}`}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
            <div className="mt-2 space-y-1">
              {annotation.text ? (
                <p className="line-clamp-2 text-caption text-muted-foreground">{annotation.text}</p>
              ) : null}
              <Input
                nativeInput
                size="sm"
                value={annotation.comment}
                onChange={event => onUpdateComment(annotation.id, event.target.value)}
                placeholder="Add a note..."
                aria-label={`Note for ${annotation.element}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
