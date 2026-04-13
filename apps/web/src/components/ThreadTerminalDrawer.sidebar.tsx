import { Plus, SquareSplitHorizontal, TerminalSquare, XIcon } from 'lucide-react'
import { Popover, PopoverPopup, PopoverTrigger } from '~/components/ui/popover'
import { type ThreadTerminalGroup } from '../types'
import { TerminalDrawerButton } from './ThreadTerminalDrawer.button'

const SidebarActionButton = TerminalDrawerButton

interface SidebarHeaderProps {
  hasReachedSplitLimit: boolean
  splitTerminalActionLabel: string
  newTerminalActionLabel: string
  closeLabel: string
  onSplitTerminalAction: () => void
  onNewTerminalAction: () => void
  onCloseActive: () => void
}

function TerminalSidebarHeader({
  hasReachedSplitLimit,
  splitTerminalActionLabel,
  newTerminalActionLabel,
  closeLabel,
  onSplitTerminalAction,
  onNewTerminalAction,
  onCloseActive,
}: SidebarHeaderProps) {
  return (
    <div className="flex h-[22px] items-stretch justify-end border-b border-border/70">
      <div className="inline-flex h-full items-stretch">
        <SidebarActionButton
          className={`inline-flex h-full items-center px-1 text-foreground/90 transition-colors ${hasReachedSplitLimit ? 'cursor-not-allowed opacity-45 hover:bg-transparent' : 'hover:bg-accent/70'}`}
          onClick={onSplitTerminalAction}
          label={splitTerminalActionLabel}
        >
          <SquareSplitHorizontal className="size-3.25" />
        </SidebarActionButton>
        <SidebarActionButton
          className="inline-flex h-full items-center border-l border-border/70 px-1 text-foreground/90 transition-colors hover:bg-accent/70"
          onClick={onNewTerminalAction}
          label={newTerminalActionLabel}
        >
          <Plus className="size-3.25" />
        </SidebarActionButton>
        <SidebarActionButton
          className="inline-flex h-full items-center border-l border-border/70 px-1 text-foreground/90 transition-colors hover:bg-accent/70"
          onClick={onCloseActive}
          label={closeLabel}
        >
          <XIcon className="size-3.25" />
        </SidebarActionButton>
      </div>
    </div>
  )
}

interface TerminalGroupItemProps {
  terminalGroup: ThreadTerminalGroup
  groupIndex: number
  resolvedActiveTerminalId: string
  terminalLabelById: Map<string, string>
  normalizedTerminalIds: string[]
  showGroupHeaders: boolean
  closeShortcutLabel: string | undefined
  onActiveTerminalChange: (terminalId: string) => void
  onCloseTerminal: (terminalId: string) => void
}

interface TerminalRowProps {
  terminalId: string
  isActive: boolean
  showGroupHeaders: boolean
  terminalLabelById: Map<string, string>
  closeShortcutLabel: string | undefined
  canClose: boolean
  onActiveTerminalChange: (terminalId: string) => void
  onCloseTerminal: (terminalId: string) => void
}

