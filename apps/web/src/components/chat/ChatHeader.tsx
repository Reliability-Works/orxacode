import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from '@orxa-code/contracts'
import { memo } from 'react'
import GitActionsControl from '../GitActionsControl'
import { FolderTreeIcon, GitBranchIcon, TerminalSquareIcon } from 'lucide-react'
import { Badge } from '../ui/badge'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import ProjectScriptsControl, { type NewProjectScriptInput } from '../ProjectScriptsControl'
import { Toggle } from '../ui/toggle'
import { OpenInPicker } from './OpenInPicker'
import type { ChatAuxSidebarMode } from './useChatViewLocalState'
import { cn } from '~/lib/utils'

interface ProjectActionProps {
  activeThreadId: ThreadId
  activeProjectName: string | undefined
  activeProjectScripts: ProjectScript[] | undefined
  preferredScriptId: string | null
  keybindings: ResolvedKeybindingsConfig
  availableEditors: ReadonlyArray<EditorId>
  openInCwd: string | null
  gitCwd: string | null
  onRunProjectScript: (script: ProjectScript) => void
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>
  onDeleteProjectScript: (scriptId: string) => Promise<void>
}

interface DiffStats {
  additions: number
  deletions: number
}

interface ChatHeaderProps extends ProjectActionProps {
  activeThreadTitle: string
  isGitRepo: boolean
  terminalAvailable: boolean
  terminalOpen: boolean
  terminalToggleShortcutLabel: string | null
  auxSidebarMode: ChatAuxSidebarMode
  diffStats: DiffStats | null
  onToggleTerminal: () => void
  onToggleGitSidebar: () => void
  onToggleFilesSidebar: () => void
}

function ChatHeaderTitle(props: {
  activeThreadTitle: string
  activeProjectName: string | undefined
  isGitRepo: boolean
}) {
  const { activeThreadTitle, activeProjectName, isGitRepo } = props
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
      <h2
        className="min-w-0 shrink truncate text-sm font-medium text-foreground"
        title={activeThreadTitle}
      >
        {activeThreadTitle}
      </h2>
      {activeProjectName && (
        <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
          <span className="min-w-0 truncate">{activeProjectName}</span>
        </Badge>
      )}
      {activeProjectName && !isGitRepo && (
        <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
          No Git
        </Badge>
      )}
    </div>
  )
}

function HeaderToggleControl(props: {
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

function ChatHeaderProjectActions(props: ProjectActionProps) {
  const {
    activeThreadId,
    activeProjectName,
    activeProjectScripts,
    preferredScriptId,
    keybindings,
    availableEditors,
    openInCwd,
    gitCwd,
    onRunProjectScript,
    onAddProjectScript,
    onUpdateProjectScript,
    onDeleteProjectScript,
  } = props

  return (
    <>
      {activeProjectScripts && (
        <ProjectScriptsControl
          scripts={activeProjectScripts}
          keybindings={keybindings}
          preferredScriptId={preferredScriptId}
          onRunScript={onRunProjectScript}
          onAddScript={onAddProjectScript}
          onUpdateScript={onUpdateProjectScript}
          onDeleteScript={onDeleteProjectScript}
        />
      )}
      {activeProjectName && (
        <OpenInPicker
          keybindings={keybindings}
          availableEditors={availableEditors}
          openInCwd={openInCwd}
        />
      )}
      {activeProjectName && <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />}
    </>
  )
}

function GitSidebarBadge({ stats }: { stats: DiffStats | null }) {
  if (!stats || (stats.additions === 0 && stats.deletions === 0)) return null
  return (
    <span className="pointer-events-none absolute -right-1 -top-1 flex items-center gap-px rounded-full bg-background px-0.5 font-mono text-[8px] leading-none">
      {stats.additions > 0 && <span className="text-success">+{stats.additions}</span>}
      {stats.deletions > 0 && <span className="text-destructive">-{stats.deletions}</span>}
    </span>
  )
}

function FilesSidebarToggle(props: {
  filesAvailable: boolean
  filesSidebarOpen: boolean
  onToggleFilesSidebar: () => void
}) {
  const { filesAvailable, filesSidebarOpen, onToggleFilesSidebar } = props
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className={cn('relative shrink-0', !filesAvailable && 'opacity-50')}
            pressed={filesSidebarOpen}
            onPressedChange={onToggleFilesSidebar}
            aria-label="Toggle files sidebar"
            variant="outline"
            size="xs"
            disabled={!filesAvailable}
          >
            <FolderTreeIcon className="size-3" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {!filesAvailable
          ? 'Files unavailable until this thread has an active project.'
          : 'Toggle files sidebar'}
      </TooltipPopup>
    </Tooltip>
  )
}

function GitSidebarToggle(props: {
  isGitRepo: boolean
  gitSidebarOpen: boolean
  onToggleGitSidebar: () => void
  diffStats: DiffStats | null
}) {
  const { isGitRepo, gitSidebarOpen, onToggleGitSidebar, diffStats } = props
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className={cn('relative shrink-0', !isGitRepo && 'opacity-50')}
            pressed={gitSidebarOpen}
            onPressedChange={onToggleGitSidebar}
            aria-label="Toggle git sidebar"
            variant="outline"
            size="xs"
            disabled={!isGitRepo}
          >
            <GitBranchIcon className="size-3" />
            <GitSidebarBadge stats={isGitRepo ? diffStats : null} />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {!isGitRepo ? 'Git unavailable — not a git repository' : 'Toggle git sidebar'}
      </TooltipPopup>
    </Tooltip>
  )
}

