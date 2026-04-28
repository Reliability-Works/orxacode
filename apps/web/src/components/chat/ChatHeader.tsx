import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from '@orxa-code/contracts'
import { memo } from 'react'
import GitActionsControl from '../GitActionsControl'
import type { WorktreeParentContext } from '../GitActionsControl.logic'
import { GitBranchIcon } from 'lucide-react'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import type { NewProjectScriptInput } from '../ProjectScriptsControl'
import { Toggle } from '../ui/toggle'
import { OpenInPicker } from './OpenInPicker'
import type { ChatAuxSidebarMode } from './useChatViewLocalState'
import { cn } from '~/lib/utils'
import type { ReactNode } from 'react'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { useSidebar } from '../ui/sidebar.shared'
import { ZenGate } from '../ZenGate'
import { ChatHeaderMobileViewToggle } from './ChatHeaderMobileActions'
import { ChatHeaderViewsGroup } from './ChatHeaderViewsGroup'

interface ProjectActionProps {
  activeThreadId: ThreadId
  activeProjectName: string | undefined
  activeProjectScripts: ProjectScript[] | undefined
  preferredScriptId: string | null
  keybindings: ResolvedKeybindingsConfig
  availableEditors: ReadonlyArray<EditorId>
  openInCwd: string | null
  gitCwd: string | null
  worktreeParent: WorktreeParentContext | null
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
  auxSidebarMode: ChatAuxSidebarMode
  diffStats: DiffStats | null
  onToggleGitSidebar: () => void
  onToggleFilesSidebar: () => void
  onToggleBrowserSidebar: () => void
  onSelectChatView: () => void
  handoffAction?: ReactNode
  threadActionsMenu?: ReactNode
  /**
   * When true, the active thread is a Chats-feature thread (project lives under
   * the chat base dir). Hides the No-Git pill and the entire action cluster
   * (open-in, git actions, handoff, files/browser/git toggles) — chat threads
   * don't expose project-oriented affordances.
   */
  isChatThread?: boolean
}

