import {
  CheckIcon,
  FolderTreeIcon,
  GitBranchIcon,
  MessageSquareIcon,
  PanelLeftOpenIcon,
} from 'lucide-react'

import { cn } from '~/lib/utils'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../ui/menu'
import { Toggle } from '../ui/toggle'

export function ChatHeaderMobileViewToggle(props: {
  activeView: 'threads' | 'chat' | 'files' | 'git'
  filesAvailable: boolean
  isGitRepo: boolean
  onOpenThreads: () => void
  onSelectChat: () => void
  onSelectFiles: () => void
  onSelectGit: () => void
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Toggle
            pressed={false}
            aria-label="Choose mobile view"
            variant="outline"
            size="sm"
            className="min-w-10 gap-2 px-2.5"
          >
            <PanelLeftOpenIcon className="size-4" />
          </Toggle>
        }
      />
      <MenuPopup align="end" className="min-w-40">
        <MenuItem onClick={props.onOpenThreads}>
          <CheckIcon
            className={cn('size-4', props.activeView === 'threads' ? 'opacity-100' : 'opacity-0')}
          />
          <PanelLeftOpenIcon className="size-4" />
          Threads
        </MenuItem>
        <MenuItem onClick={props.onSelectChat}>
          <CheckIcon
            className={cn('size-4', props.activeView === 'chat' ? 'opacity-100' : 'opacity-0')}
          />
          <MessageSquareIcon className="size-4" />
          Chat
        </MenuItem>
        <MenuItem disabled={!props.filesAvailable} onClick={props.onSelectFiles}>
          <CheckIcon
            className={cn('size-4', props.activeView === 'files' ? 'opacity-100' : 'opacity-0')}
          />
          <FolderTreeIcon className="size-4" />
          Files
        </MenuItem>
        <MenuItem disabled={!props.isGitRepo} onClick={props.onSelectGit}>
          <CheckIcon
            className={cn('size-4', props.activeView === 'git' ? 'opacity-100' : 'opacity-0')}
          />
          <GitBranchIcon className="size-4" />
          Git
        </MenuItem>
      </MenuPopup>
    </Menu>
  )
}