function ChatHeaderToggleActions(props: {
  terminalOpen: boolean
  onToggleTerminal: () => void
  terminalAvailable: boolean
  terminalToggleLabel: string
  auxSidebarMode: ChatAuxSidebarMode
  onToggleGitSidebar: () => void
  onToggleFilesSidebar: () => void
  isGitRepo: boolean
  filesAvailable: boolean
  diffStats: DiffStats | null
}) {
  const {
    terminalOpen,
    onToggleTerminal,
    terminalAvailable,
    terminalToggleLabel,
    auxSidebarMode,
    onToggleGitSidebar,
    onToggleFilesSidebar,
    isGitRepo,
    filesAvailable,
    diffStats,
  } = props
  return (
    <>
      <HeaderToggleControl
        pressed={terminalOpen}
        onToggle={onToggleTerminal}
        disabled={!terminalAvailable}
        ariaLabel="Toggle terminal drawer"
        icon={TerminalSquareIcon}
        tooltipLabel={terminalToggleLabel}
      />
      <FilesSidebarToggle
        filesAvailable={filesAvailable}
        filesSidebarOpen={auxSidebarMode === 'files'}
        onToggleFilesSidebar={onToggleFilesSidebar}
      />
      <GitSidebarToggle
        isGitRepo={isGitRepo}
        gitSidebarOpen={auxSidebarMode === 'git'}
        onToggleGitSidebar={onToggleGitSidebar}
        diffStats={diffStats}
      />
    </>
  )
}

interface ChatHeaderActionsProps extends ProjectActionProps {
  terminalAvailable: boolean
  terminalOpen: boolean
  terminalToggleLabel: string
  auxSidebarMode: ChatAuxSidebarMode
  diffStats: DiffStats | null
  isGitRepo: boolean
  onToggleTerminal: () => void
  onToggleGitSidebar: () => void
  onToggleFilesSidebar: () => void
}

function ChatHeaderActions(props: ChatHeaderActionsProps) {
  const {
    activeThreadId,
    activeProjectName,
    activeProjectScripts,
    preferredScriptId,
    keybindings,
    availableEditors,
    openInCwd,
    gitCwd,
    terminalAvailable,
    terminalOpen,
    terminalToggleLabel,
    auxSidebarMode,
    diffStats,
    isGitRepo,
    onRunProjectScript,
    onAddProjectScript,
    onUpdateProjectScript,
    onDeleteProjectScript,
    onToggleTerminal,
    onToggleGitSidebar,
    onToggleFilesSidebar,
  } = props

  return (
    <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
      <ChatHeaderProjectActions
        activeThreadId={activeThreadId}
        activeProjectName={activeProjectName}
        activeProjectScripts={activeProjectScripts}
        preferredScriptId={preferredScriptId}
        keybindings={keybindings}
        availableEditors={availableEditors}
        openInCwd={openInCwd}
        gitCwd={gitCwd}
        onRunProjectScript={onRunProjectScript}
        onAddProjectScript={onAddProjectScript}
        onUpdateProjectScript={onUpdateProjectScript}
        onDeleteProjectScript={onDeleteProjectScript}
      />
      <ChatHeaderToggleActions
        terminalOpen={terminalOpen}
        onToggleTerminal={onToggleTerminal}
        terminalAvailable={terminalAvailable}
        terminalToggleLabel={terminalToggleLabel}
        auxSidebarMode={auxSidebarMode}
        onToggleGitSidebar={onToggleGitSidebar}
        onToggleFilesSidebar={onToggleFilesSidebar}
        isGitRepo={isGitRepo}
        filesAvailable={openInCwd !== null}
        diffStats={diffStats}
      />
    </div>
  )
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  gitCwd,
  auxSidebarMode,
  diffStats,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleGitSidebar,
  onToggleFilesSidebar,
}: ChatHeaderProps) {
  const terminalToggleLabel = !terminalAvailable
    ? 'Terminal is unavailable until this thread has an active project.'
    : terminalToggleShortcutLabel
      ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
      : 'Toggle terminal drawer'

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <ChatHeaderTitle
        activeThreadTitle={activeThreadTitle}
        activeProjectName={activeProjectName}
        isGitRepo={isGitRepo}
      />
      <ChatHeaderActions
        activeThreadId={activeThreadId}
        activeProjectName={activeProjectName}
        activeProjectScripts={activeProjectScripts}
        preferredScriptId={preferredScriptId}
        keybindings={keybindings}
        availableEditors={availableEditors}
        openInCwd={openInCwd}
        gitCwd={gitCwd}
        terminalAvailable={terminalAvailable}
        terminalOpen={terminalOpen}
        terminalToggleLabel={terminalToggleLabel}
        auxSidebarMode={auxSidebarMode}
        diffStats={diffStats}
        isGitRepo={isGitRepo}
        onRunProjectScript={onRunProjectScript}
        onAddProjectScript={onAddProjectScript}
        onUpdateProjectScript={onUpdateProjectScript}
        onDeleteProjectScript={onDeleteProjectScript}
        onToggleTerminal={onToggleTerminal}
        onToggleGitSidebar={onToggleGitSidebar}
        onToggleFilesSidebar={onToggleFilesSidebar}
      />
    </div>
  )
})
