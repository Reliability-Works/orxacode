import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from "react";
import type { ProjectBootstrap, SessionMessageBundle } from "@shared/ipc";
import type { TerminalTab } from "../components/TerminalPanel";

const PINNED_SESSIONS_KEY = "orxa:pinnedSessions:v1";

type SidebarMode = "projects" | "jobs" | "skills";

type ContextMenuState =
  | {
      kind: "project";
      x: number;
      y: number;
      directory: string;
      label: string;
    }
  | {
      kind: "session";
      x: number;
      y: number;
      directory: string;
      sessionID: string;
      title: string;
    }
  | null;

type UseWorkspaceStateOptions = {
  setStatusLine: (status: string) => void;
  terminalTabIds: string[];
  setTerminalTabs: (tabs: TerminalTab[]) => void;
  setActiveTerminalId: (id: string | undefined) => void;
  setTerminalOpen: (open: boolean) => void;
  messageCacheRef: MutableRefObject<Record<string, SessionMessageBundle[]>>;
  projectLastOpenedRef: MutableRefObject<Record<string, number>>;
  projectLastUpdatedRef: MutableRefObject<Record<string, number>>;
};

type CreateSessionPromptOptions = {
  selectedAgent?: string;
  selectedModelPayload?: { providerID: string; modelID: string };
  selectedVariant?: string;
  serverAgentNames: Set<string>;
};

