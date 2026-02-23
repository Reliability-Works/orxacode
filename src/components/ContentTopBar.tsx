import type { ReactNode } from "react";
import { Archive, ChevronsUpDown, Copy, Ellipsis, Fingerprint, GitCommitHorizontal, Pencil, Pin, PinOff } from "lucide-react";
import type { ProjectData } from "../hooks/useDashboards";
import type { CommitNextStep, GitDiffStats } from "../hooks/useGitPanel";
import { IconButton } from "./IconButton";

type OpenTargetOption = {
  id: "cursor" | "antigravity" | "finder" | "terminal" | "ghostty" | "xcode" | "zed";
  label: string;
  logo: string;
};

type ContentTopBarProps = {
  projectsPaneVisible: boolean;
  toggleProjectsPane: () => void;
  showGitPane: boolean;
  setGitPaneVisible: (visible: boolean) => void;
  gitDiffStats: GitDiffStats;
  contentPaneTitle: string;
  showingProjectDashboard: boolean;
  activeProjectDir: string | null;
  projectData: ProjectData | null;
  terminalOpen: boolean;
  toggleTerminal: () => Promise<void>;
  titleMenuOpen: boolean;
  openMenuOpen: boolean;
  setOpenMenuOpen: (open: boolean) => void;
  commitMenuOpen: boolean;
  setCommitMenuOpen: (open: boolean) => void;
  setTitleMenuOpen: (open: boolean) => void;
  hasActiveSession: boolean;
  isActiveSessionPinned: boolean;
  onTogglePinSession: () => void;
  onRenameSession: () => void;
  onArchiveSession: () => void;
  onCopyPath: () => void;
  onCopySessionId: () => void;
  activeOpenTarget: OpenTargetOption;
  openTargets: OpenTargetOption[];
  openDirectoryInTarget: (targetID: OpenTargetOption["id"]) => Promise<void>;
  openCommitModal: (nextStep?: CommitNextStep) => void;
  commitNextStepOptions: Array<{ id: CommitNextStep; label: string; icon: ReactNode }>;
  setCommitNextStep: (nextStep: CommitNextStep) => void;
};

