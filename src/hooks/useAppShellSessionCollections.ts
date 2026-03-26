import { useCallback, useMemo } from "react";
import type { ProjectBootstrap } from "@shared/ipc";
import { selectSidebarSessionPresentation, useUnifiedRuntimeStore } from "../state/unified-runtime-store";

type SessionListEntry = {
  id: string;
  title?: string;
  slug: string;
  time: { created: number; updated: number };
};

type UseAppShellSessionCollectionsInput = {
  projectData?: ProjectBootstrap;
  projectDataByDirectory: Record<string, ProjectBootstrap>;
  activeProjectDir?: string;
  activeSessionID?: string;
  projectCacheVersion: number;
  pinnedSessions: Record<string, string[]>;
  archivedBackgroundAgentIds: Record<string, string[]>;
  hiddenBackgroundSessionIdsByProject: Record<string, string[]>;
  getSessionType: (sessionID: string, directory?: string) => string | undefined;
  normalizePresentationProvider: (sessionType: string | undefined) => "opencode" | "codex" | "claude" | "claude-chat" | undefined;
};

export function useAppShellSessionCollections({
  projectData,
  projectDataByDirectory,
  activeProjectDir,
  activeSessionID,
  projectCacheVersion,
  pinnedSessions,
  archivedBackgroundAgentIds,
  hiddenBackgroundSessionIdsByProject,
  getSessionType,
  normalizePresentationProvider,
}: UseAppShellSessionCollectionsInput) {
  const opencodeSessions = useUnifiedRuntimeStore((state) => state.opencodeSessions);
  const codexSessions = useUnifiedRuntimeStore((state) => state.codexSessions);
  const claudeChatSessions = useUnifiedRuntimeStore((state) => state.claudeChatSessions);
  const claudeSessions = useUnifiedRuntimeStore((state) => state.claudeSessions);
  const sessionReadTimestamps = useUnifiedRuntimeStore((state) => state.sessionReadTimestamps);
  const storeProjects = useUnifiedRuntimeStore((state) => state.projectDataByDirectory);

  const hiddenSessionIDsByProject = useMemo(() => {
    const projects = new Set([
      ...Object.keys(archivedBackgroundAgentIds),
      ...Object.keys(hiddenBackgroundSessionIdsByProject),
    ]);
    const next: Record<string, string[]> = {};
    for (const directory of projects) {
      const ids = new Set([
        ...(archivedBackgroundAgentIds[directory] ?? []),
        ...(hiddenBackgroundSessionIdsByProject[directory] ?? []),
      ]);
      next[directory] = [...ids];
    }
    return next;
  }, [archivedBackgroundAgentIds, hiddenBackgroundSessionIdsByProject]);

  const sessions = useMemo(() => {
    if (!projectData) {
      return [];
    }
    const pinned = new Set(pinnedSessions[projectData.directory] ?? []);
    const hiddenSessionIDs = new Set(hiddenSessionIDsByProject[projectData.directory] ?? []);
    return [...projectData.sessions]
      .filter((item) => !item.time.archived && !hiddenSessionIDs.has(item.id))
      .sort((a, b) => {
        const aPinned = pinned.has(a.id) ? 1 : 0;
        const bPinned = pinned.has(b.id) ? 1 : 0;
        if (aPinned !== bPinned) {
          return bPinned - aPinned;
        }
        return b.time.updated - a.time.updated;
      });
  }, [hiddenSessionIDsByProject, pinnedSessions, projectData]);

  const cachedSessionsByProject = useMemo(() => {
    void projectCacheVersion;
    const result: Record<string, SessionListEntry[]> = {};
    for (const [directory, data] of Object.entries(projectDataByDirectory)) {
      if (directory === activeProjectDir) {
        continue;
      }
      const hiddenSessionIDs = new Set(hiddenSessionIDsByProject[directory] ?? []);
      result[directory] = [...data.sessions]
        .filter((session) => !session.time.archived && !hiddenSessionIDs.has(session.id))
        .sort((a, b) => b.time.updated - a.time.updated);
    }
    return result;
  }, [activeProjectDir, hiddenSessionIDsByProject, projectCacheVersion, projectDataByDirectory]);

  const getSessionStatusType = useCallback((sessionID: string, directory?: string) => {
    void opencodeSessions;
    void codexSessions;
    void claudeChatSessions;
    void claudeSessions;
    void sessionReadTimestamps;
    void storeProjects;
    if (!directory) {
      return "idle";
    }
    const sessionType = getSessionType(sessionID, directory);
    const provider = normalizePresentationProvider(sessionType);
    if (!provider) {
      return "idle";
    }
    return selectSidebarSessionPresentation({
      provider,
      directory,
      sessionID,
      updatedAt: 0,
      isActive: activeProjectDir === directory && activeSessionID === sessionID,
      sessionKey: `${directory}::${sessionID}`,
    }).statusType;
  }, [activeProjectDir, activeSessionID, claudeChatSessions, claudeSessions, codexSessions, getSessionType, normalizePresentationProvider, opencodeSessions, sessionReadTimestamps, storeProjects]);

  const getSessionIndicator = useCallback((sessionID: string, directory: string, updatedAt: number) => {
    void opencodeSessions;
    void codexSessions;
    void claudeChatSessions;
    void claudeSessions;
    void sessionReadTimestamps;
    void storeProjects;
    const sessionType = getSessionType(sessionID, directory);
    const provider = normalizePresentationProvider(sessionType);
    if (!provider) {
      return "none" as const;
    }
    return selectSidebarSessionPresentation({
      provider,
      directory,
      sessionID,
      updatedAt,
      isActive: activeProjectDir === directory && activeSessionID === sessionID,
      sessionKey: `${directory}::${sessionID}`,
    }).indicator;
  }, [activeProjectDir, activeSessionID, claudeChatSessions, claudeSessions, codexSessions, getSessionType, normalizePresentationProvider, opencodeSessions, sessionReadTimestamps, storeProjects]);

  return {
    hiddenSessionIDsByProject,
    sessions,
    cachedSessionsByProject,
    getSessionStatusType,
    getSessionIndicator,
  };
}
