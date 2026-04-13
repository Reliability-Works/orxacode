import { FolderTreeIcon, GlobeIcon, PanelRightIcon } from 'lucide-react'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../ui/menu'
import { Toggle } from '../ui/toggle'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import type { ChatAuxSidebarMode } from './useChatViewLocalState'
import { cn } from '~/lib/utils'

interface ChatHeaderPanelSelectorProps {
  auxSidebarMode: ChatAuxSidebarMode
  filesAvailable: boolean
  browserAvailable: boolean
  onToggleFilesSidebar: () => void
  onToggleBrowserSidebar: () => void
}

export function ChatHeaderPanelSelector(props: ChatHeaderPanelSelectorProps) {
  const {
    auxSidebarMode,
    filesAvailable,
    browserAvailable,
    onToggleFilesSidebar,
    onToggleBrowserSidebar,
  } = props

  const isActive = auxSidebarMode === 'files' || auxSidebarMode === 'browser'
  const neitherAvailable = !filesAvailable && !browserAvailable

  return (
    <Menu>
      <Tooltip>
        <MenuTrigger
          render={
            <TooltipTrigger
              render={
                <Toggle
                  className={cn('shrink-0', neitherAvailable && 'opacity-50')}
                  pressed={isActive}
                  aria-label="Toggle side panel"
                  variant="outline"
                  size="xs"
                  disabled={neitherAvailable}
                />
              }
            />
          }
        >
          <PanelRightIcon className="size-3" />
        </MenuTrigger>
        <TooltipPopup side="bottom">
          {neitherAvailable
            ? 'Panels unavailable until this thread has an active project'
            : 'Side panels'}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup side="bottom" align="end" sideOffset={6}>
        <MenuItem
          disabled={!filesAvailable}
          onClick={onToggleFilesSidebar}
          className={cn(auxSidebarMode === 'files' && 'bg-accent')}
        >
          <FolderTreeIcon className="size-4" />
          Files
        </MenuItem>
        <MenuItem
          disabled={!browserAvailable}
          onClick={onToggleBrowserSidebar}
          className={cn(auxSidebarMode === 'browser' && 'bg-accent')}
        >
          <GlobeIcon className="size-4" />
          Browser
        </MenuItem>
      </MenuPopup>
    </Menu>
  )
}
