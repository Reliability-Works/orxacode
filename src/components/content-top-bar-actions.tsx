import type { ReactNode } from 'react'
import { ChevronDown, ChevronsUpDown, Play } from 'lucide-react'
import type { CommitNextStep, GitDiffStats } from '../hooks/useGitPanel'
import { IconButton } from './IconButton'
import type {
  ActiveWorkspaceWorktree,
  CustomRunCommandInput,
  CustomRunCommandPreset,
} from './ContentTopBar'
import { RunCommandMenu } from './content-top-bar-run-command-menu'
import { RunCommandModal } from './content-top-bar-run-command-modal'
import { useContentTopBarRunCommands } from './use-content-top-bar-run-commands'

export type OpenTargetOption = {
  id: 'cursor' | 'antigravity' | 'finder' | 'terminal' | 'ghostty' | 'xcode' | 'zed'
  label: string
  logo: string
}

type ContentTopBarActionsProps = {
  hasProjectContext: boolean
  browserSidebarOpen: boolean
  toggleBrowserSidebar: () => void
  terminalOpen: boolean
  showTerminalToggle: boolean
  toggleTerminal: () => Promise<void>
  activeOpenTarget: OpenTargetOption
  openTargets: OpenTargetOption[]
  openMenuOpen: boolean
  setOpenMenuOpen: (open: boolean) => void
  onSelectOpenTarget: (targetID: OpenTargetOption['id']) => void
  onOpenDirectoryInTarget: (targetID: OpenTargetOption['id']) => Promise<void>
  commitMenuOpen: boolean
  setCommitMenuOpen: (open: boolean) => void
  setTitleMenuOpen: (open: boolean) => void
  pendingPrUrl: string | null
  onOpenPendingPullRequest: () => void
  commitNextStepOptions: Array<{ id: CommitNextStep; label: string; icon: ReactNode }>
  setCommitNextStep: (nextStep: CommitNextStep) => void
  openCommitModal: (nextStep?: CommitNextStep) => void
  showGitPane: boolean
  setGitPaneVisible: (visible: boolean) => void
  gitDiffStats: GitDiffStats
  customRunCommands: CustomRunCommandPreset[]
  onUpsertCustomRunCommand: (input: CustomRunCommandInput) => CustomRunCommandPreset
  onRunCustomRunCommand: (command: CustomRunCommandPreset) => Promise<void>
  onDeleteCustomRunCommand: (id: string) => void
  activeWorkspaceWorktree: ActiveWorkspaceWorktree | null
  onOpenWorkspaceDetail: () => void
}

function ContentTopBarRunCommandsControl({
  hasProjectContext,
  customRunCommands,
  onUpsertCustomRunCommand,
  onRunCustomRunCommand,
  onDeleteCustomRunCommand,
  closeOpenMenu,
  closeCommitMenu,
  closeTitleMenu,
}: Pick<
  ContentTopBarActionsProps,
  | 'hasProjectContext'
  | 'customRunCommands'
  | 'onUpsertCustomRunCommand'
  | 'onRunCustomRunCommand'
  | 'onDeleteCustomRunCommand'
> & {
  closeOpenMenu: () => void
  closeCommitMenu: () => void
  closeTitleMenu: () => void
}) {
  const {
    runMenuRootRef,
    runTitleInputRef,
    runMenuOpen,
    runEditorOpen,
    runEditorTitle,
    runEditorCommands,
    runEditorError,
    runEditorSaving,
    sortedRunCommands,
    openRunEditor,
    toggleRunMenu,
    runCommandPreset,
    deleteCommandPreset,
    saveRunEditor,
    setRunEditorOpen,
    setRunEditorError,
    setRunEditorTitle,
    setRunEditorCommands,
  } = useContentTopBarRunCommands({
    customRunCommands,
    onUpsertCustomRunCommand,
    onRunCustomRunCommand,
    onDeleteCustomRunCommand,
    closeOpenMenu,
    closeCommitMenu,
    closeTitleMenu,
  })

  return (
    <div ref={runMenuRootRef} className={`titlebar-run-wrap ${runMenuOpen ? 'open' : ''}`.trim()}>
      <button
        type="button"
        className="titlebar-run-trigger"
        onClick={toggleRunMenu}
        aria-label="Custom run command"
        title="Custom run command"
        disabled={!hasProjectContext}
      >
        <Play size={13} aria-hidden="true" />
      </button>
      <RunCommandMenu
        open={runMenuOpen}
        presets={sortedRunCommands}
        onRun={runCommandPreset}
        onEdit={openRunEditor}
        onDelete={deleteCommandPreset}
        onAdd={() => openRunEditor()}
      />
      <RunCommandModal
        open={runEditorOpen}
        title={runEditorTitle}
        commands={runEditorCommands}
        error={runEditorError}
        saving={runEditorSaving}
        onClose={() => {
          setRunEditorOpen(false)
          setRunEditorError(null)
        }}
        onTitleChange={setRunEditorTitle}
        onCommandsChange={setRunEditorCommands}
        onSave={saveRunEditor}
        titleInputRef={runTitleInputRef}
      />
    </div>
  )
}

