import { useEffect, useRef, useState, useCallback } from "react";
import { Bot, ChevronDown, Columns, Plus, Rows, Shield, ShieldOff, X } from "lucide-react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { readPersistedValue, writePersistedValue } from "../lib/persistence";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";
import { consumeClaudeStartupChunk } from "../lib/claude-terminal-startup";

const TERMINAL_THEME = {
  background: "#000000",
  foreground: "#E5E5E5",
  cursor: "#525252",
  cursorAccent: "#000000",
  selectionBackground: "#22C55E33",
  black: "#000000",
  red: "#EF4444",
  green: "#22C55E",
  yellow: "#F59E0B",
  blue: "#3B82F6",
  magenta: "#A78BFA",
  cyan: "#06B6D4",
  white: "#E5E5E5",
  brightBlack: "#525252",
  brightRed: "#F87171",
  brightGreen: "#4ADE80",
  brightYellow: "#FBBF24",
  brightBlue: "#60A5FA",
  brightMagenta: "#C4B5FD",
  brightCyan: "#22D3EE",
  brightWhite: "#FFFFFF",
};

type PermissionMode = "pending" | "standard" | "full";
const sessionPermissionModes = new Map<string, PermissionMode>();

function getStorageKey(directory: string): string {
  return `claude-permission-mode:${directory}`;
}

function getStoredPermissionMode(directory: string): PermissionMode | null {
  try {
    const stored = readPersistedValue(getStorageKey(directory));
    if (stored === "standard" || stored === "full") return stored;
  } catch {
    // localStorage may not be available
  }
  return null;
}

function storePermissionMode(directory: string, mode: "standard" | "full"): void {
  try {
    writePersistedValue(getStorageKey(directory), mode);
  } catch {
    // localStorage may not be available
  }
}

// ── Persistence layer ──
// Module-level maps that survive React unmount/remount cycles.
// Keyed by `sessionStorageKey:mode:tabId` to uniquely identify a claude terminal session.

type PersistedSession = {
  processId: string;
  storageKey: string;
  directory: string;
  mode: string;
  outputChunks: string[];
  startupBuffer: string[];
  startupReady: boolean;
  exited: boolean;
  exitCode: number | null;
  backgroundUnsubscribe: (() => void) | null;
  listeners: Set<(event: { type: "output"; chunk: string } | { type: "closed"; exitCode: number | null }) => void>;
};

const persistedSessions = new Map<string, PersistedSession>();
const pendingSessionCreates = new Map<string, Promise<PersistedSession>>();

function resetClaudeTerminalPaneStateForTests() {
  sessionPermissionModes.clear();
  pendingSessionCreates.clear();
  persistedSessions.forEach((session) => {
    session.backgroundUnsubscribe?.();
  });
  persistedSessions.clear();
}

if (typeof globalThis !== "undefined") {
  (
    globalThis as typeof globalThis & {
      __resetClaudeTerminalPaneStateForTests?: () => void;
    }
  ).__resetClaudeTerminalPaneStateForTests = resetClaudeTerminalPaneStateForTests;
}

function sessionKey(sessionStorageKey: string, mode: string, tabId?: string): string {
  if (tabId) return `${sessionStorageKey}::${mode}::${tabId}`;
  return `${sessionStorageKey}::${mode}`;
}

