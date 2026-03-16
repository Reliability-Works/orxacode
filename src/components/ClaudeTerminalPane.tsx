import { useEffect, useRef, useState, useCallback } from "react";
import { Bot, ChevronDown, Columns, Plus, RefreshCw, Rows, Shield, ShieldOff, X } from "lucide-react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

const TERMINAL_THEME = {
  background: "#000000",
  foreground: "#E5E5E5",
  cursor: "#22C55E",
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

function getStorageKey(directory: string): string {
  return `claude-permission-mode:${directory}`;
}

function getStoredPermissionMode(directory: string): PermissionMode | null {
  try {
    const stored = localStorage.getItem(getStorageKey(directory));
    if (stored === "standard" || stored === "full") return stored;
  } catch {
    // localStorage may not be available
  }
  return null;
}

function storePermissionMode(directory: string, mode: "standard" | "full"): void {
  try {
    localStorage.setItem(getStorageKey(directory), mode);
  } catch {
    // localStorage may not be available
  }
}

// ── Persistence layer ──
// Module-level maps that survive React unmount/remount cycles.
// Keyed by `directory:mode:tabId` to uniquely identify a claude terminal session.

type PersistedSession = {
  processId: string;
  directory: string;
  mode: string;
  outputChunks: string[];
  exited: boolean;
  exitCode: number | null;
  unsubscribe: (() => void) | null;
};

const persistedSessions = new Map<string, PersistedSession>();

function sessionKey(directory: string, mode: string, tabId?: string): string {
  if (tabId) return `${directory}::${mode}::${tabId}`;
  return `${directory}::${mode}`;
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
  onExit: () => void;
}

// ── Single terminal instance ──
// Extracted so it can be rendered independently for tabs and split panels.

function ClaudeTerminalInstance({
  directory,
  mode,
  tabId,
}: {
  directory: string;
  mode: "standard" | "full";
  tabId: string;
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

    if (!window.orxa?.terminal) return;

    // Dispose any previous xterm instance (but NOT the underlying process)
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
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fit;

    const cleanups: Array<() => void> = [];

    const key = sessionKey(directory, mode, tabId);
    const existing = persistedSessions.get(key);

    if (existing && !existing.exited) {
      processIdRef.current = existing.processId;

      for (const chunk of existing.outputChunks) {
        terminal.write(chunk);
      }

      if (existing.unsubscribe) {
        existing.unsubscribe();
        existing.unsubscribe = null;
      }

      if (window.orxa?.events) {
        const unsubscribe = window.orxa.events.subscribe((event) => {
          if (
            event.type === "pty.output" &&
            event.payload.ptyID === existing.processId &&
            event.payload.directory === directory
          ) {
            const chunk = event.payload.chunk as string;
            existing.outputChunks.push(chunk);
            terminal.write(chunk);
          }
          if (
            event.type === "pty.closed" &&
            event.payload.ptyID === existing.processId &&
            event.payload.directory === directory
          ) {
            existing.exited = true;
            terminal.writeln("\r\n\u001b[33m[claude session ended]\u001b[0m");
          }
        });
        existing.unsubscribe = unsubscribe;
        cleanups.push(() => {
          // On unmount, DON'T unsubscribe — keep collecting output in the background.
        });
      }
    } else {
      if (existing) {
        if (existing.unsubscribe) existing.unsubscribe();
        persistedSessions.delete(key);
      }

      const envPrefix = "env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY";
      const claudeCmd = mode === "full" ? "claude --dangerously-skip-permissions" : "claude";
      const command = `exec ${envPrefix} ${claudeCmd}\n`;

      void window.orxa.terminal.create(directory, directory, "claude code").then((pty) => {
        processIdRef.current = pty.id;

        const session: PersistedSession = {
          processId: pty.id,
          directory,
          mode,
          outputChunks: [],
          exited: false,
          exitCode: null,
          unsubscribe: null,
        };

        void window.orxa.terminal.connect(directory, pty.id).then(() => {
          void window.orxa.terminal.resize(directory, pty.id, terminal.cols, terminal.rows);

          let claudeStarted = false;
          let pendingChunks: string[] = [];

          const unsubscribe = window.orxa.events.subscribe((event) => {
            if (
              event.type === "pty.output" &&
              event.payload.ptyID === pty.id &&
              event.payload.directory === directory
            ) {
              const chunk = event.payload.chunk as string;
              session.outputChunks.push(chunk);

              if (!claudeStarted) {
                pendingChunks.push(chunk);
                const allOutput = pendingChunks.join("");
                if (allOutput.includes("Claude Code") || allOutput.includes("Welcome")) {
                  claudeStarted = true;
                  terminal.clear();
                  terminal.reset();
                  const claudeIdx = allOutput.indexOf("\u2500");
                  if (claudeIdx >= 0) {
                    terminal.write(allOutput.slice(claudeIdx));
                  } else {
                    terminal.write(allOutput);
                  }
                  pendingChunks = [];
                }
              } else {
                if (terminalRef.current === terminal) {
                  terminal.write(chunk);
                }
              }
            }
            if (
              event.type === "pty.closed" &&
              event.payload.ptyID === pty.id &&
              event.payload.directory === directory
            ) {
              session.exited = true;
              if (terminalRef.current === terminal) {
                terminal.writeln("\r\n\u001b[33m[claude session ended]\u001b[0m");
              }
            }
          });
          session.unsubscribe = unsubscribe;

          void window.orxa.terminal.write(directory, pty.id, command);
        });

        persistedSessions.set(key, session);
      });
    }

    const disposeInput = terminal.onData((data) => {
      const pid = processIdRef.current;
      if (pid && window.orxa?.terminal) {
        void window.orxa.terminal.write(directory, pid, data);
      }
    });
    cleanups.push(() => disposeInput.dispose());

    const resizeObs = new ResizeObserver(() => {
      fit.fit();
      const pid = processIdRef.current;
      if (pid && window.orxa?.terminal) {
        void window.orxa.terminal.resize(directory, pid, terminal.cols, terminal.rows);
      }
    });
    resizeObs.observe(container);
    cleanups.push(() => resizeObs.disconnect());

    cleanupRef.current = cleanups;

    requestAnimationFrame(() => terminal.focus());
  }, [directory, mode, tabId]);

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

export function ClaudeTerminalPane({ directory, onExit }: Props) {
  const [unavailable, setUnavailable] = useState(false);
  const [rememberChoice, setRememberChoice] = useState(false);

  const storedMode = getStoredPermissionMode(directory);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(storedMode ?? "pending");

  // Multi-tab state
  const [tabs, setTabs] = useState<ClaudeTab[]>(() => [createTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);

  // Split view state
  const [splitMode, setSplitMode] = useState<SplitMode>("none");
  const [splitTabId, setSplitTabId] = useState<string | null>(null);
  const [showSplitMenu, setShowSplitMenu] = useState(false);

  // Detect unavailable on first render when mode is resolved
  useEffect(() => {
    if (permissionMode !== "pending" && !window.orxa?.terminal) {
      setUnavailable(true);
    }
  }, [permissionMode]);

  function handlePermissionChoice(mode: "standard" | "full") {
    if (rememberChoice) {
      storePermissionMode(directory, mode);
    }
    setPermissionMode(mode);
  }

  function handleAddTab() {
    const tab = createTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }

  function handleCloseTab(tabId: string) {
    // Kill the persisted session for this tab
    if (permissionMode !== "pending") {
      const key = sessionKey(directory, permissionMode, tabId);
      const existing = persistedSessions.get(key);
      if (existing) {
        if (existing.unsubscribe) existing.unsubscribe();
        if (!existing.exited && window.orxa?.terminal) {
          void window.orxa.terminal.close(directory, existing.processId);
        }
        persistedSessions.delete(key);
      }
    }

    // If the split panel references this tab, close the split
    if (splitTabId === tabId) {
      setSplitMode("none");
      setSplitTabId(null);
    }

    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) {
        // All tabs closed — exit the pane
        onExit();
        return prev;
      }
      if (activeTabId === tabId) {
        setActiveTabId(next[0].id);
      }
      return next;
    });
  }

  function handleRestart() {
    if (permissionMode === "pending") return;
    const key = sessionKey(directory, permissionMode, activeTabId);
    const existing = persistedSessions.get(key);
    if (existing) {
      if (existing.unsubscribe) existing.unsubscribe();
      if (!existing.exited && window.orxa?.terminal) {
        void window.orxa.terminal.close(directory, existing.processId);
      }
      persistedSessions.delete(key);
    }
    // Force re-render by cycling the tab id
    const newTab = createTab();
    newTab.label = tabs.find((t) => t.id === activeTabId)?.label ?? newTab.label;
    setTabs((prev) => prev.map((t) => (t.id === activeTabId ? newTab : t)));
    setActiveTabId(newTab.id);
  }

  function handleExit() {
    // Kill all persisted sessions for all tabs
    if (permissionMode !== "pending") {
      for (const tab of tabs) {
        const key = sessionKey(directory, permissionMode, tab.id);
        const existing = persistedSessions.get(key);
        if (existing) {
          if (existing.unsubscribe) existing.unsubscribe();
          if (!existing.exited && window.orxa?.terminal) {
            void window.orxa.terminal.close(directory, existing.processId);
          }
          persistedSessions.delete(key);
        }
      }
      if (splitTabId) {
        const key = sessionKey(directory, permissionMode, splitTabId);
        const existing = persistedSessions.get(key);
        if (existing) {
          if (existing.unsubscribe) existing.unsubscribe();
          if (!existing.exited && window.orxa?.terminal) {
            void window.orxa.terminal.close(directory, existing.processId);
          }
          persistedSessions.delete(key);
        }
      }
    }
    onExit();
  }

  function handleSplit(mode: "horizontal" | "vertical") {
    if (splitMode !== "none") {
      // Already split — just change direction
      setSplitMode(mode);
    } else {
      const tab = createTab();
      setSplitTabId(tab.id);
      setSplitMode(mode);
    }
    setShowSplitMenu(false);
  }

  function handleUnsplit() {
    if (splitTabId && permissionMode !== "pending") {
      const key = sessionKey(directory, permissionMode, splitTabId);
      const existing = persistedSessions.get(key);
      if (existing) {
        if (existing.unsubscribe) existing.unsubscribe();
        if (!existing.exited && window.orxa?.terminal) {
          void window.orxa.terminal.close(directory, existing.processId);
        }
        persistedSessions.delete(key);
      }
    }
    setSplitMode("none");
    setSplitTabId(null);
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
        <button type="button" className="claude-toolbar-btn" onClick={handleRestart} aria-label="restart">
          <RefreshCw size={11} />
          restart
        </button>
        <button type="button" className="claude-toolbar-btn" onClick={handleExit} aria-label="exit">
          <X size={11} />
          exit
        </button>
      </div>

      {/* Tab bar */}
      <div className="claude-tab-bar">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`claude-tab ${activeTabId === tab.id ? "active" : ""}`}
            onClick={() => setActiveTabId(tab.id)}
          >
            <span className="claude-tab-label">{tab.label}</span>
            {tabs.length > 1 && (
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
            )}
          </button>
        ))}
        <button
          type="button"
          className="claude-tab claude-tab-add"
          onClick={handleAddTab}
          aria-label="New claude tab"
        >
          <Plus size={12} />
        </button>
      </div>

      {/* Terminal area with optional split */}
      <div
        className={`claude-split-container ${splitMode === "horizontal" ? "claude-split-horizontal" : ""} ${splitMode === "vertical" ? "claude-split-vertical" : ""}`}
      >
        <div className="claude-split-panel">
          <ClaudeTerminalInstance
            key={activeTabId}
            directory={directory}
            mode={permissionMode}
            tabId={activeTabId}
          />
        </div>
        {splitMode !== "none" && splitTabId && (
          <>
            <div className="claude-split-divider" />
            <div className="claude-split-panel">
              <ClaudeTerminalInstance
                key={splitTabId}
                directory={directory}
                mode={permissionMode}
                tabId={splitTabId}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