export function ContentTopBar({
  projectsPaneVisible,
  toggleProjectsPane,
  showGitPane,
  setGitPaneVisible,
  gitDiffStats,
  contentPaneTitle,
  showingProjectDashboard,
  activeProjectDir,
  projectData,
  terminalOpen,
  toggleTerminal,
  titleMenuOpen,
  openMenuOpen,
  setOpenMenuOpen,
  commitMenuOpen,
  setCommitMenuOpen,
  setTitleMenuOpen,
  hasActiveSession,
  isActiveSessionPinned,
  onTogglePinSession,
  onRenameSession,
  onArchiveSession,
  onCopyPath,
  onCopySessionId,
  activeOpenTarget,
  openTargets,
  openDirectoryInTarget,
  openCommitModal,
  commitNextStepOptions,
  setCommitNextStep,
}: ContentTopBarProps) {
  const hasProjectContext = Boolean(activeProjectDir ?? projectData?.directory);

  return (
    <div className="content-edge-controls">
      <div className="content-edge-left-actions">
        <IconButton
          icon="panelLeft"
          label="Toggle left sidebar"
          className={`workspace-left-toggle titlebar-toggle ${projectsPaneVisible ? "expanded" : "collapsed"}`.trim()}
          onClick={toggleProjectsPane}
        />
        <div className="content-topbar-title-wrap">
          <h2 className="content-topbar-title" title={contentPaneTitle}>
            {contentPaneTitle}
          </h2>
          {!showingProjectDashboard ? (
            <>
              <button
                type="button"
                className="title-overflow-button"
                aria-label="Session and workspace actions"
                title="Session actions"
                onClick={() => {
                  setTitleMenuOpen(!titleMenuOpen);
                  setOpenMenuOpen(false);
                  setCommitMenuOpen(false);
                }}
              >
                <Ellipsis size={16} aria-hidden="true" />
              </button>
              {titleMenuOpen ? (
                <div className="title-overflow-menu">
                  <button type="button" disabled={!hasActiveSession} onClick={onTogglePinSession}>
                    <span className="menu-item-logo">{isActiveSessionPinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}</span>
                    <span>{isActiveSessionPinned ? "Unpin session" : "Pin session"}</span>
                  </button>
                  <button type="button" disabled={!hasActiveSession} onClick={onRenameSession}>
                    <span className="menu-item-logo">
                      <Pencil size={14} aria-hidden="true" />
                    </span>
                    <span>Rename session</span>
                  </button>
                  <button type="button" disabled={!hasActiveSession} onClick={onArchiveSession}>
                    <span className="menu-item-logo">
                      <Archive size={14} aria-hidden="true" />
                    </span>
                    <span>Archive session</span>
                  </button>
                  <div className="menu-separator" />
                  <button type="button" onClick={onCopyPath}>
                    <span className="menu-item-logo">
                      <Copy size={14} aria-hidden="true" />
                    </span>
                    <span>Copy path</span>
                  </button>
                  <button type="button" disabled={!hasActiveSession} onClick={onCopySessionId}>
                    <span className="menu-item-logo">
                      <Fingerprint size={14} aria-hidden="true" />
                    </span>
                    <span>Copy session id</span>
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <div className="content-edge-right-actions">
        <div className={`titlebar-split titlebar-open ${openMenuOpen ? "open" : ""}`.trim()}>
          <button
            type="button"
            className="titlebar-action"
            onClick={() => {
              void openDirectoryInTarget(activeOpenTarget.id);
              setCommitMenuOpen(false);
              setTitleMenuOpen(false);
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
              setOpenMenuOpen(!openMenuOpen);
              setCommitMenuOpen(false);
              setTitleMenuOpen(false);
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
              {openTargets.map((target) => (
                <button key={target.id} type="button" onClick={() => void openDirectoryInTarget(target.id)}>
                  <span className="menu-item-logo menu-item-logo-app">
                    <img src={target.logo} alt="" aria-hidden="true" />
                  </span>
                  <span>{target.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={`titlebar-split titlebar-commit ${commitMenuOpen ? "open" : ""}`.trim()}>
          <button
            type="button"
            className="titlebar-action"
            onClick={() => {
              openCommitModal();
              setOpenMenuOpen(false);
              setTitleMenuOpen(false);
            }}
            disabled={!hasProjectContext}
          >
            <span className="titlebar-action-logo">
              <GitCommitHorizontal size={13} aria-hidden="true" />
            </span>
            <span>Commit</span>
          </button>
          <button
            type="button"
            className="titlebar-action-arrow"
            onClick={() => {
              setCommitMenuOpen(!commitMenuOpen);
              setOpenMenuOpen(false);
              setTitleMenuOpen(false);
            }}
            aria-label="Commit options"
            title="Commit options"
            disabled={!hasProjectContext}
          >
            <ChevronsUpDown size={12} aria-hidden="true" />
          </button>
          {commitMenuOpen ? (
            <div className="titlebar-menu">
              <small>Next step</small>
              {commitNextStepOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setCommitNextStep(option.id);
                    openCommitModal(option.id);
                  }}
                >
                  <span className="menu-item-logo">{option.icon}</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <IconButton
          icon="terminal"
          label="Toggle terminal"
          className={`titlebar-toggle titlebar-toggle-terminal ${terminalOpen ? "active" : ""}`.trim()}
          onClick={() => void toggleTerminal()}
        />
        <div className="titlebar-git-toggle-group">
          {gitDiffStats.hasChanges ? (
            <span className="titlebar-git-diff-stats" aria-label={`Git changes: +${gitDiffStats.additions} -${gitDiffStats.deletions}`}>
              <span className="added">+{gitDiffStats.additions}</span>
              <span className="removed">-{gitDiffStats.deletions}</span>
            </span>
          ) : null}
          <IconButton
            icon="panelRight"
            label="Toggle Git sidebar"
            className={`titlebar-toggle titlebar-toggle-right ${showGitPane ? "active" : ""}`.trim()}
            onClick={() => setGitPaneVisible(!showGitPane)}
          />
        </div>
      </div>
    </div>
  );
}
