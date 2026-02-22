import type { ReactNode } from "react";
import { ChevronsUpDown, GitCommitHorizontal } from "lucide-react";
import type { ProjectData } from "../hooks/useDashboards";
import type { CommitNextStep } from "../hooks/useGitPanel";
import { IconButton } from "./IconButton";

type OpenTargetOption = {
  id: "cursor" | "antigravity" | "finder" | "terminal" | "ghostty" | "xcode" | "zed";
  label: string;
  logo: string;
};

type ContentTopBarProps = {
  showOperationsPane: boolean;
  setOperationsPaneVisible: (visible: boolean) => void;
  activeProjectDir: string | null;
  projectData: ProjectData | null;
  terminalOpen: boolean;
  toggleTerminal: () => Promise<void>;
  openMenuOpen: boolean;
  setOpenMenuOpen: (open: boolean) => void;
  commitMenuOpen: boolean;
  setCommitMenuOpen: (open: boolean) => void;
  setTitleMenuOpen: (open: boolean) => void;
  activeOpenTarget: OpenTargetOption;
  openTargets: OpenTargetOption[];
  openDirectoryInTarget: (targetID: OpenTargetOption["id"]) => Promise<void>;
  openCommitModal: (nextStep?: CommitNextStep) => void;
  commitNextStepOptions: Array<{ id: CommitNextStep; label: string; icon: ReactNode }>;
  setCommitNextStep: (nextStep: CommitNextStep) => void;
};

export function ContentTopBar({
  showOperationsPane,
  setOperationsPaneVisible,
  activeProjectDir,
  projectData,
  terminalOpen,
  toggleTerminal,
  openMenuOpen,
  setOpenMenuOpen,
  commitMenuOpen,
  setCommitMenuOpen,
  setTitleMenuOpen,
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
        <IconButton
          icon="panelRight"
          label="Toggle right sidebar"
          className={`titlebar-toggle titlebar-toggle-right ${showOperationsPane ? "active" : ""}`.trim()}
          onClick={() => setOperationsPaneVisible(!showOperationsPane)}
        />
      </div>
    </div>
  );
}
