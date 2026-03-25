import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Event as OpencodeEvent, Session } from "@opencode-ai/sdk/v2/client";
import type { ProjectBootstrap, SessionMessageBundle, SessionPermissionMode } from "@shared/ipc";
import type { TerminalTab } from "../components/TerminalPanel";
import { readPersistedValue, removePersistedValue, writePersistedValue } from "../lib/persistence";
import { makeUnifiedSessionKey } from "../state/unified-runtime";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";
import {
  applyOpencodeProjectEvent,
  applyOpencodeSessionEvent,
  normalizeMessageBundles,
} from "../lib/opencode-event-reducer";
import { getPersistedOpencodeState, mergeOpencodeMessages } from "./opencode-session-storage";

const PINNED_SESSIONS_KEY = "orxa:pinnedSessions:v1";
export const EMPTY_WORKSPACE_SESSIONS_KEY = "orxa:emptyWorkspaceSessions:v1";
const EMPTY_MESSAGE_BUNDLES: SessionMessageBundle[] = [];

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
  scheduleGitRefresh?: (delayMs?: number) => void;
  onCleanupEmptySession?: (directory: string, sessionID: string) => void | Promise<void>;
};

type CreateSessionPromptOptions = {
  selectedAgent?: string;
  selectedModelPayload?: { providerID: string; modelID: string };
  selectedVariant?: string;
  permissionMode?: SessionPermissionMode;
  availableAgentNames: Set<string>;
};

type SelectProjectOptions = {
  showLanding?: boolean;
  sessionID?: string;
};

function deriveSessionTitleFromPrompt(prompt: string, maxLength = 56) {
  const cleaned = prompt
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-_:,.!?/]/gu, "")
    .trim();
  if (!cleaned) {
    return "OpenCode Session";
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

async function loadOpencodeRuntimeSnapshot(directory: string, sessionID: string) {
  return window.orxa.opencode.getSessionRuntime(directory, sessionID);
}

function readPersistedEmptySessions() {
  if (typeof window === "undefined") {
    return new Map<string, string>();
  }
  try {
    const raw = readPersistedValue(EMPTY_WORKSPACE_SESSIONS_KEY);
    if (!raw) {
      return new Map<string, string>();
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return new Map<string, string>();
    }
    return new Map(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0),
    );
  } catch {
    return new Map<string, string>();
  }
}

