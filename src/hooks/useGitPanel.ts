import { useCallback, useEffect, useRef, useState } from "react";
import type { GitBranchState } from "@shared/ipc";
import { usePersistedState } from "./usePersistedState";

export type CommitNextStep = "commit" | "commit_and_push" | "commit_and_create_pr";
type GitPanelTab = "diff" | "log" | "issues" | "prs";
export type GitDiffViewMode = "list" | "unified" | "split";
export type GitDiffStats = { additions: number; deletions: number; filesChanged: number; hasChanges: boolean };

const GIT_DIFF_VIEW_MODE_KEY = "orxa:gitDiffViewMode:v1";

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function parseGitDiffStats(output: string): GitDiffStats {
  const trimmed = output.trim();
  if (
    !trimmed ||
    trimmed === "No local changes." ||
    trimmed === "Not a git repository." ||
    trimmed.startsWith("Loading diff")
  ) {
    return { additions: 0, deletions: 0, filesChanged: 0, hasChanges: false };
  }

  const lines = output.split(/\r?\n/);
  let additions = 0;
  let deletions = 0;
  const changedFiles = new Set<string>();

  for (const line of lines) {
    const diffHeaderMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffHeaderMatch) {
      const path = diffHeaderMatch[2] ?? diffHeaderMatch[1];
      if (path) {
        changedFiles.add(path);
      }
      continue;
    }
    const untrackedMatch = line.match(/^\?\?\s+(.+)$/);
    if (untrackedMatch) {
      const path = untrackedMatch[1]?.trim();
      if (path) {
        changedFiles.add(path);
        additions += 1;
      }
      continue;
    }
    const inlineUntracked = [...line.matchAll(/\?\?\s+([^?]+?)(?=\s+\?\?|$)/g)];
    if (inlineUntracked.length > 0) {
      for (const match of inlineUntracked) {
        const path = (match[1] ?? "").trim();
        if (!path) {
          continue;
        }
        changedFiles.add(path);
        additions += 1;
      }
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return {
    additions,
    deletions,
    filesChanged: changedFiles.size,
    hasChanges: changedFiles.size > 0 || additions > 0 || deletions > 0,
  };
}

export function useGitPanel(activeProjectDir: string | null) {
  const [branchState, setBranchState] = useState<GitBranchState | null>(null);
  const [gitPanelTab, setGitPanelTab] = useState<GitPanelTab>("diff");
  const [gitDiffViewMode, setGitDiffViewMode] = usePersistedState<GitDiffViewMode>(GIT_DIFF_VIEW_MODE_KEY, "list", {
    deserialize: (raw) => {
      if (raw === "list" || raw === "unified" || raw === "split") {
        return raw;
      }
      return "list";
    },
    serialize: (value) => value,
  });
  const [gitPanelOutput, setGitPanelOutput] = useState("Select DIFF or LOG.");
  const [gitDiffStats, setGitDiffStats] = useState<GitDiffStats>({ additions: 0, deletions: 0, filesChanged: 0, hasChanges: false });
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
  const [commitBaseBranch, setCommitBaseBranch] = useState("");

  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchSwitching, setBranchSwitching] = useState(false);
  const [branchCreateModalOpen, setBranchCreateModalOpen] = useState(false);
  const [branchCreateName, setBranchCreateName] = useState("");
  const [branchCreateError, setBranchCreateError] = useState<string | null>(null);
  const gitRefreshTimerRef = useRef<number | undefined>(undefined);

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
      setGitDiffStats(parseGitDiffStats(output));
    } catch (error) {
      setGitPanelOutput(formatError(error));
      setGitDiffStats({ additions: 0, deletions: 0, filesChanged: 0, hasChanges: false });
    } finally {
      setGitDiffLoading(false);
    }
  }, [activeProjectDir]);

  const refreshGitDiffStats = useCallback(async () => {
    if (!activeProjectDir) {
      setGitDiffStats({ additions: 0, deletions: 0, filesChanged: 0, hasChanges: false });
      return;
    }
    try {
      const output = await window.orxa.opencode.gitDiff(activeProjectDir);
      setGitDiffStats(parseGitDiffStats(output));
    } catch {
      setGitDiffStats({ additions: 0, deletions: 0, filesChanged: 0, hasChanges: false });
    }
  }, [activeProjectDir]);

  const silentRefreshDiff = useCallback(async () => {
    if (!activeProjectDir) return;
    try {
      const output = await window.orxa.opencode.gitDiff(activeProjectDir);
      setGitPanelOutput(output);
      setGitDiffStats(parseGitDiffStats(output));
    } catch {
      // ignore to avoid overwriting existing content on transient errors
    }
  }, [activeProjectDir]);

  const scheduleGitRefresh = useCallback(
    (delayMs = 420) => {
      if (!activeProjectDir) {
        return;
      }
      if (gitRefreshTimerRef.current) {
        window.clearTimeout(gitRefreshTimerRef.current);
      }
      gitRefreshTimerRef.current = window.setTimeout(() => {
        gitRefreshTimerRef.current = undefined;
        if (gitPanelTab === "diff") {
          void silentRefreshDiff();
        } else {
          void refreshGitDiffStats();
        }
      }, Math.max(120, delayMs));
    },
    [activeProjectDir, gitPanelTab, refreshGitDiffStats, silentRefreshDiff],
  );

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

  const commitBaseBranchOptions = (() => {
    if (!branchState) {
      return [];
    }
    const current = commitSummary?.branch ?? branchState.current;
    return branchState.branches.filter((branch) => branch !== current);
  })();

  const pickDefaultBaseBranch = useCallback((branches: string[], currentValue: string) => {
    if (currentValue && branches.includes(currentValue)) {
      return currentValue;
    }
    if (branches.includes("main")) {
      return "main";
    }
    if (branches.includes("master")) {
      return "master";
    }
    return branches[0] ?? "";
  }, []);

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
      setGitDiffStats({ additions: 0, deletions: 0, filesChanged: 0, hasChanges: false });
      return;
    }
    void refreshBranchState();
    void refreshGitDiffStats();
  }, [activeProjectDir, refreshBranchState, refreshGitDiffStats]);

  useEffect(() => {
    if (!activeProjectDir) return;
    const interval = setInterval(() => {
      void silentRefreshDiff();
    }, 8000);
    return () => clearInterval(interval);
  }, [activeProjectDir, silentRefreshDiff]);

  useEffect(() => {
    return () => {
      if (gitRefreshTimerRef.current) {
        window.clearTimeout(gitRefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!commitModalOpen || !activeProjectDir) {
      return;
    }
    void loadCommitSummary(commitIncludeUnstaged);
    void refreshBranchState();
  }, [activeProjectDir, commitIncludeUnstaged, commitModalOpen, loadCommitSummary, refreshBranchState]);

  useEffect(() => {
    if (!commitModalOpen) {
      return;
    }
    setCommitBaseBranch((current) => pickDefaultBaseBranch(commitBaseBranchOptions, current));
  }, [commitBaseBranchOptions, commitModalOpen, pickDefaultBaseBranch]);

  return {
    branchState,
    setBranchState,
    gitPanelTab,
    setGitPanelTab,
    gitDiffViewMode,
    setGitDiffViewMode,
    gitPanelOutput,
    gitDiffStats,
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
    commitBaseBranch,
    setCommitBaseBranch,
    commitBaseBranchOptions,
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
    scheduleGitRefresh,
    stageAllChanges,
    discardAllChanges,
    stageFile,
    restoreFile,
    unstageFile,
  };
}