async function getOrCreateClaudeSession(
  storageKey: string,
  directory: string,
  mode: "standard" | "full",
  cols: number,
  rows: number,
) {
  const existing = persistedSessions.get(storageKey);
  if (existing && !existing.exited) {
    return existing;
  }
  if (existing?.backgroundUnsubscribe) {
    existing.backgroundUnsubscribe();
  }
  if (existing) {
    persistedSessions.delete(storageKey);
  }

  const pending = pendingSessionCreates.get(storageKey);
  if (pending) {
    return pending;
  }
  if (!window.orxa?.claudeTerminal) {
    throw new Error("Claude terminal bridge not available");
  }

  const createPromise = window.orxa.claudeTerminal
    .create(directory, mode, cols, rows)
    .then(async (result) => {
      const envPrefix = "env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY";
      const claudeCmd = mode === "full" ? "claude --dangerously-skip-permissions" : "claude";
      const session: PersistedSession = {
        processId: result.processId,
        storageKey,
        directory,
        mode,
        outputChunks: [],
        startupBuffer: [],
        startupReady: false,
        exited: false,
        exitCode: null,
        backgroundUnsubscribe: null,
        listeners: new Set(),
      };

      if (window.orxa?.events) {
        session.backgroundUnsubscribe = window.orxa.events.subscribe((event) => {
          if (
            event.type === "pty.output" &&
            event.payload.ptyID === session.processId &&
            event.payload.directory === directory
          ) {
            const next = consumeClaudeStartupChunk(session.startupBuffer, event.payload.chunk as string, session.startupReady);
            session.startupReady = next.startupReady;
            session.startupBuffer = next.startupBuffer;
            const displayChunk = next.displayChunk;
            if (displayChunk) {
              session.outputChunks.push(displayChunk);
              session.listeners.forEach((listener) => listener({ type: "output", chunk: displayChunk }));
            }
          }
          if (
            event.type === "pty.closed" &&
            event.payload.ptyID === session.processId &&
            event.payload.directory === directory
          ) {
            session.exited = true;
            session.exitCode = null;
            session.listeners.forEach((listener) =>
              listener({ type: "closed", exitCode: session.exitCode }),
            );
          }
        });
      }

      await window.orxa.claudeTerminal.write(result.processId, `exec ${envPrefix} ${claudeCmd}\n`);
      persistedSessions.set(storageKey, session);
      pendingSessionCreates.delete(storageKey);
      return session;
    })
    .catch((error) => {
      pendingSessionCreates.delete(storageKey);
      throw error;
    });

  pendingSessionCreates.set(storageKey, createPromise);
  return createPromise;
}

// ── Tab types ──

type ClaudeTab = {
  id: string;
  label: string;
};

type SplitMode = "none" | "horizontal" | "vertical";

let tabCounter = 0;

function createTab(): ClaudeTab {
  tabCounter += 1;
  return { id: `claude-tab-${tabCounter}`, label: `claude ${tabCounter}` };
}

interface Props {
  directory: string;
  sessionStorageKey: string;
  onExit: () => void;
  onFirstInteraction?: () => void;
}

// ── Panel instance ──
// A self-contained panel with its own mini tab bar and terminal.

interface ClaudePanelInstanceProps {
  directory: string;
  sessionStorageKey: string;
  mode: "standard" | "full";
  onClose?: () => void;
  onAllTabsClosed?: () => void;
  onTerminalOutput?: () => void;
}

