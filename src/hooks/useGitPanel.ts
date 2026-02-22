import { useCallback, useEffect, useState } from "react";
import type { GitBranchState } from "@shared/ipc";

export type CommitNextStep = "commit" | "commit_and_push" | "commit_and_create_pr";
type GitPanelTab = "diff" | "log" | "issues" | "prs";

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useGitPanel(activeProjectDir: string | null) {
  const [branchState, setBranchState] = useState<GitBranchState | null>(null);
  const [gitPanelTab, setGitPanelTab] = useState<GitPanelTab>("diff");
  const [gitPanelOutput, setGitPanelOutput] = useState("Select DIFF or LOG.");
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [gitLogLoading, setGitLogLoading] = useState(false);
  const [gitIssuesLoading, setGitIssuesLoading] = useState(false);
  const [gitPrsLoading, setGitPrsLoading] = useState(false);

  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commitIncludeUnstaged, setCommitIncludeUnstaged] = useState(true);
  const [commitMessageDraft, setCommitMessageDraft] = useState("");
  const [commitNextStep, setCommitNextStep] = useState<CommitNextStep>("commit");
  const [commitSummary, setCommitSummary] = useState<{
    branch: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
    repoRoot: string;
  } | null>(null);
  const [commitSummaryLoading, setCommitSummaryLoading] = useState(false);
  const [commitSubmitting, setCommitSubmitting] = useState(false);

  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchSwitching, setBranchSwitching] = useState(false);
  const [branchCreateModalOpen, setBranchCreateModalOpen] = useState(false);
  const [branchCreateName, setBranchCreateName] = useState("");
  const [branchCreateError, setBranchCreateError] = useState<string | null>(null);

  const loadGitDiff = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    setGitPanelTab("diff");
    setGitPanelOutput("Loading diff...");
    try {
      setGitDiffLoading(true);
      const output = await window.orxa.opencode.gitDiff(activeProjectDir);
      setGitPanelOutput(output);
    } catch (error) {
      setGitPanelOutput(formatError(error));
    } finally {
      setGitDiffLoading(false);
    }
  }, [activeProjectDir]);

  const loadGitLog = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    setGitPanelTab("log");
    setGitPanelOutput("Loading log...");
    try {
      setGitLogLoading(true);
      const output = await window.orxa.opencode.gitLog(activeProjectDir);
      setGitPanelOutput(output);
    } catch (error) {
      setGitPanelOutput(formatError(error));
    } finally {
      setGitLogLoading(false);
    }
  }, [activeProjectDir]);

  const loadGitIssues = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    setGitPanelTab("issues");
    setGitPanelOutput("Loading issues...");
    try {
      setGitIssuesLoading(true);
      const output = await window.orxa.opencode.gitIssues(activeProjectDir);
      setGitPanelOutput(output);
    } catch (error) {
      setGitPanelOutput(formatError(error));
    } finally {
      setGitIssuesLoading(false);
    }
  }, [activeProjectDir]);

  const loadGitPrs = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    setGitPanelTab("prs");
    setGitPanelOutput("Loading pull requests...");
    try {
      setGitPrsLoading(true);
      const output = await window.orxa.opencode.gitPrs(activeProjectDir);
      setGitPanelOutput(output);
    } catch (error) {
      setGitPanelOutput(formatError(error));
    } finally {
      setGitPrsLoading(false);
    }
  }, [activeProjectDir]);

  const refreshBranchState = useCallback(async () => {
    if (!activeProjectDir) {
      setBranchState(null);
      return;
    }
    try {
      setBranchLoading(true);
      const next = await window.orxa.opencode.gitBranches(activeProjectDir);
      setBranchState(next);
    } finally {
      setBranchLoading(false);
    }
  }, [activeProjectDir]);

  const checkoutBranch = useCallback(
    async (nextBranchInput: string) => {
      if (!activeProjectDir) {
        return;
      }
      const nextBranch = nextBranchInput.trim();
      if (!nextBranch || nextBranch === branchState?.current) {
        setBranchMenuOpen(false);
        return;
      }
      try {
        setBranchSwitching(true);
        const next = await window.orxa.opencode.gitCheckoutBranch(activeProjectDir, nextBranch);
        setBranchState(next);
        setBranchQuery("");
        setBranchMenuOpen(false);
        if (gitPanelTab === "diff") {
          await loadGitDiff();
        } else if (gitPanelTab === "log") {
          await loadGitLog();
        } else if (gitPanelTab === "issues") {
          await loadGitIssues();
        } else {
          await loadGitPrs();
        }
      } finally {
        setBranchSwitching(false);
      }
    },
    [activeProjectDir, branchState, gitPanelTab, loadGitDiff, loadGitIssues, loadGitLog, loadGitPrs],
  );

  const openBranchCreateModal = useCallback(() => {
    const query = branchQuery.trim();
    setBranchCreateName(query);
    setBranchCreateError(null);
    setBranchCreateModalOpen(true);
    setBranchMenuOpen(false);
  }, [branchQuery]);

  const submitBranchCreate = useCallback(async () => {
    const candidate = branchCreateName.trim();
    if (!candidate) {
      setBranchCreateError("Branch name is required");
      return;
    }
    const existing = new Set(branchState?.branches ?? []);
    if (existing.has(candidate)) {
      setBranchCreateError(`Branch "${candidate}" already exists`);
      return;
    }
    setBranchCreateModalOpen(false);
    setBranchCreateName("");
    setBranchCreateError(null);
    await checkoutBranch(candidate);
  }, [branchCreateName, branchState?.branches, checkoutBranch]);

  const loadCommitSummary = useCallback(
    async (includeUnstaged: boolean) => {
      if (!activeProjectDir) {
        return;
      }
      try {
        setCommitSummaryLoading(true);
        const summary = await window.orxa.opencode.gitCommitSummary(activeProjectDir, includeUnstaged);
        setCommitSummary(summary);
      } finally {
        setCommitSummaryLoading(false);
      }
    },
    [activeProjectDir],
  );

  const stageAllChanges = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    await window.orxa.opencode.gitStageAll(activeProjectDir);
    await loadGitDiff();
  }, [activeProjectDir, loadGitDiff]);

  const discardAllChanges = useCallback(async () => {
    if (!activeProjectDir) {
      return;
    }
    await window.orxa.opencode.gitRestoreAllUnstaged(activeProjectDir);
    await loadGitDiff();
  }, [activeProjectDir, loadGitDiff]);

  const stageFile = useCallback(
    async (filePath: string) => {
      if (!activeProjectDir) {
        return;
      }
      await window.orxa.opencode.gitStagePath(activeProjectDir, filePath);
      await loadGitDiff();
    },
    [activeProjectDir, loadGitDiff],
  );

  const restoreFile = useCallback(
    async (filePath: string) => {
      if (!activeProjectDir) {
        return;
      }
      await window.orxa.opencode.gitRestorePath(activeProjectDir, filePath);
      await loadGitDiff();
    },
    [activeProjectDir, loadGitDiff],
  );

  const unstageFile = useCallback(
    async (filePath: string) => {
      if (!activeProjectDir) {
        return;
      }
      await window.orxa.opencode.gitUnstagePath(activeProjectDir, filePath);
      await loadGitDiff();
    },
    [activeProjectDir, loadGitDiff],
  );

  useEffect(() => {
    if (!activeProjectDir) {
      setGitPanelTab("diff");
      setGitPanelOutput("Select DIFF or LOG.");
      setBranchState(null);
      return;
    }
    void refreshBranchState();
  }, [activeProjectDir, refreshBranchState]);

  useEffect(() => {
    if (!commitModalOpen || !activeProjectDir) {
      return;
    }
    void loadCommitSummary(commitIncludeUnstaged);
  }, [activeProjectDir, commitIncludeUnstaged, commitModalOpen, loadCommitSummary]);

  return {
    branchState,
    setBranchState,
    gitPanelTab,
    setGitPanelTab,
    gitPanelOutput,
    setGitPanelOutput,
    gitDiffLoading,
    gitLogLoading,
    gitIssuesLoading,
    gitPrsLoading,
    commitModalOpen,
    setCommitModalOpen,
    commitIncludeUnstaged,
    setCommitIncludeUnstaged,
    commitMessageDraft,
    setCommitMessageDraft,
    commitNextStep,
    setCommitNextStep,
    commitSummary,
    setCommitSummary,
    commitSummaryLoading,
    commitSubmitting,
    setCommitSubmitting,
    branchMenuOpen,
    setBranchMenuOpen,
    branchQuery,
    setBranchQuery,
    branchLoading,
    branchSwitching,
    branchCreateModalOpen,
    setBranchCreateModalOpen,
    branchCreateName,
    setBranchCreateName,
    branchCreateError,
    setBranchCreateError,
    loadGitDiff,
    loadGitLog,
    loadGitIssues,
    loadGitPrs,
    refreshBranchState,
    checkoutBranch,
    openBranchCreateModal,
    submitBranchCreate,
    loadCommitSummary,
    stageAllChanges,
    discardAllChanges,
    stageFile,
    restoreFile,
    unstageFile,
  };
}