function ChatHeaderTitle(props: {
  activeThreadTitle: string
  activeProjectName: string | undefined
  isGitRepo: boolean
  isChatThread: boolean
  threadActionsMenu?: ReactNode
  leadingControl?: ReactNode
}) {
  const {
    activeThreadTitle,
    activeProjectName,
    isGitRepo,
    isChatThread,
    threadActionsMenu,
    leadingControl,
  } = props
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
      {leadingControl}
      <h2
        className="min-w-0 shrink truncate text-sm font-medium text-foreground"
        title={activeThreadTitle}
      >
        {activeThreadTitle}
      </h2>
      {threadActionsMenu}
      {!isChatThread && activeProjectName && !isGitRepo ? (
        <span className="shrink-0 rounded-full border border-amber-500/30 px-2 py-0.5 text-mini text-amber-700">
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
    keybindings,
    availableEditors,
    openInCwd,
    gitCwd,
    worktreeParent,
    handoffAction,
  } = props

  return (
    <>
      {activeProjectName && (
        <ZenGate id="chat.openIn">
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        </ZenGate>
      )}
      {activeProjectName && (
        <ZenGate id="chat.gitActions">
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadId={activeThreadId}
            worktreeParent={worktreeParent}
          />
        </ZenGate>
      )}
      {handoffAction ? <ZenGate id="chat.handoff">{handoffAction}</ZenGate> : null}
    </>
  )
}

function GitSidebarDiffLabel({ stats }: { stats: DiffStats | null }) {
  if (!stats || (stats.additions === 0 && stats.deletions === 0)) return null
  return (
    <span className="flex items-center gap-1 font-mono text-mini leading-none">
      {stats.additions > 0 && <span className="text-success">+{stats.additions}</span>}
      {stats.deletions > 0 && <span className="text-destructive">-{stats.deletions}</span>}
    </span>
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

function ChatHeaderSidebarActions(props: {
  auxSidebarMode: ChatAuxSidebarMode
  onToggleGitSidebar: () => void
  isGitRepo: boolean
  diffStats: DiffStats | null
}) {
  const { auxSidebarMode, onToggleGitSidebar, isGitRepo, diffStats } = props
  return (
    <ZenGate id="chat.gitSidebarToggle">
      <GitSidebarToggle
        isGitRepo={isGitRepo}
        gitSidebarOpen={auxSidebarMode === 'git'}
        onToggleGitSidebar={onToggleGitSidebar}
        diffStats={diffStats}
      />
    </ZenGate>
  )
}

interface ChatHeaderActionsProps extends ProjectActionProps {
  browserAvailable: boolean
  auxSidebarMode: ChatAuxSidebarMode
  diffStats: DiffStats | null
  isGitRepo: boolean
  onToggleGitSidebar: () => void
  onToggleFilesSidebar: () => void
  onToggleBrowserSidebar: () => void
  onSelectChatView: () => void
}

function ChatHeaderDesktopActions(props: ChatHeaderActionsProps) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
      <ZenGate id="chat.views">
        <ChatHeaderViewsGroup
          auxSidebarMode={props.auxSidebarMode}
          filesAvailable={props.openInCwd !== null}
          browserAvailable={props.browserAvailable}
          onToggleFilesSidebar={props.onToggleFilesSidebar}
          onToggleBrowserSidebar={props.onToggleBrowserSidebar}
        />
      </ZenGate>
      <ChatHeaderProjectActions
        activeThreadId={props.activeThreadId}
        activeProjectName={props.activeProjectName}
        activeProjectScripts={props.activeProjectScripts}
        preferredScriptId={props.preferredScriptId}
        keybindings={props.keybindings}
        availableEditors={props.availableEditors}
        openInCwd={props.openInCwd}
        gitCwd={props.gitCwd}
        worktreeParent={props.worktreeParent}
        onRunProjectScript={props.onRunProjectScript}
        onAddProjectScript={props.onAddProjectScript}
        onUpdateProjectScript={props.onUpdateProjectScript}
        onDeleteProjectScript={props.onDeleteProjectScript}
        handoffAction={props.handoffAction}
      />
      <ChatHeaderSidebarActions
        auxSidebarMode={props.auxSidebarMode}
        onToggleGitSidebar={props.onToggleGitSidebar}
        isGitRepo={props.isGitRepo}
        diffStats={props.diffStats}
      />
    </div>
  )
}

function ChatHeaderActions(props: ChatHeaderActionsProps) {
  const isMobile = useIsMobile()
  if (isMobile) return null
  return <ChatHeaderDesktopActions {...props} />
}

function useMobileHeaderNavigationControl(params: {
  isMobile: boolean
  isChatThread: boolean
  auxSidebarMode: ChatAuxSidebarMode
  openInCwd: string | null
  isGitRepo: boolean
  onSelectChatView: () => void
  onToggleFilesSidebar: () => void
  onToggleGitSidebar: () => void
}) {
  const { openMobile, setOpenMobile } = useSidebar()
  const activeMobileView = openMobile
    ? 'threads'
    : params.auxSidebarMode === 'files' || params.auxSidebarMode === 'git'
      ? params.auxSidebarMode
      : 'chat'

  if (!params.isMobile || params.isChatThread) return null

  return (
    <ChatHeaderMobileViewToggle
      activeView={activeMobileView}
      filesAvailable={params.openInCwd !== null}
      isGitRepo={params.isGitRepo}
      onOpenThreads={() => setOpenMobile(true)}
      onSelectChat={params.onSelectChatView}
      onSelectFiles={params.onToggleFilesSidebar}
      onSelectGit={params.onToggleGitSidebar}
    />
  )
}

function buildChatHeaderActionsProps(props: ChatHeaderProps): ChatHeaderActionsProps {
  return {
    activeThreadId: props.activeThreadId,
    activeProjectName: props.activeProjectName,
    activeProjectScripts: props.activeProjectScripts,
    preferredScriptId: props.preferredScriptId,
    keybindings: props.keybindings,
    availableEditors: props.availableEditors,
    openInCwd: props.openInCwd,
    gitCwd: props.gitCwd,
    worktreeParent: props.worktreeParent,
    browserAvailable: props.browserAvailable,
    auxSidebarMode: props.auxSidebarMode,
    diffStats: props.diffStats,
    isGitRepo: props.isGitRepo,
    onRunProjectScript: props.onRunProjectScript,
    onAddProjectScript: props.onAddProjectScript,
    onUpdateProjectScript: props.onUpdateProjectScript,
    onDeleteProjectScript: props.onDeleteProjectScript,
    onToggleGitSidebar: props.onToggleGitSidebar,
    onToggleFilesSidebar: props.onToggleFilesSidebar,
    onToggleBrowserSidebar: props.onToggleBrowserSidebar,
    onSelectChatView: props.onSelectChatView,
    handoffAction: props.handoffAction,
  }
}

function ChatHeaderBody(props: {
  activeThreadTitle: string
  activeProjectName: string | undefined
  isGitRepo: boolean
  isChatThread: boolean
  isMobile: boolean
  threadActionsMenu?: ReactNode
  mobileNavigationControl: ReactNode
  actionCluster: ReactNode
}) {
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <ChatHeaderTitle
        activeThreadTitle={props.activeThreadTitle}
        activeProjectName={props.activeProjectName}
        isGitRepo={props.isGitRepo}
        isChatThread={props.isChatThread}
        threadActionsMenu={!props.isMobile ? props.threadActionsMenu : undefined}
        leadingControl={props.mobileNavigationControl}
      />
      {props.isMobile ? props.threadActionsMenu : null}
      {props.isChatThread ? null : props.actionCluster}
    </div>
  )
}

export const ChatHeader = memo(function ChatHeader(props: ChatHeaderProps) {
  const isMobile = useIsMobile()
  const mobileNavigationControl = useMobileHeaderNavigationControl({
    isMobile,
    isChatThread: props.isChatThread ?? false,
    auxSidebarMode: props.auxSidebarMode,
    openInCwd: props.openInCwd,
    isGitRepo: props.isGitRepo,
    onSelectChatView: props.onSelectChatView,
    onToggleFilesSidebar: props.onToggleFilesSidebar,
    onToggleGitSidebar: props.onToggleGitSidebar,
  })
  const actionProps = buildChatHeaderActionsProps(props)
  const actionCluster = <ChatHeaderActions {...actionProps} />

  return (
    <ChatHeaderBody
      activeThreadTitle={props.activeThreadTitle}
      activeProjectName={props.activeProjectName}
      isGitRepo={props.isGitRepo}
      isChatThread={props.isChatThread ?? false}
      isMobile={isMobile}
      threadActionsMenu={props.threadActionsMenu}
      mobileNavigationControl={mobileNavigationControl}
      actionCluster={actionCluster}
    />
  )
})
