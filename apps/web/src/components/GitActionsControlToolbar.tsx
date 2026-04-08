import { ChevronDownIcon, CloudUploadIcon, GitCommitIcon, InfoIcon } from 'lucide-react'
import { GitHubIcon } from './Icons'
import type {
  GitActionIconName,
  GitActionMenuItem,
  GitQuickAction,
} from './GitActionsControl.logic'
import type { GitStatusResult } from '@orxa-code/contracts'
import { Button } from '~/components/ui/button'
import { Group, GroupSeparator } from '~/components/ui/group'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '~/components/ui/menu'
import { Popover, PopoverPopup, PopoverTrigger } from '~/components/ui/popover'
import { invalidateGitQueries } from '~/lib/gitReactQuery'
import { useQueryClient } from '@tanstack/react-query'

export function GitActionItemIcon({ icon }: { icon: GitActionIconName }) {
  if (icon === 'commit') return <GitCommitIcon />
  if (icon === 'push') return <CloudUploadIcon />
  return <GitHubIcon />
}

export function GitQuickActionIcon({ quickAction }: { quickAction: GitQuickAction }) {
  const iconClassName = 'size-3.5'
  if (quickAction.kind === 'open_pr') return <GitHubIcon className={iconClassName} />
  if (quickAction.kind === 'run_pull') return <InfoIcon className={iconClassName} />
  if (quickAction.kind === 'run_action') {
    if (quickAction.action === 'commit') return <GitCommitIcon className={iconClassName} />
    if (quickAction.action === 'commit_push') return <CloudUploadIcon className={iconClassName} />
    return <GitHubIcon className={iconClassName} />
  }
  if (quickAction.label === 'Commit') return <GitCommitIcon className={iconClassName} />
  return <InfoIcon className={iconClassName} />
}

interface GitQuickActionButtonProps {
  quickAction: GitQuickAction
  quickActionDisabledReason: string | null
  isGitActionRunning: boolean
  onRun: () => void
}

export function GitQuickActionButton({
  quickAction,
  quickActionDisabledReason,
  isGitActionRunning,
  onRun,
}: GitQuickActionButtonProps) {
  if (quickActionDisabledReason) {
    return (
      <Popover>
        <PopoverTrigger
          openOnHover
          render={
            <Button
              aria-disabled="true"
              className="cursor-not-allowed rounded-e-none border-e-0 opacity-64 before:rounded-e-none"
              size="xs"
              variant="outline"
            />
          }
        >
          <GitQuickActionIcon quickAction={quickAction} />
          <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
            {quickAction.label}
          </span>
        </PopoverTrigger>
        <PopoverPopup tooltipStyle side="bottom" align="start">
          {quickActionDisabledReason}
        </PopoverPopup>
      </Popover>
    )
  }
  return (
    <Button
      variant="outline"
      size="xs"
      disabled={isGitActionRunning || quickAction.disabled}
      onClick={onRun}
    >
      <GitQuickActionIcon quickAction={quickAction} />
      <span className="sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5">
        {quickAction.label}
      </span>
    </Button>
  )
}

interface GitMenuStatusMessagesProps {
  gitStatusForActions: GitStatusResult | null
  gitStatusError: Error | null
  isGitStatusOutOfSync: boolean
}

export function GitMenuStatusMessages({
  gitStatusForActions,
  gitStatusError,
  isGitStatusOutOfSync,
}: GitMenuStatusMessagesProps) {
  return (
    <>
      {gitStatusForActions?.branch === null && (
        <p className="px-2 py-1.5 text-xs text-warning">
          Detached HEAD: create and checkout a branch to enable push and PR actions.
        </p>
      )}
      {gitStatusForActions &&
        gitStatusForActions.branch !== null &&
        !gitStatusForActions.hasWorkingTreeChanges &&
        gitStatusForActions.behindCount > 0 &&
        gitStatusForActions.aheadCount === 0 && (
          <p className="px-2 py-1.5 text-xs text-warning">Behind upstream. Pull/rebase first.</p>
        )}
      {isGitStatusOutOfSync && (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">Refreshing git status...</p>
      )}
      {gitStatusError && (
        <p className="px-2 py-1.5 text-xs text-destructive">{gitStatusError.message}</p>
      )}
    </>
  )
}

