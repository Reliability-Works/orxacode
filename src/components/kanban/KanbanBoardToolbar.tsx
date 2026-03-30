import { FolderPlus, GitBranch, Link2, MessageSquare, Plus, RefreshCw, Settings } from 'lucide-react'
import type { KanbanProvider } from '@shared/ipc'
import { KanbanDropdown } from './KanbanDropdown'

export function KanbanBoardToolbar(props: {
  activeTab: string
  branchLikeCounts: { trashedCount: number; worktreeCount: number }
  onAddWorkspace: () => void
  onCreateTask: () => void
  onRefresh: () => void
  onSelectTab: (tab: 'board' | 'runs' | 'automations' | 'worktrees' | 'settings' | 'git' | 'management') => void
  providerFilter: 'all' | KanbanProvider
  setProviderFilter: (value: 'all' | KanbanProvider) => void
  refreshing: boolean
  selectedWorkspaceDir: string
  setSelectedWorkspaceDir: (value: string) => void
  showDependencies: boolean
  setShowDependencies: React.Dispatch<React.SetStateAction<boolean>>
  statusFilter: 'all' | string
  setStatusFilter: (value: 'all' | string) => void
  workspaceOptions: Array<{ value: string; label: string }>
}) {
  const { trashedCount, worktreeCount } = props.branchLikeCounts
  return (
    <>
      <div className="kanban-titlebar">
        <h1 className="kanban-title">Orxa KanBan</h1>
      </div>
      <header className="kanban-control-bar">
        <div className="kanban-control-bar-left">
          {props.workspaceOptions.length > 0 ? (
            <KanbanDropdown compact value={props.selectedWorkspaceDir} options={props.workspaceOptions} onChange={props.setSelectedWorkspaceDir} />
          ) : (
            <div className="kanban-empty-workspace-chip" title="No Kanban workspace selected">No workspace</div>
          )}
          <button type="button" className="kanban-icon-btn" title="Add Kanban workspace" onClick={props.onAddWorkspace}>
            <FolderPlus size={14} aria-hidden="true" />
          </button>
          <span className="kanban-control-sep" aria-hidden="true" />
          <nav className="kanban-tabs" aria-label="Kanban view">
            {(['board', 'runs', 'automations', 'worktrees'] as const).map(tab => (
              <button key={tab} type="button" className={`kanban-tab${props.activeTab === tab ? ' active' : ''}`} onClick={() => props.onSelectTab(tab)}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
            <span className="kanban-control-sep" aria-hidden="true" />
            <button type="button" className={`kanban-tab kanban-tab--secondary${props.activeTab === 'settings' ? ' active' : ''}`} onClick={() => props.onSelectTab('settings')} title="Settings"><Settings size={12} aria-hidden="true" /></button>
            <button type="button" className={`kanban-tab kanban-tab--secondary${props.activeTab === 'git' ? ' active' : ''}`} onClick={() => props.onSelectTab('git')} title="Git"><GitBranch size={12} aria-hidden="true" /></button>
            <button type="button" className={`kanban-tab kanban-tab--secondary${props.activeTab === 'management' ? ' active' : ''}`} onClick={() => props.onSelectTab('management')} title="Management"><MessageSquare size={12} aria-hidden="true" /></button>
          </nav>
        </div>
        <div className="kanban-control-bar-right">
          <KanbanDropdown compact value={props.providerFilter} options={[{ value: 'all', label: 'All providers' }, { value: 'opencode', label: 'OpenCode' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude' }]} onChange={props.setProviderFilter} />
          <KanbanDropdown compact value={props.statusFilter} options={[{ value: 'all', label: 'All statuses' }, { value: 'blocked', label: 'Blocked' }, { value: 'idle', label: 'Idle' }, { value: 'running', label: 'Running' }, { value: 'awaiting_review', label: 'Awaiting review' }, { value: 'awaiting_input', label: 'Awaiting input' }, { value: 'completed', label: 'Completed' }, { value: 'failed', label: 'Failed' }, { value: 'stopped', label: 'Stopped' }]} onChange={props.setStatusFilter} />
          <button type="button" className={`kanban-filter-toggle${props.showDependencies ? ' active' : ''}`} onClick={() => props.setShowDependencies(current => !current)} title={props.showDependencies ? 'Hide dependencies' : 'Show dependencies'}>
            <Link2 size={12} aria-hidden="true" />
            Deps
          </button>
          {trashedCount > 0 ? <span className="kanban-meta-badge">{trashedCount} in trash</span> : null}
          {worktreeCount > 0 ? <span className="kanban-meta-badge">{worktreeCount} worktrees</span> : null}
          <span className="kanban-control-sep" aria-hidden="true" />
          <button type="button" className={`kanban-icon-btn${props.refreshing ? ' is-spinning' : ''}`} title="Refresh board" onClick={props.onRefresh}>
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button type="button" className="kanban-primary-btn" onClick={props.onCreateTask}>
            <Plus size={13} aria-hidden="true" />
            New task
          </button>
        </div>
      </header>
    </>
  )
}
