/**
 * Expanded (non-compact) composer footer controls: traits, chat/plan, runtime.
 */

import React from 'react'
import { BotIcon, LockIcon, LockOpenIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { Separator } from '../ui/separator'
import { useChatViewCtx } from './ChatViewContext'

function InteractionModeButton() {
  const c = useChatViewCtx()
  const { interactionMode } = c.td
  return (
    <Button
      variant="ghost"
      className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
      size="sm"
      type="button"
      onClick={c.toggleInteractionMode}
      title={
        interactionMode === 'plan'
          ? 'Plan mode — click to return to normal chat mode'
          : 'Default mode — click to enter plan mode'
      }
    >
      <BotIcon />
      <span className="sr-only sm:not-sr-only">{interactionMode === 'plan' ? 'Plan' : 'Chat'}</span>
    </Button>
  )
}

function RuntimeModeButton() {
  const c = useChatViewCtx()
  const { runtimeMode } = c.td
  return (
    <Button
      variant="ghost"
      className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
      size="sm"
      type="button"
      onClick={() =>
        void c.handleRuntimeModeChange(
          runtimeMode === 'full-access' ? 'approval-required' : 'full-access'
        )
      }
      title={
        runtimeMode === 'full-access'
          ? 'Full access — click to require approvals'
          : 'Approval required — click for full access'
      }
    >
      {runtimeMode === 'full-access' ? <LockOpenIcon /> : <LockIcon />}
      <span className="sr-only sm:not-sr-only">
        {runtimeMode === 'full-access' ? 'Full access' : 'Supervised'}
      </span>
    </Button>
  )
}

export function ChatViewComposerControlsExpanded({
  providerTraitsPicker,
}: {
  providerTraitsPicker: React.ReactNode
}) {
  return (
    <>
      {providerTraitsPicker ? (
        <>
          <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
          {providerTraitsPicker}
        </>
      ) : null}
      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
      <InteractionModeButton />
      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
      <RuntimeModeButton />
    </>
  )
}