function ContentTopBarOpenTargetGroup({
  hasProjectContext,
  activeOpenTarget,
  openTargets,
  openMenuOpen,
  onOpenDirectoryInTarget,
  onSelectOpenTarget,
  setCommitMenuOpen,
  setOpenMenuOpen,
  setTitleMenuOpen,
}: Pick<
  ContentTopBarActionsProps,
  | 'hasProjectContext'
  | 'activeOpenTarget'
  | 'openTargets'
  | 'openMenuOpen'
  | 'onOpenDirectoryInTarget'
  | 'onSelectOpenTarget'
  | 'setCommitMenuOpen'
  | 'setOpenMenuOpen'
  | 'setTitleMenuOpen'
>) {
  return (
    <div className={`titlebar-split titlebar-open ${openMenuOpen ? 'open' : ''}`.trim()}>
      <button
        type="button"
        className="titlebar-action"
        onClick={() => {
          void onOpenDirectoryInTarget(activeOpenTarget.id)
          setCommitMenuOpen(false)
          setTitleMenuOpen(false)
        }}
        disabled={!hasProjectContext}
      >
        <span className="titlebar-action-logo titlebar-action-logo-app">
          <img src={activeOpenTarget.logo} alt="" aria-hidden="true" />
        </span>
        <span>{activeOpenTarget.label}</span>
      </button>
      <button
        type="button"
        className="titlebar-action-arrow"
        onClick={() => {
          setOpenMenuOpen(!openMenuOpen)
          setCommitMenuOpen(false)
          setTitleMenuOpen(false)
        }}
        aria-label="Open in options"
        title="Open in options"
        disabled={!hasProjectContext}
      >
        <ChevronsUpDown size={12} aria-hidden="true" />
      </button>
      {openMenuOpen ? (
        <div className="titlebar-menu">
          <small>Open in</small>
          {openTargets.map(target => (
            <button key={target.id} type="button" onClick={() => onSelectOpenTarget(target.id)}>
              <span className="menu-item-logo menu-item-logo-app">
                <img src={target.logo} alt="" aria-hidden="true" />
              </span>
              <span>{target.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ContentTopBarCommitGroup({
  hasProjectContext,
  commitMenuOpen,
  commitNextStepOptions,
  pendingPrUrl,
  onOpenPendingPullRequest,
  openCommitModal,
  setCommitMenuOpen,
  setCommitNextStep,
  setOpenMenuOpen,
  setTitleMenuOpen,
}: Pick<
  ContentTopBarActionsProps,
  | 'hasProjectContext'
  | 'commitMenuOpen'
  | 'commitNextStepOptions'
  | 'pendingPrUrl'
  | 'onOpenPendingPullRequest'
  | 'openCommitModal'
  | 'setCommitMenuOpen'
  | 'setCommitNextStep'
  | 'setOpenMenuOpen'
  | 'setTitleMenuOpen'
>) {
  return (
    <div className={`titlebar-split titlebar-commit ${commitMenuOpen ? 'open' : ''}`.trim()}>
      <button
        type="button"
        className="titlebar-action titlebar-commit-btn"
        onClick={() => {
          if (pendingPrUrl) {
            onOpenPendingPullRequest()
          } else {
            setCommitMenuOpen(!commitMenuOpen)
            setOpenMenuOpen(false)
            setTitleMenuOpen(false)
          }
        }}
        disabled={!hasProjectContext && !pendingPrUrl}
      >
        <span>{pendingPrUrl ? 'view pr' : 'commit'}</span>
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {commitMenuOpen ? (
        <div className="titlebar-menu">
          <small>Next step</small>
          {commitNextStepOptions.map(option => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setCommitNextStep(option.id)
                openCommitModal(option.id)
              }}
            >
              <span className="menu-item-logo">{option.icon}</span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ContentTopBarWorktreeGroup({
  hasProjectContext,
  activeWorkspaceWorktree,
  onOpenWorkspaceDetail,
}: Pick<
  ContentTopBarActionsProps,
  'hasProjectContext' | 'activeWorkspaceWorktree' | 'onOpenWorkspaceDetail'
>) {
  if (!activeWorkspaceWorktree) {
    return null
  }

  return (
    <button
      type="button"
      className="titlebar-action titlebar-worktree-btn"
      disabled={!hasProjectContext}
      onClick={onOpenWorkspaceDetail}
      title={activeWorkspaceWorktree.directory}
    >
      <span className="titlebar-worktree-label">{activeWorkspaceWorktree.label}</span>
      <small>
        {activeWorkspaceWorktree.branch ??
          (activeWorkspaceWorktree.isMain ? 'main workspace' : 'worktree')}
      </small>
    </button>
  )
}

function ContentTopBarGitToggleGroup({
  gitDiffStats,
  showGitPane,
  setGitPaneVisible,
}: Pick<ContentTopBarActionsProps, 'gitDiffStats' | 'showGitPane' | 'setGitPaneVisible'>) {
  return (
    <div className={`titlebar-git-toggle-group${gitDiffStats.hasChanges ? ' has-changes' : ''}`}>
      {gitDiffStats.hasChanges ? (
        <button
          type="button"
          className="titlebar-action titlebar-git-diff-stats"
          onClick={() => setGitPaneVisible(!showGitPane)}
          aria-label={`Git changes: +${gitDiffStats.additions} -${gitDiffStats.deletions}. Toggle Git sidebar`}
        >
          <span className="added">+{gitDiffStats.additions}</span>
          <span className="removed">-{gitDiffStats.deletions}</span>
        </button>
      ) : null}
      <IconButton
        icon="panelRight"
        label="Toggle Git sidebar"
        className={`titlebar-toggle titlebar-toggle-right ${showGitPane ? 'active' : ''}`.trim()}
        onClick={() => setGitPaneVisible(!showGitPane)}
      />
    </div>
  )
}

export function ContentTopBarActions({
  hasProjectContext,
  browserSidebarOpen,
  toggleBrowserSidebar,
  terminalOpen,
  showTerminalToggle,
  toggleTerminal,
  activeOpenTarget,
  openTargets,
  openMenuOpen,
  setOpenMenuOpen,
  onSelectOpenTarget,
  onOpenDirectoryInTarget,
  commitMenuOpen,
  setCommitMenuOpen,
  setTitleMenuOpen,
  pendingPrUrl,
  onOpenPendingPullRequest,
  commitNextStepOptions,
  setCommitNextStep,
  openCommitModal,
  showGitPane,
  setGitPaneVisible,
  gitDiffStats,
  customRunCommands,
  onUpsertCustomRunCommand,
  onRunCustomRunCommand,
  onDeleteCustomRunCommand,
  activeWorkspaceWorktree,
  onOpenWorkspaceDetail,
}: ContentTopBarActionsProps) {
  return (
    <div className="topbar-right-group">
      <IconButton
        icon="browser"
        label={browserSidebarOpen ? 'Close browser sidebar' : 'Open browser sidebar'}
        className={`titlebar-toggle titlebar-toggle-browser ${browserSidebarOpen ? 'active' : ''}`.trim()}
        onClick={toggleBrowserSidebar}
        disabled={!hasProjectContext}
      />
      {showTerminalToggle ? (
        <IconButton
          icon="terminal"
          label="Toggle terminal"
          className={`titlebar-toggle titlebar-toggle-terminal ${terminalOpen ? 'active' : ''}`.trim()}
          onClick={() => void toggleTerminal()}
        />
      ) : null}
      <ContentTopBarRunCommandsControl
        hasProjectContext={hasProjectContext}
        customRunCommands={customRunCommands}
        onUpsertCustomRunCommand={onUpsertCustomRunCommand}
        onRunCustomRunCommand={onRunCustomRunCommand}
        onDeleteCustomRunCommand={onDeleteCustomRunCommand}
        closeOpenMenu={() => setOpenMenuOpen(false)}
        closeCommitMenu={() => setCommitMenuOpen(false)}
        closeTitleMenu={() => setTitleMenuOpen(false)}
      />
      <ContentTopBarWorktreeGroup
        hasProjectContext={hasProjectContext}
        activeWorkspaceWorktree={activeWorkspaceWorktree}
        onOpenWorkspaceDetail={onOpenWorkspaceDetail}
      />
      <ContentTopBarOpenTargetGroup
        hasProjectContext={hasProjectContext}
        activeOpenTarget={activeOpenTarget}
        openTargets={openTargets}
        openMenuOpen={openMenuOpen}
        onOpenDirectoryInTarget={onOpenDirectoryInTarget}
        onSelectOpenTarget={onSelectOpenTarget}
        setCommitMenuOpen={setCommitMenuOpen}
        setOpenMenuOpen={setOpenMenuOpen}
        setTitleMenuOpen={setTitleMenuOpen}
      />
      <ContentTopBarCommitGroup
        hasProjectContext={hasProjectContext}
        commitMenuOpen={commitMenuOpen}
        commitNextStepOptions={commitNextStepOptions}
        pendingPrUrl={pendingPrUrl}
        onOpenPendingPullRequest={onOpenPendingPullRequest}
        openCommitModal={openCommitModal}
        setCommitMenuOpen={setCommitMenuOpen}
        setCommitNextStep={setCommitNextStep}
        setOpenMenuOpen={setOpenMenuOpen}
        setTitleMenuOpen={setTitleMenuOpen}
      />
      <ContentTopBarGitToggleGroup
        gitDiffStats={gitDiffStats}
        showGitPane={showGitPane}
        setGitPaneVisible={setGitPaneVisible}
      />
    </div>
  )
}
