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
  className?: string
  iconClassName?: string
}) {
  const {
    pressed,
    onToggle,
    disabled,
    ariaLabel,
    icon: Icon,
    tooltipLabel,
    className,
    iconClassName,
  } = props
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className={className ?? 'shrink-0'}
            pressed={pressed}
            onPressedChange={onToggle}
            aria-label={ariaLabel}
            variant="outline"
            size="xs"
            disabled={disabled}
          >
            <Icon className={iconClassName ?? 'size-3.5'} />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{tooltipLabel}</TooltipPopup>
    </Tooltip>
  )
}
