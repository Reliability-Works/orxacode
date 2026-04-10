/**
 * Expanded (non-compact) composer footer controls: traits, chat/plan, runtime.
 */

import React from 'react'
import { BotIcon, ChevronDownIcon, LockIcon, LockOpenIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '../ui/menu'
import { Separator } from '../ui/separator'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { useChatViewCtx } from './ChatViewContext'

function InteractionModeControl() {
  const c = useChatViewCtx()
  const { interactionMode } = c.td
  const isMobile = useIsMobile()
  if (isMobile) {
    return (
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
              size="sm"
              type="button"
              aria-label="Choose interaction mode"
            />
          }
        >
          <BotIcon />
          <ChevronDownIcon className="size-3 opacity-60" />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuRadioGroup
            value={interactionMode}
            onValueChange={value => {
              if (!value || value === interactionMode) return
              c.toggleInteractionMode()
            }}
          >
            <MenuRadioItem value="default">Chat</MenuRadioItem>
            <MenuRadioItem value="plan">Plan</MenuRadioItem>
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    )
  }
  return (
    <Button
      variant="ghost"
      className="min-w-[5.75rem] shrink-0 whitespace-nowrap px-2.5 text-muted-foreground/70 hover:text-foreground/80 sm:min-w-0 sm:px-3"
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
      <span className="truncate">{interactionMode === 'plan' ? 'Plan' : 'Chat'}</span>
    </Button>
  )
}

function RuntimeModeControl() {
  const c = useChatViewCtx()
  const { runtimeMode } = c.td
  const isMobile = useIsMobile()
  if (isMobile) {
    return (
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              className="shrink-0 px-2 text-muted-foreground/70 hover:text-foreground/80"
              size="sm"
              type="button"
              aria-label="Choose access mode"
            />
          }
        >
          {runtimeMode === 'full-access' ? <LockOpenIcon /> : <LockIcon />}
          <ChevronDownIcon className="size-3 opacity-60" />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuRadioGroup
            value={runtimeMode}
            onValueChange={value => {
              if (!value || value === runtimeMode) return
              void c.handleRuntimeModeChange(
                value === 'full-access' ? 'full-access' : 'approval-required'
              )
            }}
          >
            <MenuRadioItem value="approval-required">Supervised</MenuRadioItem>
            <MenuRadioItem value="full-access">Full access</MenuRadioItem>
          </MenuRadioGroup>
        </MenuPopup>
      </Menu>
    )
  }
  return (
    <Button
      variant="ghost"
      className="min-w-[8.25rem] shrink-0 whitespace-nowrap px-2.5 text-muted-foreground/70 hover:text-foreground/80 sm:min-w-0 sm:px-3"
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
      <span className="truncate">
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
      <InteractionModeControl />
      <Separator orientation="vertical" className="mx-0.5 hidden h-4 sm:block" />
      <RuntimeModeControl />
    </>
  )
}
