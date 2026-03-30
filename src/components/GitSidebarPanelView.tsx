import { PanelRightClose } from 'lucide-react'
import type { GitDiffViewMode } from '../hooks/useGitPanel'
import type { GitPanelTab, SidebarPanelTab } from './GitSidebarPanel'
import { GitSidebarDiffPanel } from './GitSidebarDiffPanel'
import { GitSidebarTabDropdown } from './GitSidebarTabDropdown'
import type { GitSidebarPanelModel } from './useGitSidebarPanelModel'

type GitSidebarPanelViewProps = {
  model: GitSidebarPanelModel
  sidebarPanelTab: SidebarPanelTab
  setSidebarPanelTab: (tab: SidebarPanelTab) => void
  gitPanelTab: GitPanelTab
  gitDiffViewMode: GitDiffViewMode
  setGitDiffViewMode: (mode: GitDiffViewMode) => void
  onCollapse?: () => void
}

function GitSidebarConsolePanel({
  model,
  gitPanelTab,
}: {
  model: GitSidebarPanelModel
  gitPanelTab: GitPanelTab
}) {
  return (
    <div className="git-files-panel">
      <div className="git-files-actions">
        <GitSidebarTabDropdown
          gitTabMenuRef={model.gitTabMenuRef}
          gitTabMenuOpen={model.gitTabMenuOpen}
          gitTabLabels={model.gitTabLabels}
          setGitTabMenuOpen={model.setGitTabMenuOpen}
          selectGitTab={model.selectGitTab}
          currentTab={gitPanelTab}
        />
      </div>
      <pre className="ops-console">{model.gitPanelOutput}</pre>
    </div>
  )
}

function GitSidebarTopTabs({
  sidebarPanelTab,
  setSidebarPanelTab,
  onCollapse,
}: Pick<GitSidebarPanelViewProps, 'sidebarPanelTab' | 'setSidebarPanelTab' | 'onCollapse'>) {
  return (
    <div className="ops-panel-tabs">
      <div className="ops-panel-tab-pills">
        <button
          type="button"
          className={`ops-panel-tab ${sidebarPanelTab === 'git' ? 'active' : ''}`.trim()}
          onClick={() => setSidebarPanelTab('git')}
          aria-label="Git"
          title="Git"
        >
          <span className="ops-panel-tab-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
              <circle cx="7" cy="6" r="2.2" />
              <circle cx="17" cy="12" r="2.2" />
              <circle cx="7" cy="18" r="2.2" />
              <path d="M8.9 7.3 15 10.7" />
              <path d="M8.9 16.7 15 13.3" />
            </svg>
          </span>
        </button>
        <button
          type="button"
          className={`ops-panel-tab ${sidebarPanelTab === 'files' ? 'active' : ''}`.trim()}
          onClick={() => setSidebarPanelTab('files')}
          aria-label="Files"
          title="Files"
        >
          <span className="ops-panel-tab-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width={16} height={16}>
              <path d="M3.5 6.5A2.5 2.5 0 0 1 6 4h4l2 2h6a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 18 20H6A2.5 2.5 0 0 1 3.5 17.5z" />
            </svg>
          </span>
        </button>
      </div>
      {onCollapse ? (
        <button
          type="button"
          className="ops-panel-collapse"
          onClick={onCollapse}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <PanelRightClose size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}

export function GitSidebarPanelView({
  model,
  sidebarPanelTab,
  setSidebarPanelTab,
  gitPanelTab,
  gitDiffViewMode,
  setGitDiffViewMode,
  onCollapse,
}: GitSidebarPanelViewProps) {
  return (
    <section className="ops-section ops-section-fill">
      <GitSidebarTopTabs
        sidebarPanelTab={sidebarPanelTab}
        setSidebarPanelTab={setSidebarPanelTab}
        onCollapse={onCollapse}
      />

      {sidebarPanelTab === 'git' ? (
        gitPanelTab === 'diff' ? (
          <GitSidebarDiffPanel
            model={model}
            gitDiffViewMode={gitDiffViewMode}
            setGitDiffViewMode={setGitDiffViewMode}
          />
        ) : (
          <GitSidebarConsolePanel model={model} gitPanelTab={gitPanelTab} />
        )
      ) : null}
    </section>
  )
}