interface GitActionMenuProps {
  gitActionMenuItems: GitActionMenuItem[]
  gitStatusForActions: GitStatusResult | null
  gitStatusError: Error | null
  isGitActionRunning: boolean
  isGitStatusOutOfSync: boolean
  hasOriginRemote: boolean
  getMenuActionDisabledReason: (args: {
    item: GitActionMenuItem
    gitStatus: GitStatusResult | null
    isBusy: boolean
    hasOriginRemote: boolean
  }) => string | null
  onOpenDialogForMenuItem: (item: GitActionMenuItem) => void
}

export function GitActionMenu({
  gitActionMenuItems,
  gitStatusForActions,
  gitStatusError,
  isGitActionRunning,
  isGitStatusOutOfSync,
  hasOriginRemote,
  getMenuActionDisabledReason,
  onOpenDialogForMenuItem,
}: GitActionMenuProps) {
  const queryClient = useQueryClient()
  return (
    <Menu
      onOpenChange={open => {
        if (open) void invalidateGitQueries(queryClient)
      }}
    >
      <MenuTrigger
        render={<Button aria-label="Git action options" size="icon-xs" variant="outline" />}
        disabled={isGitActionRunning}
      >
        <ChevronDownIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-full">
        {gitActionMenuItems.map(item => {
          const disabledReason = getMenuActionDisabledReason({
            item,
            gitStatus: gitStatusForActions,
            isBusy: isGitActionRunning,
            hasOriginRemote,
          })
          if (item.disabled && disabledReason) {
            return (
              <Popover key={`${item.id}-${item.label}`}>
                <PopoverTrigger
                  openOnHover
                  nativeButton={false}
                  render={<span className="block w-max cursor-not-allowed" />}
                >
                  <MenuItem className="w-full" disabled>
                    <GitActionItemIcon icon={item.icon} />
                    {item.label}
                  </MenuItem>
                </PopoverTrigger>
                <PopoverPopup tooltipStyle side="left" align="center">
                  {disabledReason}
                </PopoverPopup>
              </Popover>
            )
          }
          return (
            <MenuItem
              key={`${item.id}-${item.label}`}
              disabled={item.disabled}
              onClick={() => onOpenDialogForMenuItem(item)}
            >
              <GitActionItemIcon icon={item.icon} />
              {item.label}
            </MenuItem>
          )
        })}
        <GitMenuStatusMessages
          gitStatusForActions={gitStatusForActions}
          gitStatusError={gitStatusError}
          isGitStatusOutOfSync={isGitStatusOutOfSync}
        />
      </MenuPopup>
    </Menu>
  )
}

interface GitActionsToolbarProps extends GitActionMenuProps {
  quickAction: GitQuickAction
  quickActionDisabledReason: string | null
  onRunQuickAction: () => void
}

export function GitActionsToolbar({
  quickAction,
  quickActionDisabledReason,
  isGitActionRunning,
  onRunQuickAction,
  gitActionMenuItems,
  gitStatusForActions,
  gitStatusError,
  isGitStatusOutOfSync,
  hasOriginRemote,
  getMenuActionDisabledReason,
  onOpenDialogForMenuItem,
}: GitActionsToolbarProps) {
  return (
    <Group aria-label="Git actions" className="shrink-0">
      <GitQuickActionButton
        quickAction={quickAction}
        quickActionDisabledReason={quickActionDisabledReason}
        isGitActionRunning={isGitActionRunning}
        onRun={onRunQuickAction}
      />
      <GroupSeparator className="hidden @3xl/header-actions:block" />
      <GitActionMenu
        gitActionMenuItems={gitActionMenuItems}
        gitStatusForActions={gitStatusForActions}
        gitStatusError={gitStatusError}
        isGitActionRunning={isGitActionRunning}
        isGitStatusOutOfSync={isGitStatusOutOfSync}
        hasOriginRemote={hasOriginRemote}
        getMenuActionDisabledReason={getMenuActionDisabledReason}
        onOpenDialogForMenuItem={onOpenDialogForMenuItem}
      />
    </Group>
  )
}
