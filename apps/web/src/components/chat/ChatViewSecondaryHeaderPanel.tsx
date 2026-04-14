/**
 * Minimal header shown on the secondary (drop-opened) pane of the split view.
 * Renders just the thread title and an X button that closes the split and
 * returns the session to the sidebar.
 */
import { XIcon } from 'lucide-react'

import { Button } from '../ui/button'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import { useChatViewCtx } from './ChatViewContext'
import { useChatSplitPaneContext } from './ChatSplitPaneContext'

export function ChatViewSecondaryHeaderPanel() {
  const c = useChatViewCtx()
  const split = useChatSplitPaneContext()
  const thread = c.td.activeThread
  if (!split || !thread) return null
  return (
    <header className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-border px-3 sm:px-5">
      <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {thread.title}
      </div>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="xs"
              variant="outline"
              onClick={split.toggleSplit}
              aria-label="Close split pane"
            />
          }
        >
          <XIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Close split pane</TooltipPopup>
      </Tooltip>
    </header>
  )
}