function ClaudePanelInstance({
  directory,
  sessionStorageKey,
  mode,
  onClose,
  onAllTabsClosed,
  onTerminalOutput,
}: ClaudePanelInstanceProps) {
  const [initialTab] = useState<ClaudeTab>(createTab);
  const [panelTabs, setPanelTabs] = useState<ClaudeTab[]>(() => [initialTab]);
  const [panelActiveTabId, setPanelActiveTabId] = useState<string>(initialTab.id);

  function handleAddTab() {
    const tab = createTab();
    setPanelTabs((prev) => [...prev, tab]);
    setPanelActiveTabId(tab.id);
  }

  function handleCloseTab(tabId: string) {
    const key = sessionKey(sessionStorageKey, mode, tabId);
    const existing = persistedSessions.get(key);
    if (existing) {
      if (existing.backgroundUnsubscribe) existing.backgroundUnsubscribe();
      if (!existing.exited && window.orxa?.claudeTerminal) {
        void window.orxa.claudeTerminal.close(existing.processId);
      }
      pendingSessionCreates.delete(key);
      persistedSessions.delete(key);
    }

    setPanelTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) {
        onAllTabsClosed?.();
        onClose?.();
        return prev;
      }
      if (panelActiveTabId === tabId) {
        setPanelActiveTabId(next[0].id);
      }
      return next;
    });
  }

  return (
    <div className="claude-split-panel">
      <div className="claude-panel-tab-bar">
        {panelTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`claude-tab ${panelActiveTabId === tab.id ? "active" : ""}`}
            onClick={() => setPanelActiveTabId(tab.id)}
          >
            <span className="claude-tab-label">{tab.label}</span>
            <span
              className="claude-tab-close"
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                handleCloseTab(tab.id);
              }}
            >
              <X size={10} />
            </span>
          </button>
        ))}
        <button
          type="button"
          className="claude-tab claude-tab-add"
          onClick={handleAddTab}
          aria-label="New tab"
        >
          <Plus size={12} />
        </button>
        {onClose && (
          <button
            type="button"
            className="claude-panel-close-btn"
            onClick={onClose}
            aria-label="Close panel"
          >
            <X size={11} />
          </button>
        )}
      </div>
      <ClaudeTerminalInstance
        key={panelActiveTabId}
        directory={directory}
        sessionStorageKey={sessionStorageKey}
        mode={mode}
        tabId={panelActiveTabId}
        onOutput={onTerminalOutput}
      />
    </div>
  );
}

// ── Single terminal instance ──
// Extracted so it can be rendered independently for tabs and split panels.

function ClaudeTerminalInstance({
  directory,
  sessionStorageKey,
  mode,
  tabId,
  onOutput,
}: {
  directory: string;
  sessionStorageKey: string;
  mode: "standard" | "full";
  tabId: string;
  onOutput?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const processIdRef = useRef<string | null>(null);
  const cleanupRef = useRef<Array<() => void>>([]);

  function runCleanups() {
    for (const cleanup of cleanupRef.current) cleanup();
    cleanupRef.current = [];
  }

  const launchTerminal = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!window.orxa?.claudeTerminal) return;

    runCleanups();
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
    container.innerHTML = "";

    const terminal = new Terminal({
      fontFamily: '"JetBrains Mono", "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      cursorBlink: true,
      cursorStyle: "bar",
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fit;

    const cleanups: Array<() => void> = [];
    const key = sessionKey(sessionStorageKey, mode, tabId);
    let detached = false;
    void getOrCreateClaudeSession(key, directory, mode, terminal.cols, terminal.rows).then((session) => {
      if (detached) {
        return;
      }
      processIdRef.current = session.processId;
      session.outputChunks.forEach((chunk) => terminal.write(chunk));
      const listener = (event: { type: "output"; chunk: string } | { type: "closed"; exitCode: number | null }) => {
        if (terminalRef.current !== terminal) {
          return;
        }
        if (event.type === "output") {
          terminal.write(event.chunk);
          onOutput?.();
          return;
        }
        terminal.writeln("\r\n\u001b[33m[claude session ended]\u001b[0m");
      };
      session.listeners.add(listener);
      cleanups.push(() => {
        session.listeners.delete(listener);
      });
      void window.orxa?.claudeTerminal?.resize(session.processId, terminal.cols, terminal.rows);
    });
    cleanups.push(() => {
      detached = true;
    });

    const disposeInput = terminal.onData((data) => {
      const pid = processIdRef.current;
      if (pid && window.orxa?.claudeTerminal) {
        void window.orxa.claudeTerminal.write(pid, data);
      }
    });
    cleanups.push(() => disposeInput.dispose());

    const resizeObs = new ResizeObserver(() => {
      fit.fit();
      const pid = processIdRef.current;
      if (pid && window.orxa?.claudeTerminal) {
        void window.orxa.claudeTerminal.resize(pid, terminal.cols, terminal.rows);
      }
    });
    resizeObs.observe(container);
    cleanups.push(() => resizeObs.disconnect());

    cleanupRef.current = cleanups;

    requestAnimationFrame(() => terminal.focus());
  }, [directory, mode, onOutput, sessionStorageKey, tabId]);

  useEffect(() => {
    launchTerminal();

    return () => {
      runCleanups();
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;
      processIdRef.current = null;
    };
  }, [launchTerminal]);

  return <div className="claude-terminal-body" ref={containerRef} />;
}

