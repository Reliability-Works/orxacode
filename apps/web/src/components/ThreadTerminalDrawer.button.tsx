import { Popover, PopoverPopup, PopoverTrigger } from '~/components/ui/popover'

export interface TerminalDrawerButtonProps {
  label: string
  className: string
  onClick: () => void
  children: React.ReactNode
}

export function TerminalDrawerButton({
  label,
  className,
  onClick,
  children,
}: TerminalDrawerButtonProps) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        render={<button type="button" className={className} onClick={onClick} aria-label={label} />}
      >
        {children}
      </PopoverTrigger>
      <PopoverPopup
        tooltipStyle
        side="bottom"
        sideOffset={6}
        align="center"
        className="pointer-events-none select-none"
      >
        {label}
      </PopoverPopup>
    </Popover>
  )
}
