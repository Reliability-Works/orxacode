import type { Dispatch, RefObject, SetStateAction } from 'react'
import { ChevronDown } from 'lucide-react'
import type { GitPanelTab } from './GitSidebarPanel'

type GitSidebarTabDropdownProps = {
  gitTabMenuRef: RefObject<HTMLDivElement | null>
  gitTabMenuOpen: boolean
  gitTabLabels: Record<GitPanelTab, string>
  setGitTabMenuOpen: Dispatch<SetStateAction<boolean>>
  selectGitTab: (tab: GitPanelTab) => void
  currentTab: GitPanelTab
}

export function GitSidebarTabDropdown({
  gitTabMenuRef,
  gitTabMenuOpen,
  gitTabLabels,
  setGitTabMenuOpen,
  selectGitTab,
  currentTab,
}: GitSidebarTabDropdownProps) {
  return (
    <div ref={gitTabMenuRef} className="ops-git-panel-dropdown-wrap">
      <button
        type="button"
        className="ops-git-panel-dropdown-btn"
        onClick={() => setGitTabMenuOpen(value => !value)}
        aria-expanded={gitTabMenuOpen}
        aria-haspopup="menu"
      >
        <span>{gitTabLabels[currentTab]}</span>
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {gitTabMenuOpen ? (
        <div className="ops-git-panel-dropdown-menu" role="menu">
          {(Object.keys(gitTabLabels) as GitPanelTab[]).map(tab => (
            <button
              key={tab}
              type="button"
              role="menuitem"
              className={currentTab === tab ? 'active' : ''}
              onClick={() => selectGitTab(tab)}
            >
              {gitTabLabels[tab]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
