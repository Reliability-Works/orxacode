import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from '@orxa-code/contracts'
import { memo } from 'react'
import GitActionsControl from '../GitActionsControl'
import { FolderTreeIcon, GitBranchIcon, GlobeIcon, TerminalSquareIcon } from 'lucide-react'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import ProjectScriptsControl, { type NewProjectScriptInput } from '../ProjectScriptsControl'
import { Toggle } from '../ui/toggle'
import { OpenInPicker } from './OpenInPicker'
import type { ChatAuxSidebarMode } from './useChatViewLocalState'
import { cn } from '~/lib/utils'
import type { ReactNode } from 'react'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { useSidebar } from '../ui/sidebar.shared'
import { ChatHeaderMobileActions } from './ChatHeaderMobileActions'
import { ChatHeaderToggleControl } from './ChatHeaderToggleControl'

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
  onSelectChatView: () => void
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
            className={cn('shrink-0', hasDiff && 'px-2.5', !isGitRepo && 'opacity-50')}
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
  onSelectChatView: () => void
  splitActions?: ReactNode
}

function ChatHeaderDesktopActions(
  props: Omit<ChatHeaderActionsProps, 'splitActions'> & {
    splitActions?: ReactNode
  }
) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
      <ChatHeaderToggleControl
        pressed={props.terminalOpen}
        onToggle={props.onToggleTerminal}
        disabled={!props.terminalAvailable}
        ariaLabel="Toggle terminal drawer"
        icon={TerminalSquareIcon}
        tooltipLabel={props.terminalToggleLabel}
      />
      {props.splitActions}
      <ChatHeaderProjectActions
        activeThreadId={props.activeThreadId}
        activeProjectName={props.activeProjectName}
        activeProjectScripts={props.activeProjectScripts}
        preferredScriptId={props.preferredScriptId}
        keybindings={props.keybindings}
        availableEditors={props.availableEditors}
        openInCwd={props.openInCwd}
        gitCwd={props.gitCwd}
        onRunProjectScript={props.onRunProjectScript}
        onAddProjectScript={props.onAddProjectScript}
        onUpdateProjectScript={props.onUpdateProjectScript}
        onDeleteProjectScript={props.onDeleteProjectScript}
        handoffAction={props.handoffAction}
      />
      <ChatHeaderSidebarActions
        auxSidebarMode={props.auxSidebarMode}
        onToggleGitSidebar={props.onToggleGitSidebar}
        onToggleFilesSidebar={props.onToggleFilesSidebar}
        onToggleBrowserSidebar={props.onToggleBrowserSidebar}
        isGitRepo={props.isGitRepo}
        filesAvailable={props.openInCwd !== null}
        browserAvailable={props.browserAvailable}
        diffStats={props.diffStats}
      />
    </div>
  )
}

function ChatHeaderActions(props: ChatHeaderActionsProps) {
  const isMobile = useIsMobile()
  const { openMobile, setOpenMobile } = useSidebar()

  if (isMobile) {
    const activeView = openMobile
      ? 'threads'
      : props.auxSidebarMode === 'files' || props.auxSidebarMode === 'git'
        ? props.auxSidebarMode
        : 'chat'
    return (
      <ChatHeaderMobileActions
        activeView={activeView}
        filesAvailable={props.openInCwd !== null}
        isGitRepo={props.isGitRepo}
        terminalAvailable={props.terminalAvailable}
        terminalOpen={props.terminalOpen}
        terminalToggleLabel={props.terminalToggleLabel}
        onOpenThreads={() => setOpenMobile(true)}
        onSelectChat={props.onSelectChatView}
        onSelectFiles={props.onToggleFilesSidebar}
        onSelectGit={props.onToggleGitSidebar}
        onToggleTerminal={props.onToggleTerminal}
      />
    )
  }

  return <ChatHeaderDesktopActions {...props} />
}

function resolveTerminalToggleLabel(
  terminalAvailable: boolean,
  terminalToggleShortcutLabel: string | null
) {
  if (!terminalAvailable) {
    return 'Terminal is unavailable until this thread has an active project.'
  }
  if (terminalToggleShortcutLabel) {
    return `Toggle terminal drawer (${terminalToggleShortcutLabel})`
  }
  return 'Toggle terminal drawer'
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
  onSelectChatView,
  splitActions,
  handoffAction,
  threadActionsMenu,
}: ChatHeaderProps) {
  const terminalToggleLabel = resolveTerminalToggleLabel(
    terminalAvailable,
    terminalToggleShortcutLabel
  )
  const isMobile = useIsMobile()

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <ChatHeaderTitle
        activeThreadTitle={activeThreadTitle}
        activeProjectName={activeProjectName}
        isGitRepo={isGitRepo}
        threadActionsMenu={!isMobile ? threadActionsMenu : undefined}
      />
      {isMobile ? threadActionsMenu : null}
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
        onSelectChatView={onSelectChatView}
        splitActions={splitActions}
        handoffAction={handoffAction}
      />
    </div>
  )
})