function deriveSessionTitleFromPrompt(prompt: string, maxLength = 56) {
  const cleaned = prompt
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-_:,.!?/]/gu, "")
    .trim();
  if (!cleaned) {
    return "New session";
  }
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3).trimEnd()}...` : cleaned;
}

function clampContextMenuPosition(x: number, y: number) {
  const menuWidth = 240;
  const menuHeight = 220;
  const padding = 8;
  return {
    x: Math.max(padding, Math.min(x, window.innerWidth - menuWidth - padding)),
    y: Math.max(padding, Math.min(y, window.innerHeight - menuHeight - padding)),
  };
}

export function useWorkspaceState(options: UseWorkspaceStateOptions) {
  const {
    setStatusLine,
    terminalTabIds,
    setTerminalTabs,
    setActiveTerminalId,
    setTerminalOpen,
    messageCacheRef,
    projectLastOpenedRef,
    projectLastUpdatedRef,
  } = options;

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("projects");
  const [activeProjectDir, setActiveProjectDir] = useState<string | undefined>();
  const [projectData, setProjectData] = useState<ProjectBootstrap | null>(null);
  const [activeSessionID, setActiveSessionID] = useState<string | undefined>();
  const [pendingSessionId, setPendingSessionId] = useState<string | undefined>();
  const [messages, setMessages] = useState<SessionMessageBundle[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [pinnedSessions, setPinnedSessions] = useState<Record<string, string[]>>(() => {
    try {
      const raw = window.localStorage.getItem(PINNED_SESSIONS_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      return parsed;
    } catch {
      return {};
    }
  });
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});

  const refreshTimer = useRef<number | undefined>(undefined);
  const responsePollTimer = useRef<number | undefined>(undefined);
  const activeProjectDirRef = useRef<string | undefined>(undefined);
  const activeSessionIDRef = useRef<string | undefined>(undefined);
  const projectDataCacheRef = useRef<Record<string, ProjectBootstrap>>({});

  const refreshProject = useCallback(
    async (directory: string, skipMessageLoad = false) => {
      try {
        const data = await window.orxa.opencode.refreshProject(directory);
        projectDataCacheRef.current[directory] = data;
        setProjectData(data);
        const lastUpdated = data.sessions.reduce((max, session) => Math.max(max, session.time.updated), 0);
        projectLastUpdatedRef.current[directory] = lastUpdated;

        const sortedSessions = [...data.sessions].sort((a, b) => b.time.updated - a.time.updated);
        let nextSessionID = activeSessionID;
        if (nextSessionID && !sortedSessions.some((item) => item.id === nextSessionID)) {
          nextSessionID = undefined;
          setActiveSessionID(undefined);
          setMessages([]);
        }

        const serverPtyIds = data.ptys.map((p) => p.id);
        const hasValidTab = terminalTabIds.some((id) => serverPtyIds.includes(id));
        if (!hasValidTab && serverPtyIds.length > 0) {
          setTerminalTabs(data.ptys.map((p, i) => ({ id: p.id, label: `Tab ${i + 1}` })));
          setActiveTerminalId(data.ptys[0]?.id);
        }

        if (nextSessionID && !skipMessageLoad) {
          const cacheKey = `${directory}:${nextSessionID}`;
          const cached = messageCacheRef.current[cacheKey];
          if (cached && activeSessionIDRef.current === nextSessionID) {
            setMessages(cached);
          }
          const latest = await window.orxa.opencode.loadMessages(directory, nextSessionID).catch(() => undefined);
          if (latest && activeSessionIDRef.current === nextSessionID) {
            messageCacheRef.current[cacheKey] = latest;
            setMessages(latest);
          }
        }

        return data;
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    [activeSessionID, messageCacheRef, projectLastUpdatedRef, setActiveTerminalId, setStatusLine, setTerminalTabs, terminalTabIds],
  );

  const selectProject = useCallback(
    async (directory: string) => {
      try {
        if (pendingSessionId && activeProjectDir) {
          void window.orxa.opencode.deleteSession(activeProjectDir, pendingSessionId).catch(() => undefined);
          setPendingSessionId(undefined);
        }
        setStatusLine(`Loading workspace ${directory}`);
        const cached = projectDataCacheRef.current[directory];
        setProjectData(cached ?? null);
        setMessages([]);
        setActiveSessionID(undefined);
        setTerminalTabs([]);
        setActiveTerminalId(undefined);
        setActiveProjectDir(directory);
        setSidebarMode("projects");
        setCollapsedProjects((current) => ({ ...current, [directory]: false }));
        const data = await window.orxa.opencode.selectProject(directory);
        projectDataCacheRef.current[directory] = data;
        setProjectData(data);
        const lastUpdated = data.sessions.reduce((max, session) => Math.max(max, session.time.updated), 0);
        projectLastUpdatedRef.current[directory] = lastUpdated;
        projectLastOpenedRef.current[directory] = Date.now();

        if (data.ptys.length > 0) {
          setTerminalTabs(data.ptys.map((p, i) => ({ id: p.id, label: `Tab ${i + 1}` })));
          setActiveTerminalId(data.ptys[0]?.id);
        }
        setActiveSessionID(undefined);
        setMessages([]);
        setStatusLine(`Loaded ${directory}`);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [activeProjectDir, pendingSessionId, projectLastOpenedRef, projectLastUpdatedRef, setActiveTerminalId, setStatusLine, setTerminalTabs],
  );

  const openWorkspaceDashboard = useCallback(() => {
    if (pendingSessionId && activeProjectDir) {
      void window.orxa.opencode.deleteSession(activeProjectDir, pendingSessionId).catch(() => undefined);
      setPendingSessionId(undefined);
    }
    setSidebarMode("projects");
    setActiveProjectDir(undefined);
    setProjectData(null);
    setActiveSessionID(undefined);
    setMessages([]);
    setTerminalOpen(false);
    setTerminalTabs([]);
    setActiveTerminalId(undefined);
    setStatusLine("Workspace dashboard");
  }, [activeProjectDir, pendingSessionId, setActiveTerminalId, setStatusLine, setTerminalOpen, setTerminalTabs]);

  const refreshMessages = useCallback(async () => {
    if (!activeProjectDir || !activeSessionID) {
      setMessages([]);
      return;
    }

    try {
      const sessionAtStart = activeSessionID;
      if (activeSessionIDRef.current !== sessionAtStart) {
        return;
      }
      const cacheKey = `${activeProjectDir}:${sessionAtStart}`;
      const cached = messageCacheRef.current[cacheKey];
      if (cached && activeSessionIDRef.current === sessionAtStart) {
        setMessages(cached);
      } else if (activeSessionIDRef.current === sessionAtStart) {
        setMessages([]);
      }
      const items = await window.orxa.opencode.loadMessages(activeProjectDir, sessionAtStart);
      messageCacheRef.current[cacheKey] = items;
      if (activeSessionIDRef.current === sessionAtStart) {
        setMessages(items);
      }
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir, activeSessionID, messageCacheRef, setStatusLine]);

  const selectSession = useCallback(
    (sessionID: string) => {
      if (!activeProjectDir) {
        return;
      }
      if (pendingSessionId && sessionID !== pendingSessionId) {
        void window.orxa.opencode.deleteSession(activeProjectDir, pendingSessionId).catch(() => undefined);
        setPendingSessionId(undefined);
      }
      setActiveSessionID(sessionID);
      activeSessionIDRef.current = sessionID;
      setMessages([]);
      const cacheKey = `${activeProjectDir}:${sessionID}`;
      const cached = messageCacheRef.current[cacheKey];
      if (cached) setMessages(cached);
      void window.orxa.opencode
        .loadMessages(activeProjectDir, sessionID)
        .then((items) => {
          messageCacheRef.current[cacheKey] = items;
          if (activeSessionIDRef.current === sessionID) {
            setMessages(items);
          }
        })
        .catch(() => undefined);
    },
    [activeProjectDir, messageCacheRef, pendingSessionId],
  );

  const stopResponsePolling = useCallback(() => {
    if (responsePollTimer.current) {
      window.clearTimeout(responsePollTimer.current);
      responsePollTimer.current = undefined;
    }
  }, []);

  const startResponsePolling = useCallback(
    (directory: string, sessionID: string) => {
      stopResponsePolling();
      const startedAt = Date.now();
      const tick = () => {
        if (activeProjectDirRef.current !== directory) {
          stopResponsePolling();
          return;
        }

        void refreshProject(directory)
          .then((next) => {
            void refreshMessages();
            const status = next.sessionStatus[sessionID];
            const done = status?.type === "idle";
            const timedOut = Date.now() - startedAt > 120_000;
            if (done || timedOut) {
              stopResponsePolling();
              return;
            }
            responsePollTimer.current = window.setTimeout(tick, 900);
          })
          .catch(() => {
            const timedOut = Date.now() - startedAt > 30_000;
            if (timedOut) {
              stopResponsePolling();
              return;
            }
            responsePollTimer.current = window.setTimeout(tick, 1300);
          });
      };

      responsePollTimer.current = window.setTimeout(tick, 900);
    },
    [refreshMessages, refreshProject, stopResponsePolling],
  );

  const createSession = useCallback(
    async (directory?: string, initialPrompt?: string, promptOptions?: CreateSessionPromptOptions) => {
      const targetDirectory = directory ?? activeProjectDir;
      if (!targetDirectory) {
        return;
      }

      const firstPrompt = initialPrompt?.trim() ?? "";
      const title = firstPrompt.length > 0 ? deriveSessionTitleFromPrompt(firstPrompt) : "New session";

      setMessages([]);
      activeSessionIDRef.current = undefined;
      stopResponsePolling();

      if (pendingSessionId && activeProjectDir) {
        void window.orxa.opencode.deleteSession(activeProjectDir, pendingSessionId).catch(() => undefined);
        setPendingSessionId(undefined);
      }

      try {
        if (activeProjectDir !== targetDirectory) {
          await selectProject(targetDirectory);
        }
        const createdSession = await window.orxa.opencode.createSession(targetDirectory, title);
        const nextSessionID = createdSession.id;
        activeSessionIDRef.current = nextSessionID;
        setActiveSessionID(nextSessionID);
        setActiveProjectDir(targetDirectory);
        setMessages([]);
        const next = await refreshProject(targetDirectory, true);
        const sorted = [...next.sessions].filter((item) => !item.time.archived).sort((a, b) => b.time.updated - a.time.updated);
        const resolvedSessionID = nextSessionID ?? sorted[0]?.id;
        if (!nextSessionID && resolvedSessionID) {
          setActiveSessionID(resolvedSessionID);
          activeSessionIDRef.current = resolvedSessionID;
        }
        if (resolvedSessionID && firstPrompt.length > 0) {
          const supportsSelectedAgent = promptOptions?.selectedAgent
            ? promptOptions.serverAgentNames.has(promptOptions.selectedAgent)
            : false;
          await window.orxa.opencode.sendPrompt({
            directory: targetDirectory,
            sessionID: resolvedSessionID,
            text: firstPrompt,
            agent: supportsSelectedAgent ? promptOptions?.selectedAgent : undefined,
            model: promptOptions?.selectedModelPayload,
            variant: promptOptions?.selectedVariant,
          });
          startResponsePolling(targetDirectory, resolvedSessionID);
          setStatusLine("Session started");
        } else {
          if (resolvedSessionID) {
            setPendingSessionId(resolvedSessionID);
          }
          setStatusLine("Session created");
        }
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [activeProjectDir, refreshProject, selectProject, setStatusLine, startResponsePolling, stopResponsePolling, pendingSessionId],
  );

  const queueRefresh = useCallback(
    (reason: string) => {
      if (!activeProjectDir) {
        return;
      }

      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
      }
      refreshTimer.current = window.setTimeout(() => {
        void refreshProject(activeProjectDir)
          .then(() => {
            void refreshMessages();
            setStatusLine(reason);
          })
          .catch(() => undefined);
      }, 180);
    },
    [activeProjectDir, refreshProject, refreshMessages, setStatusLine],
  );

  const togglePinSession = useCallback((directory: string, sessionID: string) => {
    setPinnedSessions((current) => {
      const existing = new Set(current[directory] ?? []);
      if (existing.has(sessionID)) {
        existing.delete(sessionID);
      } else {
        existing.add(sessionID);
      }
      return {
        ...current,
        [directory]: [...existing],
      };
    });
  }, []);

  const openProjectContextMenu = useCallback((event: ReactMouseEvent, directory: string, label: string) => {
    event.preventDefault();
    const point = clampContextMenuPosition(event.clientX, event.clientY);
    setContextMenu({
      kind: "project",
      x: point.x,
      y: point.y,
      directory,
      label,
    });
  }, []);

  const openSessionContextMenu = useCallback((event: ReactMouseEvent, directory: string, sessionID: string, title: string) => {
    event.preventDefault();
    event.stopPropagation();
    const point = clampContextMenuPosition(event.clientX, event.clientY);
    setContextMenu({
      kind: "session",
      x: point.x,
      y: point.y,
      directory,
      sessionID,
      title,
    });
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PINNED_SESSIONS_KEY, JSON.stringify(pinnedSessions));
  }, [pinnedSessions]);

  useEffect(() => {
    activeProjectDirRef.current = activeProjectDir;
  }, [activeProjectDir]);

  useEffect(() => {
    activeSessionIDRef.current = activeSessionID;
  }, [activeSessionID]);

  useEffect(() => {
    return () => {
      stopResponsePolling();
    };
  }, [stopResponsePolling]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [contextMenu]);

  return {
    sidebarMode,
    setSidebarMode,
    activeProjectDir,
    setActiveProjectDir,
    projectData,
    setProjectData,
    activeSessionID,
    setActiveSessionID,
    pendingSessionId,
    clearPendingSession: () => setPendingSessionId(undefined),
    messages,
    setMessages,
    contextMenu,
    setContextMenu,
    pinnedSessions,
    setPinnedSessions,
    collapsedProjects,
    setCollapsedProjects,
    refreshProject,
    selectProject,
    openWorkspaceDashboard,
    refreshMessages,
    selectSession,
    createSession,
    queueRefresh,
    startResponsePolling,
    stopResponsePolling,
    togglePinSession,
    openProjectContextMenu,
    openSessionContextMenu,
  };
}