export function useWorkspaceState(options: UseWorkspaceStateOptions) {
  const {
    setStatusLine,
    terminalTabIds,
    setTerminalTabs,
    setActiveTerminalId,
    setTerminalOpen,
    onCleanupEmptySession,
  } = options;

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("projects");
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [pinnedSessions, setPinnedSessions] = useState<Record<string, string[]>>(() => {
    try {
      const raw = readPersistedValue(PINNED_SESSIONS_KEY);
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
  const removeOpencodeSession = useUnifiedRuntimeStore((state) => state.removeOpencodeSession);
  const setWorkspaceMeta = useUnifiedRuntimeStore((state) => state.setWorkspaceMeta);
  const setOpencodeMessages = useUnifiedRuntimeStore((state) => state.setOpencodeMessages);
  const setOpencodeRuntimeSnapshot = useUnifiedRuntimeStore((state) => state.setOpencodeRuntimeSnapshot);
  const setOpencodeTodoItems = useUnifiedRuntimeStore((state) => state.setOpencodeTodoItems);
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
  const persistedEmptySessionIds = useRef<Map<string, string>>(readPersistedEmptySessions());

  const getRuntimeState = useCallback(() => useUnifiedRuntimeStore.getState(), []);

  const persistEmptySessionIds = useCallback(() => {
    try {
      const next = Object.fromEntries(persistedEmptySessionIds.current.entries());
      if (Object.keys(next).length === 0) {
        removePersistedValue(EMPTY_WORKSPACE_SESSIONS_KEY);
        return;
      }
      writePersistedValue(EMPTY_WORKSPACE_SESSIONS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const rememberEmptySession = useCallback((sessionID: string, directory: string) => {
    emptySessionIds.current.set(sessionID, directory);
    persistedEmptySessionIds.current.set(sessionID, directory);
    persistEmptySessionIds();
  }, [persistEmptySessionIds]);

  const forgetEmptySession = useCallback((sessionID: string) => {
    emptySessionIds.current.delete(sessionID);
    if (persistedEmptySessionIds.current.delete(sessionID)) {
      persistEmptySessionIds();
    }
  }, [persistEmptySessionIds]);

  const setProjectData = useCallback((next: ProjectBootstrap | null) => {
    if (next) {
      setProjectDataForDirectory(next.directory, next);
    }
  }, [setProjectDataForDirectory]);

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

  const finalizeEmptySessionCleanup = useCallback(async (directory: string, sessionID: string) => {
    forgetEmptySession(sessionID);
    const state = getRuntimeState();
    const cachedProject = state.projectDataByDirectory[directory];
    if (cachedProject?.sessions.some((session) => session.id === sessionID)) {
      const nextSessionStatus = { ...cachedProject.sessionStatus };
      delete nextSessionStatus[sessionID];
      const nextProject = {
        ...cachedProject,
        sessions: cachedProject.sessions.filter((session) => session.id !== sessionID),
        sessionStatus: nextSessionStatus,
      };
      setProjectDataForDirectory(directory, nextProject);
      if (state.activeWorkspaceDirectory === directory) {
        setProjectData(nextProject);
      }
    }
    removeOpencodeSession(directory, sessionID);
    if (state.activeWorkspaceDirectory === directory && state.activeSessionID === sessionID) {
      setActiveSessionID(undefined);
      setMessages([]);
    }
    if (useUnifiedRuntimeStore.getState().pendingSessionId === sessionID) {
      setPendingSessionId(undefined);
    }
    await onCleanupEmptySession?.(directory, sessionID);
  }, [forgetEmptySession, getRuntimeState, onCleanupEmptySession, removeOpencodeSession, setActiveSessionID, setMessages, setPendingSessionId, setProjectData, setProjectDataForDirectory]);

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
  const cleanupEmptySession = useCallback(async (sessionID: string | undefined) => {
    if (!sessionID) return;
    const directory = emptySessionIds.current.get(sessionID) ?? persistedEmptySessionIds.current.get(sessionID);
    if (!directory) return;
    await finalizeEmptySessionCleanup(directory, sessionID);
    await window.orxa.opencode.deleteSession(directory, sessionID).catch(() => undefined);
  }, [finalizeEmptySessionCleanup]);

  const cleanupPersistedEmptySessions = useCallback(async () => {
    const trackedSessions = [...persistedEmptySessionIds.current.entries()];
    for (const [sessionID, directory] of trackedSessions) {
      try {
        await window.orxa.opencode.deleteSession(directory, sessionID);
        await finalizeEmptySessionCleanup(directory, sessionID);
      } catch {
        // Keep the persisted marker so startup can retry next time.
      }
    }
  }, [finalizeEmptySessionCleanup]);

  // Call when a message is sent in a session — removes it from the empty set
  const markSessionUsed = useCallback((sessionID: string) => {
    forgetEmptySession(sessionID);
  }, [forgetEmptySession]);

  const commitProjectData = useCallback((directory: string, project: ProjectBootstrap) => {
    setProjectDataForDirectory(directory, project);
    const runtimeState = getRuntimeState();
    if (runtimeState.activeWorkspaceDirectory === directory) {
      setProjectData(project);
    }
    const lastUpdated = project.sessions.reduce((max, session) => Math.max(max, session.time.updated), 0);
    setWorkspaceMeta(directory, { lastUpdatedAt: lastUpdated });
  }, [getRuntimeState, setProjectData, setProjectDataForDirectory, setWorkspaceMeta]);

  const applyOpencodeStreamEvent = useCallback((directory: string, event: OpencodeEvent) => {
    const state = getRuntimeState();
    const existingProject = state.projectDataByDirectory[directory];
    const nextProject = applyOpencodeProjectEvent(existingProject ?? null, event);
    if (nextProject) {
      const normalizedSessions = [...nextProject.sessions].sort((left: Session, right: Session) => right.time.updated - left.time.updated);
      commitProjectData(directory, {
        ...nextProject,
        sessions: normalizedSessions,
      });
    }

    const eventSessionID = (() => {
      const properties = event.properties as Record<string, unknown> | undefined;
      if (!properties) {
        return undefined;
      }
      if (typeof properties.sessionID === "string") {
        return properties.sessionID;
      }
      const info = properties.info;
      if (info && typeof info === "object" && typeof (info as { sessionID?: unknown }).sessionID === "string") {
        return (info as { sessionID: string }).sessionID;
      }
      const part = properties.part;
      if (part && typeof part === "object" && typeof (part as { sessionID?: unknown }).sessionID === "string") {
        return (part as { sessionID: string }).sessionID;
      }
      return undefined;
    })();

    if (!eventSessionID) {
      return;
    }

    const opencodeSessionKey = makeUnifiedSessionKey("opencode", directory, eventSessionID);
    const currentRuntime = useUnifiedRuntimeStore.getState().opencodeSessions[opencodeSessionKey];
    const applied = applyOpencodeSessionEvent({
      directory,
      sessionID: eventSessionID,
      snapshot: currentRuntime?.runtimeSnapshot ?? null,
      messages: currentRuntime?.messages ?? [],
      event,
    });

    if (applied.todoItems) {
      const mapped = applied.todoItems.map((item, index) => ({
        id: `todo-${index}`,
        content: item.content ?? "",
        status: item.status === "completed"
          ? "completed" as const
          : item.status === "in_progress"
            ? "in_progress" as const
            : item.status === "cancelled"
              ? "cancelled" as const
              : "pending" as const,
      }));
      setOpencodeTodoItems(directory, eventSessionID, mapped);
    }

    if (!applied.changed || !applied.snapshot) {
      return;
    }

    setOpencodeRuntimeSnapshot(directory, eventSessionID, {
      ...applied.snapshot,
      messages: normalizeMessageBundles(applied.messages),
    });
  }, [commitProjectData, getRuntimeState, setOpencodeRuntimeSnapshot, setOpencodeTodoItems]);

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
    async (directory: string, options?: SelectProjectOptions) => {
      const showLanding = options?.showLanding ?? true;
      const nextSessionID = showLanding ? undefined : options?.sessionID;
      try {
        await cleanupEmptySession(getRuntimeState().activeSessionID);
        setStatusLine(`Loading workspace ${directory}`);
        const cached = getRuntimeState().projectDataByDirectory[directory];
        setProjectData(cached ?? null);
        setMessages([]);
        setActiveSessionID(nextSessionID);
        setTerminalOpen(false);
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

        setTerminalTabs(data.ptys.map((p, i) => ({ id: p.id, label: `Tab ${i + 1}` })));
        setActiveTerminalId(data.ptys[0]?.id);
        setActiveSessionID(nextSessionID);
        setStatusLine(`Loaded ${directory}`);
      } catch (error) {
        setPendingSessionId(undefined);
        setStatusLine(error instanceof Error ? error.message : String(error));
      }
    },
    [cleanupEmptySession, getRuntimeState, setActiveProjectDir, setActiveSessionID, setActiveTerminalId, setCollapsedProjects, setMessages, setPendingSessionId, setProjectData, setProjectDataForDirectory, setStatusLine, setTerminalOpen, setTerminalTabs, setWorkspaceMeta],
  );

  const openWorkspaceDashboard = useCallback(async () => {
    await cleanupEmptySession(getRuntimeState().activeSessionID);
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
      return undefined;
    }

    try {
      const sessionAtStart = activeSessionID;
      if (getRuntimeState().activeSessionID !== sessionAtStart) {
        return undefined;
      }
      const runtime = await loadOpencodeRuntimeSnapshot(activeProjectDir, sessionAtStart);
        const normalized = normalizeMessageBundles(runtime.messages);
        // Merge server messages with locally persisted messages to recover
        // any that the server may not have retained.
        const persistKey = makeUnifiedSessionKey("opencode", activeProjectDir, sessionAtStart);
        const persisted = getPersistedOpencodeState(persistKey);
        const merged = mergeOpencodeMessages(normalized, persisted.messages);
        if (getRuntimeState().activeSessionID === sessionAtStart) {
          const runtimeProject = buildRuntimeProjectSlice(activeProjectDir, runtime);
          setOpencodeRuntimeSnapshot(activeProjectDir, sessionAtStart, {
            ...runtime,
            sessionStatus: runtime.sessionStatus ?? runtimeProject.sessionStatus[sessionAtStart],
            permissions: runtimeProject.permissions,
            questions: runtimeProject.questions,
            commands: runtimeProject.commands,
            messages: merged,
          });
        }
      return runtime;
    } catch (error) {
      setStatusLine(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }, [activeProjectDir, activeSessionID, buildRuntimeProjectSlice, getRuntimeState, setOpencodeRuntimeSnapshot, setStatusLine]);

  const selectSession = useCallback(
    async (sessionID: string, directoryOverride?: string) => {
      const targetDirectory = directoryOverride ?? getRuntimeState().activeWorkspaceDirectory;
      if (!targetDirectory) {
        return;
      }
      // Clean up the session we're leaving if it was empty
      const currentSessionID = getRuntimeState().activeSessionID;
      if (currentSessionID && currentSessionID !== sessionID) {
        await cleanupEmptySession(currentSessionID);
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
    (...args: [string, string]) => {
      void args;
      stopResponsePolling();
    },
    [stopResponsePolling],
  );

  const createSession = useCallback(
    async (directory?: string, initialPrompt?: string, promptOptions?: CreateSessionPromptOptions): Promise<string | undefined> => {
      const targetDirectory = directory ?? activeProjectDir;
      if (!targetDirectory) {
        return undefined;
      }

      const firstPrompt = initialPrompt?.trim() ?? "";
      const title = firstPrompt.length > 0 ? deriveSessionTitleFromPrompt(firstPrompt) : "OpenCode Session";

      // Clean up previous empty session before creating a new one
      await cleanupEmptySession(getRuntimeState().activeSessionID);

      setMessages([]);
      stopResponsePolling();

      try {
        if (activeProjectDir !== targetDirectory) {
          setPendingSessionId(`creating:${targetDirectory}`);
          await selectProject(targetDirectory, { showLanding: false });
        }
        const createdSession = await window.orxa.opencode.createSession(
          targetDirectory,
          title,
          promptOptions?.permissionMode ?? "ask-write",
        );
        const nextSessionID = createdSession.id;
        setPendingSessionId(undefined);
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
            ? promptOptions.availableAgentNames.has(promptOptions.selectedAgent)
            : false;
          await window.orxa.opencode.sendPrompt({
            directory: targetDirectory,
            sessionID: resolvedSessionID,
            text: firstPrompt,
            agent: supportsSelectedAgent ? promptOptions?.selectedAgent : undefined,
            model: promptOptions?.selectedModelPayload,
            variant: promptOptions?.selectedVariant,
          });
          void loadOpencodeRuntimeSnapshot(targetDirectory, resolvedSessionID)
            .then((runtime) => {
              const normalized = normalizeMessageBundles(runtime.messages);
              const runtimeProject = buildRuntimeProjectSlice(targetDirectory, runtime);
              setOpencodeRuntimeSnapshot(targetDirectory, resolvedSessionID, {
                ...runtime,
                sessionStatus: runtime.sessionStatus ?? runtimeProject.sessionStatus[resolvedSessionID],
                permissions: runtimeProject.permissions,
                questions: runtimeProject.questions,
                commands: runtimeProject.commands,
                messages: normalized,
              });
            })
            .catch(() => undefined);
          setStatusLine("Session started");
        } else {
          if (resolvedSessionID) {
            setPendingSessionId(resolvedSessionID);
            // No initial prompt — mark session as empty so it gets cleaned up if user navigates away
            rememberEmptySession(resolvedSessionID, targetDirectory);
          }
          setStatusLine("Session created");
        }
        return resolvedSessionID;
      } catch (error) {
        setPendingSessionId(undefined);
        setStatusLine(error instanceof Error ? error.message : String(error));
        return undefined;
      }
    },
    [activeProjectDir, buildRuntimeProjectSlice, cleanupEmptySession, getRuntimeState, refreshProject, rememberEmptySession, selectProject, setActiveProjectDir, setActiveSessionID, setMessages, setOpencodeRuntimeSnapshot, setPendingSessionId, setStatusLine, stopResponsePolling],
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
    writePersistedValue(PINNED_SESSIONS_KEY, JSON.stringify(pinnedSessions));
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
    applyOpencodeStreamEvent,
    queueRefresh,
    startResponsePolling,
    stopResponsePolling,
    togglePinSession,
    openProjectContextMenu,
    openSessionContextMenu,
    markSessionUsed,
    cleanupPersistedEmptySessions,
  };
}
