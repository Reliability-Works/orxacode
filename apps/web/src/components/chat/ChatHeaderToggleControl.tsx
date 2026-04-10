import type React from 'react'

import { Toggle } from '../ui/toggle'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'

export function ChatHeaderToggleControl(props: {
  pressed: boolean
  onToggle: () => void
  disabled: boolean
  ariaLabel: string
  icon: React.ComponentType<{ className?: string }>
  tooltipLabel: string
}) {
  const { pressed, onToggle, disabled, ariaLabel, icon: Icon, tooltipLabel } = props
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0"
            pressed={pressed}
            onPressedChange={onToggle}
            aria-label={ariaLabel}
            variant="outline"
            size="xs"
            disabled={disabled}
          >
            <Icon className="size-3" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{tooltipLabel}</TooltipPopup>
    </Tooltip>
  )
}
