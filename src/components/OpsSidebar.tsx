import type { GitBranchState } from "@shared/ipc";
import { IconButton } from "./IconButton";
import { ProjectFilesPanel } from "./ProjectFilesPanel";

export type BranchState = GitBranchState;

type OpsPanelTab = "git" | "files";
type GitPanelTab = "diff" | "log" | "issues" | "prs";

export type OpsSidebarProps = {
  opsPanelTab: OpsPanelTab;
  setOpsPanelTab: (tab: OpsPanelTab) => void;
  gitPanelTab: GitPanelTab;
  setGitPanelTab: (tab: GitPanelTab) => void;
  gitPanelOutput: string;
  branchState: BranchState | null;
  branchQuery: string;
  setBranchQuery: (query: string) => void;
  activeProjectDir: string | null | undefined;
  onLoadGitDiff: () => Promise<void>;
  onLoadGitLog: () => Promise<void>;
  onLoadGitIssues: () => Promise<void>;
  onLoadGitPrs: () => Promise<void>;
  onAddToChatPath: (filePath: string) => void;
  onStatusChange: (message: string) => void;
};

export function OpsSidebar(props: OpsSidebarProps) {
  const {
    opsPanelTab,
    setOpsPanelTab,
    gitPanelTab,
    setGitPanelTab,
    gitPanelOutput,
    activeProjectDir,
    onLoadGitDiff,
    onLoadGitLog,
    onLoadGitIssues,
    onLoadGitPrs,
    onAddToChatPath,
    onStatusChange,
  } = props;

  return (
    <aside className="sidebar ops-pane">
      <div className="pane-header pane-header-empty" aria-hidden="true" />
      <section className="ops-toolbar">
        <IconButton
          icon="git"
          label="Git"
          className={`tab-icon ${opsPanelTab === "git" ? "active" : ""}`.trim()}
          onClick={() => setOpsPanelTab("git")}
        />
        <IconButton
          icon="files"
          label="Files"
          className={`tab-icon ${opsPanelTab === "files" ? "active" : ""}`.trim()}
          onClick={() => setOpsPanelTab("files")}
        />
      </section>

      {opsPanelTab === "git" ? (
        <section className="ops-section ops-section-fill">
          <h3>Git</h3>
          <div className="ops-icon-row ops-icon-tabs">
            <IconButton
              icon="diff"
              label="Diff"
              className={gitPanelTab === "diff" ? "active" : ""}
              onClick={() => {
                setGitPanelTab("diff");
                void onLoadGitDiff();
              }}
            />
            <IconButton
              icon="log"
              label="Log"
              className={gitPanelTab === "log" ? "active" : ""}
              onClick={() => {
                setGitPanelTab("log");
                void onLoadGitLog();
              }}
            />
            <IconButton
              icon="issues"
              label="Issues"
              className={gitPanelTab === "issues" ? "active" : ""}
              onClick={() => {
                setGitPanelTab("issues");
                void onLoadGitIssues();
              }}
            />
            <IconButton
              icon="pulls"
              label="Pull requests"
              className={gitPanelTab === "prs" ? "active" : ""}
              onClick={() => {
                setGitPanelTab("prs");
                void onLoadGitPrs();
              }}
            />
          </div>
          <pre className="ops-console">{gitPanelOutput}</pre>
        </section>
      ) : null}

      {opsPanelTab === "files" ? (
        <ProjectFilesPanel directory={activeProjectDir ?? ""} onAddToChatPath={onAddToChatPath} onStatus={onStatusChange} />
      ) : null}
    </aside>
  );
}
