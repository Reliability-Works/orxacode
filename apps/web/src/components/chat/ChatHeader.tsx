import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from '@orxa-code/contracts'
import { memo } from 'react'
import GitActionsControl from '../GitActionsControl'
import {
  FolderTreeIcon,
  GitBranchIcon,
  GlobeIcon,
  TerminalSquareIcon,
} from 'lucide-react'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import ProjectScriptsControl, { type NewProjectScriptInput } from '../ProjectScriptsControl'
import { Toggle } from '../ui/toggle'
import { OpenInPicker } from './OpenInPicker'
import type { ChatAuxSidebarMode } from './useChatViewLocalState'
import { cn } from '~/lib/utils'
import type { ReactNode } from 'react'

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
  handoffAction?: ReactNode
}

interface DiffStats {
  additions: number
  deletions: number
}

interface ChatHeaderProps extends ProjectActionProps {
  activeThreadTitle: string
  isGitRepo: boolean
  browserAvailable: boolean
  terminalAvailable: boolean
  terminalOpen: boolean
  terminalToggleShortcutLabel: string | null
  auxSidebarMode: ChatAuxSidebarMode
  diffStats: DiffStats | null
  onToggleTerminal: () => void
  onToggleGitSidebar: () => void
  onToggleFilesSidebar: () => void
  onToggleBrowserSidebar: () => void
  splitActions?: ReactNode
  handoffAction?: ReactNode
  threadActionsMenu?: ReactNode
}

function ChatHeaderTitle(props: {
  activeThreadTitle: string
  activeProjectName: string | undefined
  isGitRepo: boolean
  threadActionsMenu?: ReactNode
}) {
  const { activeThreadTitle, activeProjectName, isGitRepo, threadActionsMenu } = props
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
      <h2
        className="min-w-0 shrink truncate text-sm font-medium text-foreground"
        title={activeThreadTitle}
      >
        {activeThreadTitle}
      </h2>
      {threadActionsMenu}
      {activeProjectName && !isGitRepo ? (
        <span className="shrink-0 rounded-full border border-amber-500/30 px-2 py-0.5 text-[10px] text-amber-700">
          No Git
        </span>
      ) : null}
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
    handoffAction,
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
      {handoffAction}
    </>
  )
}

function GitSidebarDiffLabel({ stats }: { stats: DiffStats | null }) {
  if (!stats || (stats.additions === 0 && stats.deletions === 0)) return null
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] leading-none">
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
  const hasDiff = Boolean(diffStats && (diffStats.additions > 0 || diffStats.deletions > 0))
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className={cn(
              'shrink-0',
              hasDiff && 'px-2.5',
              !isGitRepo && 'opacity-50'
            )}
            pressed={gitSidebarOpen}
            onPressedChange={onToggleGitSidebar}
            aria-label="Toggle git sidebar"
            variant="outline"
            size="xs"
            disabled={!isGitRepo}
          >
            {hasDiff ? <GitSidebarDiffLabel stats={isGitRepo ? diffStats : null} /> : null}
            <GitBranchIcon className="size-3" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {!isGitRepo ? 'Git unavailable — not a git repository' : 'Toggle git sidebar'}
      </TooltipPopup>
    </Tooltip>
  )
}

function BrowserSidebarToggle(props: {
  browserAvailable: boolean
  browserSidebarOpen: boolean
  onToggleBrowserSidebar: () => void
}) {
  const { browserAvailable, browserSidebarOpen, onToggleBrowserSidebar } = props
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className={cn('relative shrink-0', !browserAvailable && 'opacity-50')}
            pressed={browserSidebarOpen}
            onPressedChange={onToggleBrowserSidebar}
            aria-label="Toggle browser sidebar"
            variant="outline"
            size="xs"
            disabled={!browserAvailable}
          >
            <GlobeIcon className="size-3" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {!browserAvailable
          ? 'Browser unavailable until this thread has an active project in the desktop app.'
          : 'Toggle browser sidebar'}
      </TooltipPopup>
    </Tooltip>
  )
}

function ChatHeaderSidebarActions(props: {
  auxSidebarMode: ChatAuxSidebarMode
  onToggleGitSidebar: () => void
  onToggleFilesSidebar: () => void
  onToggleBrowserSidebar: () => void
  isGitRepo: boolean
  filesAvailable: boolean
  browserAvailable: boolean
  diffStats: DiffStats | null
}) {
  const {
    auxSidebarMode,
    onToggleGitSidebar,
    onToggleFilesSidebar,
    onToggleBrowserSidebar,
    isGitRepo,
    filesAvailable,
    browserAvailable,
    diffStats,
  } = props
  return (
    <>
      <FilesSidebarToggle
        filesAvailable={filesAvailable}
        filesSidebarOpen={auxSidebarMode === 'files'}
        onToggleFilesSidebar={onToggleFilesSidebar}
      />
      <BrowserSidebarToggle
        browserAvailable={browserAvailable}
        browserSidebarOpen={auxSidebarMode === 'browser'}
        onToggleBrowserSidebar={onToggleBrowserSidebar}
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
  browserAvailable: boolean
  terminalAvailable: boolean
  terminalOpen: boolean
  terminalToggleLabel: string
  auxSidebarMode: ChatAuxSidebarMode
  diffStats: DiffStats | null
  isGitRepo: boolean
  onToggleTerminal: () => void
  onToggleGitSidebar: () => void
  onToggleFilesSidebar: () => void
  onToggleBrowserSidebar: () => void
  splitActions?: ReactNode
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
    browserAvailable,
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
    onToggleBrowserSidebar,
    splitActions,
    handoffAction,
  } = props

  return (
    <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
      <HeaderToggleControl
        pressed={terminalOpen}
        onToggle={onToggleTerminal}
        disabled={!terminalAvailable}
        ariaLabel="Toggle terminal drawer"
        icon={TerminalSquareIcon}
        tooltipLabel={terminalToggleLabel}
      />
      {splitActions}
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
        handoffAction={handoffAction}
      />
      <ChatHeaderSidebarActions
        auxSidebarMode={auxSidebarMode}
        onToggleGitSidebar={onToggleGitSidebar}
        onToggleFilesSidebar={onToggleFilesSidebar}
        onToggleBrowserSidebar={onToggleBrowserSidebar}
        isGitRepo={isGitRepo}
        filesAvailable={openInCwd !== null}
        browserAvailable={browserAvailable}
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
  browserAvailable,
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
  onToggleBrowserSidebar,
  splitActions,
  handoffAction,
  threadActionsMenu,
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
        threadActionsMenu={threadActionsMenu}
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
        browserAvailable={browserAvailable}
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
        onToggleBrowserSidebar={onToggleBrowserSidebar}
        splitActions={splitActions}
        handoffAction={handoffAction}
      />
    </div>
  )
})