export function ClaudeTerminalPane({
  directory,
  sessionStorageKey,
  onExit,
  onFirstInteraction,
}: Props) {
  const [unavailable, setUnavailable] = useState(false);
  const [rememberChoice, setRememberChoice] = useState(false);
  const busyResetTimerRef = useRef<number | null>(null);
  const initClaudeSession = useUnifiedRuntimeStore((state) => state.initClaudeSession);
  const setClaudeBusy = useUnifiedRuntimeStore((state) => state.setClaudeBusy);
  const setClaudeAwaiting = useUnifiedRuntimeStore((state) => state.setClaudeAwaiting);
  const setClaudeActivityAt = useUnifiedRuntimeStore((state) => state.setClaudeActivityAt);

  const storedMode = getStoredPermissionMode(directory);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(storedMode ?? "pending");

  // Split view state
  const [splitMode, setSplitMode] = useState<SplitMode>("none");
  const [showSplitMenu, setShowSplitMenu] = useState(false);
  // Key used to remount the second panel when a new split is created
  const [splitPanelKey, setSplitPanelKey] = useState(0);

  const clearBusyResetTimer = useCallback(() => {
    if (busyResetTimerRef.current !== null) {
      window.clearTimeout(busyResetTimerRef.current);
      busyResetTimerRef.current = null;
    }
  }, []);

  const handleTerminalOutput = useCallback(() => {
    if (permissionMode === "pending") {
      return;
    }
    setClaudeActivityAt(sessionStorageKey, Date.now());
    setClaudeBusy(sessionStorageKey, true);
    clearBusyResetTimer();
    busyResetTimerRef.current = window.setTimeout(() => {
      busyResetTimerRef.current = null;
      setClaudeBusy(sessionStorageKey, false);
    }, 2200);
  }, [clearBusyResetTimer, permissionMode, sessionStorageKey, setClaudeActivityAt, setClaudeBusy]);

  useEffect(() => {
    const storedSessionMode = sessionPermissionModes.get(sessionStorageKey);
    if (storedSessionMode === "standard" || storedSessionMode === "full") {
      setPermissionMode(storedSessionMode);
      return;
    }
    const storedWorkspaceMode = getStoredPermissionMode(directory);
    if (storedWorkspaceMode === "standard" || storedWorkspaceMode === "full") {
      setPermissionMode(storedWorkspaceMode);
      return;
    }
    setPermissionMode("pending");
  }, [directory, sessionStorageKey]);

  useEffect(() => {
    initClaudeSession(sessionStorageKey, directory);
  }, [directory, initClaudeSession, sessionStorageKey]);

  // Detect unavailable on first render when mode is resolved
  useEffect(() => {
    setUnavailable(permissionMode !== "pending" && !window.orxa?.claudeTerminal);
    // If a stored mode was loaded (skipping permission modal), mark session as used
    if (permissionMode !== "pending") {
      onFirstInteraction?.();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionMode]);

  useEffect(() => {
    const awaiting = permissionMode === "pending";
    setClaudeAwaiting(sessionStorageKey, awaiting);
    if (awaiting) {
      clearBusyResetTimer();
      setClaudeBusy(sessionStorageKey, false);
    }
  }, [clearBusyResetTimer, permissionMode, sessionStorageKey, setClaudeAwaiting, setClaudeBusy]);

  useEffect(() => () => {
    clearBusyResetTimer();
    setClaudeAwaiting(sessionStorageKey, false);
    setClaudeBusy(sessionStorageKey, false);
  }, [clearBusyResetTimer, sessionStorageKey, setClaudeAwaiting, setClaudeBusy]);

  function handlePermissionChoice(mode: "standard" | "full") {
    sessionPermissionModes.set(sessionStorageKey, mode);
    if (rememberChoice) {
      storePermissionMode(directory, mode);
    }
    setPermissionMode(mode);
    onFirstInteraction?.();
  }

  function handleExit() {
    onExit();
  }

  function handleSplit(mode: "horizontal" | "vertical") {
    if (splitMode === "none") {
      setSplitPanelKey((k) => k + 1);
    }
    setSplitMode(mode);
    setShowSplitMenu(false);
  }

  function handleUnsplit() {
    setSplitMode("none");
    setShowSplitMenu(false);
  }

  if (unavailable) {
    return (
      <div className="claude-pane">
        <div className="claude-toolbar">
          <Bot size={14} color="#8b5cf6" />
          <span className="claude-toolbar-label">claude code</span>
          <span className="claude-toolbar-path">{directory}</span>
          <button type="button" className="claude-toolbar-btn" onClick={handleExit}>
            exit
          </button>
        </div>
        <div className="claude-unavailable">
          <Bot size={32} color="var(--text-muted)" />
          <span>Terminal API is not available in this environment.</span>
        </div>
      </div>
    );
  }

  if (permissionMode === "pending") {
    return (
      <div className="claude-pane">
        <div className="claude-toolbar">
          <Bot size={14} color="#8b5cf6" />
          <span className="claude-toolbar-label">claude code</span>
          <span className="claude-toolbar-path">{directory}</span>
          <button type="button" className="claude-toolbar-btn" onClick={handleExit} aria-label="exit">
            <X size={11} />
            exit
          </button>
        </div>
        <div className="claude-permission-modal">
          <div className="claude-permission-content">
            <h3 className="claude-permission-title">Claude Code Permissions</h3>
            <p className="claude-permission-desc">
              Choose how Claude Code should run in this workspace.
            </p>
            <div className="claude-permission-options">
              <button
                type="button"
                className="claude-permission-option"
                onClick={() => handlePermissionChoice("standard")}
              >
                <Shield size={20} />
                <span className="claude-permission-option-label">Standard Mode</span>
                <span className="claude-permission-option-desc">
                  Claude will ask for permission before executing commands or modifying files.
                </span>
              </button>
              <button
                type="button"
                className="claude-permission-option claude-permission-option--full"
                onClick={() => handlePermissionChoice("full")}
              >
                <ShieldOff size={20} />
                <span className="claude-permission-option-label">Full Access Mode</span>
                <span className="claude-permission-option-desc">
                  Claude can execute commands and modify files without asking. Use with caution.
                </span>
              </button>
            </div>
            <label className="claude-permission-remember">
              <input
                type="checkbox"
                checked={rememberChoice}
                onChange={(e) => setRememberChoice(e.target.checked)}
              />
              Remember this choice for this workspace
            </label>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="claude-pane">
      <div className="claude-toolbar">
        <Bot size={14} color="#8b5cf6" />
        <span className="claude-toolbar-label">claude code</span>
        <span className="claude-toolbar-path">{directory}</span>
        <div className="claude-toolbar-split-wrap">
          <button
            type="button"
            className="claude-toolbar-btn"
            onClick={() => setShowSplitMenu((v) => !v)}
            aria-label="split"
          >
            <Columns size={11} />
            split
            <ChevronDown size={9} />
          </button>
          {showSplitMenu && (
            <div className="claude-split-menu">
              <button type="button" className="claude-split-menu-item" onClick={() => handleSplit("horizontal")}>
                <Rows size={12} />
                Split horizontal
              </button>
              <button type="button" className="claude-split-menu-item" onClick={() => handleSplit("vertical")}>
                <Columns size={12} />
                Split vertical
              </button>
              {splitMode !== "none" && (
                <button type="button" className="claude-split-menu-item" onClick={handleUnsplit}>
                  <X size={12} />
                  Unsplit
                </button>
              )}
            </div>
          )}
        </div>
        <button type="button" className="claude-toolbar-btn" onClick={handleExit} aria-label="exit">
          <X size={11} />
          exit
        </button>
      </div>

      {/* Terminal area — each panel has its own tab bar */}
      <div
        className={`claude-split-container ${splitMode === "horizontal" ? "claude-split-horizontal" : ""} ${splitMode === "vertical" ? "claude-split-vertical" : ""}`}
      >
        <ClaudePanelInstance
          directory={directory}
          sessionStorageKey={sessionStorageKey}
          mode={permissionMode}
          onAllTabsClosed={onExit}
          onTerminalOutput={handleTerminalOutput}
        />
        {splitMode !== "none" && (
          <>
            <div className="claude-split-divider" />
            <ClaudePanelInstance
              key={splitPanelKey}
              directory={directory}
              sessionStorageKey={sessionStorageKey}
              mode={permissionMode}
              onClose={handleUnsplit}
              onTerminalOutput={handleTerminalOutput}
            />
          </>
        )}
      </div>
    </div>
  );
}

export function ClaudeBackgroundSessionManager({
  directory,
  sessionStorageKey,
}: {
  directory: string;
  sessionStorageKey: string;
}) {
  const busyResetTimerRef = useRef<number | null>(null);
  const initClaudeSession = useUnifiedRuntimeStore((state) => state.initClaudeSession);
  const setClaudeBusy = useUnifiedRuntimeStore((state) => state.setClaudeBusy);
  const setClaudeAwaiting = useUnifiedRuntimeStore((state) => state.setClaudeAwaiting);
  const setClaudeActivityAt = useUnifiedRuntimeStore((state) => state.setClaudeActivityAt);

  const clearBusyResetTimer = useCallback(() => {
    if (busyResetTimerRef.current !== null) {
      window.clearTimeout(busyResetTimerRef.current);
      busyResetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    initClaudeSession(sessionStorageKey, directory);
    setClaudeAwaiting(sessionStorageKey, false);
  }, [directory, initClaudeSession, sessionStorageKey, setClaudeAwaiting]);

  useEffect(() => {
    const sessions = [...persistedSessions.values()].filter(
      (session) => !session.exited && session.storageKey.startsWith(`${sessionStorageKey}::`),
    );
    if (sessions.length === 0) {
      return;
    }

    const listener = (event: { type: "output"; chunk: string } | { type: "closed"; exitCode: number | null }) => {
      if (event.type === "output") {
        setClaudeActivityAt(sessionStorageKey, Date.now());
        setClaudeBusy(sessionStorageKey, true);
        clearBusyResetTimer();
        busyResetTimerRef.current = window.setTimeout(() => {
          busyResetTimerRef.current = null;
          setClaudeBusy(sessionStorageKey, false);
        }, 2200);
        return;
      }

      const anyOpenSessions = [...persistedSessions.values()].some(
        (session) => !session.exited && session.storageKey.startsWith(`${sessionStorageKey}::`),
      );
      if (!anyOpenSessions) {
        clearBusyResetTimer();
        setClaudeBusy(sessionStorageKey, false);
      }
    };

    sessions.forEach((session) => {
      session.listeners.add(listener);
    });

    return () => {
      sessions.forEach((session) => {
        session.listeners.delete(listener);
      });
    };
  }, [clearBusyResetTimer, sessionStorageKey, setClaudeActivityAt, setClaudeBusy]);

  useEffect(() => () => {
    clearBusyResetTimer();
    setClaudeBusy(sessionStorageKey, false);
  }, [clearBusyResetTimer, sessionStorageKey, setClaudeBusy]);

  return null;
}
