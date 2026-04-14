/**
 * Grouped "Views" menu — consolidates Split pane / Files / Browser / Terminal
 * into a single header control. Replaces what used to be four separate toggles
 * scattered across the chat header.
 *
 * The trigger icon is a 4-blocks layout grid when nothing is active; when one
 * of the four views is active it morphs into that view's own icon with a small
 * scale/fade transition so you can tell at a glance which view you're in.
 */
import {
  Columns2Icon,
  FolderTreeIcon,
  GlobeIcon,
  LayoutGridIcon,
  Maximize2Icon,
  TerminalSquareIcon,
  type LucideIcon,
} from 'lucide-react'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../ui/menu'
import { Toggle } from '../ui/toggle'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import { useChatSplitPaneContext } from './ChatSplitPaneContext'
import type { ChatAuxSidebarMode } from './useChatViewLocalState'
import { cn } from '~/lib/utils'

interface ChatHeaderViewsGroupProps {
  auxSidebarMode: ChatAuxSidebarMode
  filesAvailable: boolean
  browserAvailable: boolean
  terminalAvailable: boolean
  terminalOpen: boolean
  terminalToggleLabel: string
  onToggleFilesSidebar: () => void
  onToggleBrowserSidebar: () => void
  onToggleTerminal: () => void
}

type ActiveView = 'files' | 'browser' | 'terminal' | 'split' | null

function resolveActiveView(input: {
  auxSidebarMode: ChatAuxSidebarMode
  terminalOpen: boolean
  splitOpen: boolean
}): ActiveView {
  if (input.auxSidebarMode === 'files') return 'files'
  if (input.auxSidebarMode === 'browser') return 'browser'
  if (input.terminalOpen) return 'terminal'
  if (input.splitOpen) return 'split'
  return null
}

const ACTIVE_ICON: Record<Exclude<ActiveView, null>, LucideIcon> = {
  files: FolderTreeIcon,
  browser: GlobeIcon,
  terminal: TerminalSquareIcon,
  split: Columns2Icon,
}

const ACTIVE_LABEL: Record<Exclude<ActiveView, null>, string> = {
  files: 'Files',
  browser: 'Browser',
  terminal: 'Terminal',
  split: 'Split view',
}

function TriggerIcon({ activeView }: { activeView: ActiveView }) {
  const Icon = activeView === null ? LayoutGridIcon : ACTIVE_ICON[activeView]
  return (
    <Icon
      key={activeView ?? 'grid'}
      className="size-3 animate-in fade-in-0 zoom-in-75 duration-200"
    />
  )
}

function ViewsTrigger(props: {
  activeView: ActiveView
  tooltipLabel: string
  allUnavailable: boolean
}) {
  return (
    <Tooltip>
      <MenuTrigger
        render={
          <TooltipTrigger
            render={
              <Toggle
                className={cn('shrink-0', props.allUnavailable && 'opacity-50')}
                pressed={props.activeView !== null}
                aria-label={props.tooltipLabel}
                variant="outline"
                size="xs"
                disabled={props.allUnavailable}
              />
            }
          />
        }
      >
        <TriggerIcon activeView={props.activeView} />
      </MenuTrigger>
      <TooltipPopup side="bottom">
        {props.allUnavailable
          ? 'Views unavailable until this thread has an active project'
          : props.tooltipLabel}
      </TooltipPopup>
    </Tooltip>
  )
}

function SplitPaneMenuItem(props: { split: ReturnType<typeof useChatSplitPaneContext> }) {
  const { split } = props
  const splitAvailable = split !== null
  const splitOpen = Boolean(split?.splitOpen)
  const isSplitMaximized = splitAvailable && split.maximizedPane === split.pane
  const label = splitOpen
    ? isSplitMaximized
      ? 'Restore split view'
      : `Maximize ${split?.pane ?? ''} pane`
    : 'Open split view'
  return (
    <MenuItem
      disabled={!splitAvailable}
      onClick={() => {
        if (!split) return
        if (!splitOpen) split.toggleSplit()
        else split.toggleMaximize()
      }}
      className={cn(splitOpen && 'bg-accent')}
    >
      {splitOpen && isSplitMaximized ? (
        <Maximize2Icon className="size-4" />
      ) : (
        <Columns2Icon className="size-4" />
      )}
      {label}
    </MenuItem>
  )
}

export function ChatHeaderViewsGroup(props: ChatHeaderViewsGroupProps) {
  const split = useChatSplitPaneContext()
  const splitAvailable = split !== null
  const splitOpen = Boolean(split?.splitOpen)
  const activeView = resolveActiveView({
    auxSidebarMode: props.auxSidebarMode,
    terminalOpen: props.terminalOpen,
    splitOpen,
  })
  const tooltipLabel = activeView ? ACTIVE_LABEL[activeView] : 'Views'
  const allUnavailable =
    !props.filesAvailable && !props.browserAvailable && !props.terminalAvailable && !splitAvailable

  return (
    <Menu>
      <ViewsTrigger
        activeView={activeView}
        tooltipLabel={tooltipLabel}
        allUnavailable={allUnavailable}
      />
      <MenuPopup side="bottom" align="end" sideOffset={6}>
        <SplitPaneMenuItem split={split} />
        <MenuItem
          disabled={!props.filesAvailable}
          onClick={props.onToggleFilesSidebar}
          className={cn(props.auxSidebarMode === 'files' && 'bg-accent')}
        >
          <FolderTreeIcon className="size-4" />
          Files
        </MenuItem>
        <MenuItem
          disabled={!props.browserAvailable}
          onClick={props.onToggleBrowserSidebar}
          className={cn(props.auxSidebarMode === 'browser' && 'bg-accent')}
        >
          <GlobeIcon className="size-4" />
          Browser
        </MenuItem>
        <MenuItem
          disabled={!props.terminalAvailable}
          onClick={props.onToggleTerminal}
          className={cn(props.terminalOpen && 'bg-accent')}
        >
          <TerminalSquareIcon className="size-4" />
          {props.terminalToggleLabel}
        </MenuItem>
      </MenuPopup>
    </Menu>
  )
}
