import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ProjectBootstrap, SessionMessageBundle, SessionPermissionMode } from "@shared/ipc";
import type { TerminalTab } from "../components/TerminalPanel";
import { makeUnifiedSessionKey } from "../state/unified-runtime";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";

const PINNED_SESSIONS_KEY = "orxa:pinnedSessions:v1";
const RESPONSE_POLL_BASE_DELAY_MS = 1500;
const RESPONSE_POLL_MAX_DELAY_MS = 5_400;
const EMPTY_MESSAGE_BUNDLES: SessionMessageBundle[] = [];

type SidebarMode = "projects" | "jobs" | "skills" | "memory";

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
};

type CreateSessionPromptOptions = {
  selectedAgent?: string;
  selectedModelPayload?: { providerID: string; modelID: string };
  selectedVariant?: string;
  permissionMode?: SessionPermissionMode;
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

function mergeMessageParts(previous: SessionMessageBundle["parts"], next: SessionMessageBundle["parts"]) {
  // Use ID-based merging to preserve part ordering even when tool items
  // interleave between text deltas during streaming. Parts with valid IDs
  // are deduplicated (newer wins). Parts without IDs are deduplicated by
  // content hash to avoid duplicating fallback entries.
  const merged = new Map<string, SessionMessageBundle["parts"][number]>();
  const seenFallbackKeys = new Set<string>();
  const ordered: string[] = [];

  for (const part of [...previous, ...next]) {
    if (typeof part.id === "string" && part.id.length > 0) {
      if (!merged.has(part.id)) {
        ordered.push(part.id);
      }
      merged.set(part.id, part);
    } else {
      // Fallback: derive a key from type + first 100 chars of content to avoid duplicates
      const content = typeof (part as { content?: unknown }).content === "string"
        ? ((part as { content?: string }).content ?? "").slice(0, 100)
        : "";
      const key = `_fb_${part.type}_${content}`;
      if (!seenFallbackKeys.has(key)) {
        seenFallbackKeys.add(key);
        ordered.push(key);
      }
      merged.set(key, part);
    }
  }

  return ordered.map((key) => merged.get(key)!);
}

function messageUpdatedAt(info: SessionMessageBundle["info"]) {
  const timeRecord = info.time as Record<string, unknown>;
  const updated = typeof timeRecord.updated === "number" ? timeRecord.updated : undefined;
  const created = typeof timeRecord.created === "number" ? timeRecord.created : 0;
  return updated ?? created;
}

export function normalizeMessageBundles(items: SessionMessageBundle[]) {
  if (items.length <= 1) {
    return items;
  }
  const byId = new Map<string, SessionMessageBundle>();
  for (const item of items) {
    const existing = byId.get(item.info.id);
    if (!existing) {
      byId.set(item.info.id, item);
      continue;
    }
    const itemUpdatedAt = messageUpdatedAt(item.info);
    const existingUpdatedAt = messageUpdatedAt(existing.info);
    const nextInfo = itemUpdatedAt >= existingUpdatedAt ? item.info : existing.info;
    byId.set(item.info.id, {
      ...item,
      info: nextInfo,
      parts: mergeMessageParts(existing.parts, item.parts),
    });
  }
  return [...byId.values()].sort((a, b) => a.info.time.created - b.info.time.created);
}

async function loadOpencodeRuntimeSnapshot(directory: string, sessionID: string) {
  return window.orxa.opencode.getSessionRuntime(directory, sessionID);
}

export function useWorkspaceState(options: UseWorkspaceStateOptions) {
  const {
    setStatusLine,
    terminalTabIds,
    setTerminalTabs,
    setActiveTerminalId,
    setTerminalOpen,
  } = options;

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("projects");
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
  const activeProjectDir = useUnifiedRuntimeStore((state) => state.activeWorkspaceDirectory);
  const setActiveProjectDir = useUnifiedRuntimeStore((state) => state.setActiveWorkspaceDirectory);
  const activeSessionID = useUnifiedRuntimeStore((state) => state.activeSessionID);
  const setActiveSession = useUnifiedRuntimeStore((state) => state.setActiveSession);
  const pendingSessionId = useUnifiedRuntimeStore((state) => state.pendingSessionId);
  const setPendingSessionId = useUnifiedRuntimeStore((state) => state.setPendingSessionId);
  const projectData = useUnifiedRuntimeStore((state) =>
    activeProjectDir ? (state.projectDataByDirectory[activeProjectDir] ?? null) : null,
  );
  const setProjectDataForDirectory = useUnifiedRuntimeStore((state) => state.setProjectData);
  const removeProjectData = useUnifiedRuntimeStore((state) => state.removeProjectData);
  const setWorkspaceMeta = useUnifiedRuntimeStore((state) => state.setWorkspaceMeta);
  const setOpencodeMessages = useUnifiedRuntimeStore((state) => state.setOpencodeMessages);
  const setOpencodeRuntimeSnapshot = useUnifiedRuntimeStore((state) => state.setOpencodeRuntimeSnapshot);
  const collapsedProjects = useUnifiedRuntimeStore((state) => state.collapsedProjects);
  const replaceCollapsedProjects = useUnifiedRuntimeStore((state) => state.replaceCollapsedProjects);
  const messages = useUnifiedRuntimeStore((state) => {
    if (!activeProjectDir || !activeSessionID) {
      return EMPTY_MESSAGE_BUNDLES;
    }
    const key = makeUnifiedSessionKey("opencode", activeProjectDir, activeSessionID);
    return state.opencodeSessions[key]?.messages ?? EMPTY_MESSAGE_BUNDLES;
  });

  const refreshTimer = useRef<number | undefined>(undefined);
  const messageRefreshTimer = useRef<number | undefined>(undefined);
  const responsePollTimer = useRef<number | undefined>(undefined);
  const eventRefreshInFlight = useRef(false);
  const messageRefreshInFlight = useRef(false);
  // Track sessions that were created but never had a message sent — cleaned up on navigation
  const emptySessionIds = useRef<Map<string, string>>(new Map()); // sessionID → directory

  const getRuntimeState = useCallback(() => useUnifiedRuntimeStore.getState(), []);

  const setProjectData = useCallback((next: ProjectBootstrap | null) => {
    if (next) {
      setProjectDataForDirectory(next.directory, next);
      return;
    }
    const currentDirectory = getRuntimeState().activeWorkspaceDirectory;
    if (currentDirectory) {
      removeProjectData(currentDirectory);
    }
  }, [getRuntimeState, removeProjectData, setProjectDataForDirectory]);

  const setActiveSessionID = useCallback((sessionID: string | undefined) => {
    setActiveSession(sessionID, sessionID ? "opencode" : undefined);
  }, [setActiveSession]);

  const setMessages = useCallback((next: SessionMessageBundle[]) => {
    const state = getRuntimeState();
    const directory = state.activeWorkspaceDirectory;
    const sessionID = state.activeSessionID;
    if (!directory || !sessionID) {
      return;
    }
    setOpencodeMessages(directory, sessionID, next);
  }, [getRuntimeState, setOpencodeMessages]);

  const setCollapsedProjects = useCallback((updater: Record<string, boolean> | ((current: Record<string, boolean>) => Record<string, boolean>)) => {
    const current = useUnifiedRuntimeStore.getState().collapsedProjects;
    const next = typeof updater === "function" ? updater(current) : updater;
    replaceCollapsedProjects(next);
  }, [replaceCollapsedProjects]);

  const buildRuntimeProjectSlice = useCallback(
    (
      directory: string,
      runtime: {
        sessionID: string;
        sessionStatus?: ProjectBootstrap["sessionStatus"][string];
        permissions?: ProjectBootstrap["permissions"];
        questions?: ProjectBootstrap["questions"];
        commands?: ProjectBootstrap["commands"];
      },
    ) => {
      const cachedProject = getRuntimeState().projectDataByDirectory[directory];
      return {
        directory,
        sessionStatus: {
          ...(cachedProject?.sessionStatus ?? {}),
          [runtime.sessionID]: runtime.sessionStatus ?? cachedProject?.sessionStatus?.[runtime.sessionID] ?? { type: "idle" },
        },
        permissions: runtime.permissions ?? [],
        questions: runtime.questions ?? [],
        commands: runtime.commands ?? [],
      };
    },
    [getRuntimeState],
  );

  // Delete any empty (no messages sent) session that is being navigated away from.
  // Fire-and-forget — the sidebar refresh after navigation will pick up the deletion.
  const cleanupEmptySession = useCallback((sessionID: string | undefined) => {
    if (!sessionID) return;
    const directory = emptySessionIds.current.get(sessionID);
    if (!directory) return;
    emptySessionIds.current.delete(sessionID);
    void window.orxa.opencode.deleteSession(directory, sessionID).catch(() => undefined);
  }, []);

  // Call when a message is sent in a session — removes it from the empty set
  const markSessionUsed = useCallback((sessionID: string) => {
    emptySessionIds.current.delete(sessionID);
  }, []);

  const refreshProject = useCallback(
    async (directory: string, skipMessageLoad = false) => {
      try {
        const data = await window.orxa.opencode.refreshProject(directory);
        setProjectDataForDirectory(directory, data);
        const currentState = getRuntimeState();
        if (currentState.activeWorkspaceDirectory === directory) {
          setProjectData(data);
        }
        const lastUpdated = data.sessions.reduce((max, session) => Math.max(max, session.time.updated), 0);
        setWorkspaceMeta(directory, { lastUpdatedAt: lastUpdated });

        const sortedSessions = [...data.sessions].sort((a, b) => b.time.updated - a.time.updated);
        const currentActiveSessionID =
          currentState.activeWorkspaceDirectory === directory
            ? currentState.activeSessionID
            : undefined;
        let nextSessionID = currentActiveSessionID;
        if (nextSessionID && !sortedSessions.some((item) => item.id === nextSessionID)) {
          const previousStatus = currentState.projectDataByDirectory[directory]?.sessionStatus[nextSessionID]?.type;
          const isPossiblyInFlight = previousStatus === "busy" || previousStatus === "retry";
          if (!isPossiblyInFlight) {
            nextSessionID = undefined;
            setActiveSessionID(undefined);
            setMessages([]);
          }
        }

        const serverPtyIds = data.ptys.map((p) => p.id);
        const hasValidTab = terminalTabIds.some((id) => serverPtyIds.includes(id));
        if (!hasValidTab && serverPtyIds.length > 0) {
          setTerminalTabs(data.ptys.map((p, i) => ({ id: p.id, label: `Tab ${i + 1}` })));
          setActiveTerminalId(data.ptys[0]?.id);
        }

        if (nextSessionID && !skipMessageLoad) {
          const latest = await loadOpencodeRuntimeSnapshot(directory, nextSessionID).catch(() => undefined);
          if (latest && getRuntimeState().activeSessionID === nextSessionID) {
            const normalized = normalizeMessageBundles(latest.messages);
            const runtimeProject = buildRuntimeProjectSlice(directory, latest);
            setOpencodeRuntimeSnapshot(directory, nextSessionID, {
              ...latest,
              sessionStatus: latest.sessionStatus ?? runtimeProject.sessionStatus[nextSessionID],
              permissions: runtimeProject.permissions,
              questions: runtimeProject.questions,
              commands: runtimeProject.commands,
              messages: normalized,
            });
          }
        }

        return data;
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
    [buildRuntimeProjectSlice, getRuntimeState, setActiveSessionID, setActiveTerminalId, setMessages, setOpencodeRuntimeSnapshot, setProjectData, setProjectDataForDirectory, setStatusLine, setTerminalTabs, setWorkspaceMeta, terminalTabIds],
  );

  const selectProject = useCallback(
    async (directory: string) => {
      try {
        cleanupEmptySession(getRuntimeState().activeSessionID);
        setStatusLine(`Loading workspace ${directory}`);
        const cached = getRuntimeState().projectDataByDirectory[directory];
        setProjectData(cached ?? null);
        setMessages([]);
        setActiveSessionID(undefined);
        setTerminalTabs([]);
        setActiveTerminalId(undefined);
        setActiveProjectDir(directory);
        setSidebarMode("projects");
        setCollapsedProjects((current) => ({ ...current, [directory]: false }));
        const data = await window.orxa.opencode.selectProject(directory);
        setProjectDataForDirectory(directory, data);
        setProjectData(data);
        const lastUpdated = data.sessions.reduce((max, session) => Math.max(max, session.time.updated), 0);
        setWorkspaceMeta(directory, { lastUpdatedAt: lastUpdated, lastOpenedAt: Date.now() });

        if (data.ptys.length > 0) {
          setTerminalTabs(data.ptys.map((p, i) => ({ id: p.id, label: `Tab ${i + 1}` })));
          setActiveTerminalId(data.ptys[0]?.id);
        }
        // Don't auto-select a session — show the workspace landing screen instead
        setActiveSessionID(undefined);
        setStatusLine(`Loaded ${directory}`);
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [cleanupEmptySession, getRuntimeState, setActiveProjectDir, setActiveSessionID, setActiveTerminalId, setCollapsedProjects, setMessages, setProjectData, setProjectDataForDirectory, setStatusLine, setTerminalTabs, setWorkspaceMeta],
  );

  const openWorkspaceDashboard = useCallback(() => {
    cleanupEmptySession(getRuntimeState().activeSessionID);
    setSidebarMode("projects");
    setActiveProjectDir(undefined);
    setProjectData(null);
    setActiveSessionID(undefined);
    setTerminalOpen(false);
    setTerminalTabs([]);
    setActiveTerminalId(undefined);
    setStatusLine("Workspace dashboard");
  }, [cleanupEmptySession, getRuntimeState, setActiveProjectDir, setActiveSessionID, setActiveTerminalId, setProjectData, setStatusLine, setTerminalOpen, setTerminalTabs]);

  const refreshMessages = useCallback(async () => {
    if (!activeProjectDir || !activeSessionID) {
      return;
    }

    try {
      const sessionAtStart = activeSessionID;
      if (getRuntimeState().activeSessionID !== sessionAtStart) {
        return;
      }
      const runtime = await loadOpencodeRuntimeSnapshot(activeProjectDir, sessionAtStart);
        const normalized = normalizeMessageBundles(runtime.messages);
        if (getRuntimeState().activeSessionID === sessionAtStart) {
          const runtimeProject = buildRuntimeProjectSlice(activeProjectDir, runtime);
          setOpencodeRuntimeSnapshot(activeProjectDir, sessionAtStart, {
            ...runtime,
            sessionStatus: runtime.sessionStatus ?? runtimeProject.sessionStatus[sessionAtStart],
            permissions: runtimeProject.permissions,
            questions: runtimeProject.questions,
            commands: runtimeProject.commands,
            messages: normalized,
          });
        }
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
    }
  }, [activeProjectDir, activeSessionID, buildRuntimeProjectSlice, getRuntimeState, setOpencodeRuntimeSnapshot, setStatusLine]);

  const selectSession = useCallback(
    (sessionID: string, directoryOverride?: string) => {
      const targetDirectory = directoryOverride ?? getRuntimeState().activeWorkspaceDirectory;
      if (!targetDirectory) {
        return;
      }
      // Clean up the session we're leaving if it was empty
      const currentSessionID = getRuntimeState().activeSessionID;
      if (currentSessionID && currentSessionID !== sessionID) {
        cleanupEmptySession(currentSessionID);
      }
      setActiveProjectDir(targetDirectory);
      setActiveSessionID(sessionID);
      void loadOpencodeRuntimeSnapshot(targetDirectory, sessionID)
        .then((runtime) => {
          const normalized = normalizeMessageBundles(runtime.messages);
          if (getRuntimeState().activeSessionID === sessionID) {
            const runtimeProject = buildRuntimeProjectSlice(targetDirectory, runtime);
            setOpencodeRuntimeSnapshot(targetDirectory, sessionID, {
              ...runtime,
              sessionStatus: runtime.sessionStatus ?? runtimeProject.sessionStatus[sessionID],
              permissions: runtimeProject.permissions,
              questions: runtimeProject.questions,
              commands: runtimeProject.commands,
              messages: normalized,
            });
          }
        })
        .catch(() => undefined);
    },
    [buildRuntimeProjectSlice, cleanupEmptySession, getRuntimeState, setActiveProjectDir, setActiveSessionID, setOpencodeRuntimeSnapshot],
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
      let nextDelayMs = RESPONSE_POLL_BASE_DELAY_MS;
      let unchangedPolls = 0;
      let previousStatus = getRuntimeState().projectDataByDirectory[directory]?.sessionStatus[sessionID]?.type;
      let previousUpdatedAt =
        getRuntimeState().projectDataByDirectory[directory]?.sessions.find((session) => session.id === sessionID)?.time.updated ?? 0;
      const tick = () => {
        if (getRuntimeState().activeWorkspaceDirectory !== directory) {
          stopResponsePolling();
          return;
        }

        void refreshProject(directory, true)
          .then((next) => {
            const latestStatus = next.sessionStatus[sessionID]?.type;
            const latestUpdatedAt = next.sessions.find((session) => session.id === sessionID)?.time.updated ?? 0;
            const changed = latestStatus !== previousStatus || latestUpdatedAt !== previousUpdatedAt;
            previousStatus = latestStatus;
            previousUpdatedAt = latestUpdatedAt;
            if (changed || latestStatus === "idle") {
              void refreshMessages();
              unchangedPolls = 0;
              nextDelayMs = RESPONSE_POLL_BASE_DELAY_MS;
            } else {
              unchangedPolls += 1;
              nextDelayMs = Math.min(RESPONSE_POLL_MAX_DELAY_MS, RESPONSE_POLL_BASE_DELAY_MS + unchangedPolls * 450);
            }
            const status = next.sessionStatus[sessionID];
            const done = status?.type === "idle";
            const timedOut = Date.now() - startedAt > 120_000;
            if (done || timedOut) {
              stopResponsePolling();
              return;
            }
            responsePollTimer.current = window.setTimeout(tick, nextDelayMs);
          })
          .catch(() => {
            const timedOut = Date.now() - startedAt > 30_000;
            if (timedOut) {
              stopResponsePolling();
              return;
            }
            nextDelayMs = Math.min(RESPONSE_POLL_MAX_DELAY_MS, nextDelayMs + 700);
            responsePollTimer.current = window.setTimeout(tick, nextDelayMs);
          });
      };

      responsePollTimer.current = window.setTimeout(tick, RESPONSE_POLL_BASE_DELAY_MS);
    },
    [getRuntimeState, refreshMessages, refreshProject, stopResponsePolling],
  );

  const createSession = useCallback(
    async (directory?: string, initialPrompt?: string, promptOptions?: CreateSessionPromptOptions): Promise<string | undefined> => {
      const targetDirectory = directory ?? activeProjectDir;
      if (!targetDirectory) {
        return undefined;
      }

      const firstPrompt = initialPrompt?.trim() ?? "";
      const title = firstPrompt.length > 0 ? deriveSessionTitleFromPrompt(firstPrompt) : "New session";

      // Clean up previous empty session before creating a new one
      cleanupEmptySession(getRuntimeState().activeSessionID);

      setMessages([]);
      stopResponsePolling();

      try {
        if (activeProjectDir !== targetDirectory) {
          await selectProject(targetDirectory);
        }
        const createdSession = await window.orxa.opencode.createSession(
          targetDirectory,
          title,
          promptOptions?.permissionMode ?? "ask-write",
        );
        const nextSessionID = createdSession.id;
        setActiveSessionID(nextSessionID);
        setActiveProjectDir(targetDirectory);
        setMessages([]);
        const next = await refreshProject(targetDirectory, true);
        const sorted = [...next.sessions].filter((item) => !item.time.archived).sort((a, b) => b.time.updated - a.time.updated);
        const resolvedSessionID = nextSessionID ?? sorted[0]?.id;
        if (!nextSessionID && resolvedSessionID) {
          setActiveSessionID(resolvedSessionID);
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
            // No initial prompt — mark session as empty so it gets cleaned up if user navigates away
            emptySessionIds.current.set(resolvedSessionID, targetDirectory);
          }
          setStatusLine("Session created");
        }
        return resolvedSessionID;
      } catch (error) {
        setStatusLine(error instanceof Error ? error.message : String(error));
        return undefined;
      }
    },
    [activeProjectDir, cleanupEmptySession, getRuntimeState, refreshProject, selectProject, setActiveProjectDir, setActiveSessionID, setMessages, setPendingSessionId, setStatusLine, startResponsePolling, stopResponsePolling],
  );

  const queueRefresh = useCallback(
    (reason: string, delayMs = 180, scope: "messages" | "project" | "both" = "both") => {
      if (!activeProjectDir) {
        return;
      }

      if (scope === "messages") {
        if (messageRefreshTimer.current) {
          window.clearTimeout(messageRefreshTimer.current);
        }
        messageRefreshTimer.current = window.setTimeout(() => {
          if (messageRefreshInFlight.current) {
            return;
          }
          messageRefreshInFlight.current = true;
          void refreshMessages()
            .then(() => {
              setStatusLine(reason);
            })
            .catch(() => undefined)
            .finally(() => {
              messageRefreshInFlight.current = false;
            });
        }, delayMs);
        return;
      }

      if (scope === "project" && refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
      }
      if (scope === "both" && refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
      }
      refreshTimer.current = window.setTimeout(() => {
        if (eventRefreshInFlight.current) {
          return;
        }
        eventRefreshInFlight.current = true;
        void refreshProject(activeProjectDir, true)
          .then(() => {
            if (scope === "both") {
              void refreshMessages();
            }
            setStatusLine(reason);
          })
          .catch(() => undefined)
          .finally(() => {
            eventRefreshInFlight.current = false;
          });
      }, delayMs);
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
    return () => {
      stopResponsePolling();
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current);
      }
      if (messageRefreshTimer.current) {
        window.clearTimeout(messageRefreshTimer.current);
      }
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
    markSessionUsed,
  };
}
