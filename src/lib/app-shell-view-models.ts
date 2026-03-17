import type { ProviderUsageStats } from "@shared/ipc";
import type { HomeDashboardState } from "../hooks/useDashboards";
import type { BrowserControlOwner } from "./app-session-utils";
import { toBrowserSidebarState } from "./app-session-utils";

type AppShellWorkspaceLayoutInput = {
  activeProjectDir?: string;
  sidebarMode: "projects" | "jobs" | "skills" | "memory";
  projectsSidebarVisible: boolean;
  showOperationsPane: boolean;
  rightSidebarTab: "git" | "files" | "browser";
  anyOverlayInDom: boolean;
};

type AppShellBrowserSidebarInput = {
  runtimeState: Parameters<typeof toBrowserSidebarState>[0]["runtimeState"];
  history: Parameters<typeof toBrowserSidebarState>[0]["history"];
  modeEnabled: boolean;
  controlOwner: BrowserControlOwner;
  actionRunning: boolean;
  isSessionInProgress: boolean;
};

type AppShellHomeDashboardInput = {
  dashboard: HomeDashboardState;
  codexSessionCount: number;
  claudeSessionCount: number;
  codexUsage: ProviderUsageStats | null;
  claudeUsage: ProviderUsageStats | null;
  codexUsageLoading: boolean;
  claudeUsageLoading: boolean;
  onRefreshCodexUsage: () => void;
  onRefreshClaudeUsage: () => void;
  onRefresh: () => void;
  onAddWorkspace: () => void;
  onOpenSettings: () => void;
};

export function deriveAppShellWorkspaceLayout(input: AppShellWorkspaceLayoutInput) {
  const hasProjectContext = Boolean(input.activeProjectDir) && input.sidebarMode === "projects";
  const showProjectsPane = !hasProjectContext || input.projectsSidebarVisible;
  const showGitPane = hasProjectContext && input.sidebarMode === "projects" && input.showOperationsPane;
  const browserPaneVisible = showGitPane && input.rightSidebarTab === "browser" && !input.anyOverlayInDom;
  return {
    hasProjectContext,
    showProjectsPane,
    showGitPane,
    browserPaneVisible,
  };
}

export function buildAppShellBrowserSidebarState(input: AppShellBrowserSidebarInput) {
  return toBrowserSidebarState({
    runtimeState: input.runtimeState,
    history: input.history,
    modeEnabled: input.modeEnabled,
    controlOwner: input.controlOwner,
    actionRunning: input.actionRunning,
    canStop: input.actionRunning || input.isSessionInProgress,
  });
}

export function buildAppShellHomeDashboardProps(input: AppShellHomeDashboardInput) {
  return {
    ...input.dashboard,
    codexSessionCount: input.codexSessionCount,
    claudeSessionCount: input.claudeSessionCount,
    codexUsage: input.codexUsage,
    claudeUsage: input.claudeUsage,
    codexUsageLoading: input.codexUsageLoading,
    claudeUsageLoading: input.claudeUsageLoading,
    onRefreshCodexUsage: input.onRefreshCodexUsage,
    onRefreshClaudeUsage: input.onRefreshClaudeUsage,
    onRefresh: input.onRefresh,
    onAddWorkspace: input.onAddWorkspace,
    onOpenSettings: input.onOpenSettings,
  };
}