function TerminalRow({
  terminalId,
  isActive,
  showGroupHeaders,
  terminalLabelById,
  closeShortcutLabel,
  canClose,
  onActiveTerminalChange,
  onCloseTerminal,
}: TerminalRowProps) {
  const closeTerminalLabel = `Close ${terminalLabelById.get(terminalId) ?? 'terminal'}${isActive && closeShortcutLabel ? ` (${closeShortcutLabel})` : ''}`
  return (
    <div
      className={`group flex items-center gap-1 rounded px-1 py-0.5 text-caption ${isActive ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
    >
      {showGroupHeaders && <span className="text-mini text-muted-foreground/80">└</span>}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1 text-left"
        onClick={() => onActiveTerminalChange(terminalId)}
      >
        <TerminalSquare className="size-3 shrink-0" />
        <span className="truncate">{terminalLabelById.get(terminalId) ?? 'Terminal'}</span>
      </button>
      {canClose && (
        <Popover>
          <PopoverTrigger
            openOnHover
            render={
              <button
                type="button"
                className="inline-flex size-3.5 items-center justify-center rounded text-xs font-medium leading-none text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
                onClick={() => onCloseTerminal(terminalId)}
                aria-label={closeTerminalLabel}
              />
            }
          >
            <XIcon className="size-2.5" />
          </PopoverTrigger>
          <PopoverPopup
            tooltipStyle
            side="bottom"
            sideOffset={6}
            align="center"
            className="pointer-events-none select-none"
          >
            {closeTerminalLabel}
          </PopoverPopup>
        </Popover>
      )}
    </div>
  )
}

function TerminalGroupItem({
  terminalGroup,
  groupIndex,
  resolvedActiveTerminalId,
  terminalLabelById,
  normalizedTerminalIds,
  showGroupHeaders,
  closeShortcutLabel,
  onActiveTerminalChange,
  onCloseTerminal,
}: TerminalGroupItemProps) {
  const isGroupActive = terminalGroup.terminalIds.includes(resolvedActiveTerminalId)
  const groupActiveTerminalId = isGroupActive
    ? resolvedActiveTerminalId
    : (terminalGroup.terminalIds[0] ?? resolvedActiveTerminalId)
  const canClose = normalizedTerminalIds.length > 1
  return (
    <div className="pb-0.5">
      {showGroupHeaders && (
        <button
          type="button"
          className={`flex w-full items-center rounded px-1 py-0.5 text-mini uppercase tracking-wide ${isGroupActive ? 'bg-accent/70 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'}`}
          onClick={() => onActiveTerminalChange(groupActiveTerminalId)}
        >
          {terminalGroup.terminalIds.length > 1
            ? `Split ${groupIndex + 1}`
            : `Terminal ${groupIndex + 1}`}
        </button>
      )}
      <div className={showGroupHeaders ? 'ml-1 border-l border-border/60 pl-1.5' : ''}>
        {terminalGroup.terminalIds.map(terminalId => (
          <TerminalRow
            key={terminalId}
            terminalId={terminalId}
            isActive={terminalId === resolvedActiveTerminalId}
            showGroupHeaders={showGroupHeaders}
            terminalLabelById={terminalLabelById}
            closeShortcutLabel={closeShortcutLabel}
            canClose={canClose}
            onActiveTerminalChange={onActiveTerminalChange}
            onCloseTerminal={onCloseTerminal}
          />
        ))}
      </div>
    </div>
  )
}

export interface TerminalSidebarProps {
  resolvedTerminalGroups: ThreadTerminalGroup[]
  resolvedActiveTerminalId: string
  terminalLabelById: Map<string, string>
  normalizedTerminalIds: string[]
  showGroupHeaders: boolean
  hasReachedSplitLimit: boolean
  splitTerminalActionLabel: string
  newTerminalActionLabel: string
  closeShortcutLabel: string | undefined
  onSplitTerminalAction: () => void
  onNewTerminalAction: () => void
  onActiveTerminalChange: (terminalId: string) => void
  onCloseTerminal: (terminalId: string) => void
}

export function TerminalSidebar({
  resolvedTerminalGroups,
  resolvedActiveTerminalId,
  terminalLabelById,
  normalizedTerminalIds,
  showGroupHeaders,
  hasReachedSplitLimit,
  splitTerminalActionLabel,
  newTerminalActionLabel,
  closeShortcutLabel,
  onSplitTerminalAction,
  onNewTerminalAction,
  onActiveTerminalChange,
  onCloseTerminal,
}: TerminalSidebarProps) {
  const closeLabel = closeShortcutLabel
    ? `Close Terminal (${closeShortcutLabel})`
    : 'Close Terminal'
  return (
    <aside className="flex w-36 min-w-36 flex-col border border-border/70 bg-muted/10">
      <TerminalSidebarHeader
        hasReachedSplitLimit={hasReachedSplitLimit}
        splitTerminalActionLabel={splitTerminalActionLabel}
        newTerminalActionLabel={newTerminalActionLabel}
        closeLabel={closeLabel}
        onSplitTerminalAction={onSplitTerminalAction}
        onNewTerminalAction={onNewTerminalAction}
        onCloseActive={() => onCloseTerminal(resolvedActiveTerminalId)}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {resolvedTerminalGroups.map((terminalGroup, groupIndex) => (
          <TerminalGroupItem
            key={terminalGroup.id}
            terminalGroup={terminalGroup}
            groupIndex={groupIndex}
            resolvedActiveTerminalId={resolvedActiveTerminalId}
            terminalLabelById={terminalLabelById}
            normalizedTerminalIds={normalizedTerminalIds}
            showGroupHeaders={showGroupHeaders}
            closeShortcutLabel={closeShortcutLabel}
            onActiveTerminalChange={onActiveTerminalChange}
            onCloseTerminal={onCloseTerminal}
          />
        ))}
      </div>
    </aside>
  )
}
