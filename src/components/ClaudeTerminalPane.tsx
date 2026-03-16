import { useEffect, useRef, useState, useCallback } from "react";
import { Bot, RefreshCw, Shield, ShieldOff, X } from "lucide-react";
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
// Keyed by `directory:mode` to uniquely identify a claude terminal session.

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

function sessionKey(directory: string, mode: string): string {
  return `${directory}::${mode}`;
}

interface Props {
  directory: string;
  onExit: () => void;
}

export function ClaudeTerminalPane({ directory, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const processIdRef = useRef<string | null>(null);
  const cleanupRef = useRef<Array<() => void>>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [rememberChoice, setRememberChoice] = useState(false);

  // Check for a stored permission mode; otherwise start in "pending" to show the modal
  const storedMode = getStoredPermissionMode(directory);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(storedMode ?? "pending");

  function runCleanups() {
    for (const cleanup of cleanupRef.current) cleanup();
    cleanupRef.current = [];
  }

  const launchTerminal = useCallback(
    (mode: "standard" | "full") => {
      const container = containerRef.current;
      if (!container) return;

      if (!window.orxa?.terminal) {
        setUnavailable(true);
        return;
      }

      // Dispose any previous xterm instance (but NOT the underlying process — that's persistent)
      runCleanups();
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      // Clear the container DOM so xterm can re-attach
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

      const key = sessionKey(directory, mode);
      const existing = persistedSessions.get(key);

      if (existing && !existing.exited) {
        // Reattach to an existing process — replay buffered output
        processIdRef.current = existing.processId;

        // Replay all buffered output into the new xterm instance
        for (const chunk of existing.outputChunks) {
          terminal.write(chunk);
        }

        if (existing.exited) {
          terminal.writeln("\r\n\u001b[33m[claude session ended]\u001b[0m");
        }

        // Detach old event listener and subscribe a new one that also writes to this terminal
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
            // We only detach the terminal display. The session's own listener stays.
          });
        }
      } else {
        // Clean up any stale exited session
        if (existing) {
          if (existing.unsubscribe) existing.unsubscribe();
          persistedSessions.delete(key);
        }

        // Build the claude command — use exec to replace the shell, strip env vars
        const envPrefix = "env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY";
        const claudeCmd = mode === "full" ? "claude --dangerously-skip-permissions" : "claude";
        const command = `exec ${envPrefix} ${claudeCmd}\n`;

        // Create PTY via OpenCode (gives us a real TTY for claude's TUI)
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

            // Track whether claude has started (detect "Claude Code" in output)
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
                  // Buffer output until we see Claude Code has started
                  pendingChunks.push(chunk);
                  const allOutput = pendingChunks.join("");
                  if (allOutput.includes("Claude Code") || allOutput.includes("Welcome")) {
                    // Claude has started — clear xterm and replay from Claude's output
                    claudeStarted = true;
                    terminal.clear();
                    terminal.reset();
                    // Find the start of Claude's output and write from there
                    const claudeIdx = allOutput.indexOf("─");
                    if (claudeIdx >= 0) {
                      terminal.write(allOutput.slice(claudeIdx));
                    } else {
                      // Fallback — just write everything after clearing
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

            // Send the command to start claude
            void window.orxa.terminal.write(directory, pty.id, command);
          });

          persistedSessions.set(key, session);
        });
      }

      // Forward user keyboard input to the PTY
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
    },
    [directory],
  );

  // Launch terminal when permission mode is resolved (not "pending")
  useEffect(() => {
    if (permissionMode === "pending") return;
    launchTerminal(permissionMode);

    return () => {
      runCleanups();

      // Dispose xterm display but do NOT kill the process — it persists
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;

      // Do NOT close the process here — persistence means it stays alive
      processIdRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionMode]);

  function handlePermissionChoice(mode: "standard" | "full") {
    if (rememberChoice) {
      storePermissionMode(directory, mode);
    }
    setPermissionMode(mode);
  }

  function handleRestart() {
    if (permissionMode === "pending") return;
    // Kill the existing persisted session so a fresh one is created
    const key = sessionKey(directory, permissionMode);
    const existing = persistedSessions.get(key);
    if (existing) {
      if (existing.unsubscribe) existing.unsubscribe();
      if (!existing.exited && window.orxa?.terminal) {
        void window.orxa.terminal.close(directory, existing.processId);
      }
      persistedSessions.delete(key);
    }
    processIdRef.current = null;
    launchTerminal(permissionMode);
  }

  // On exit, kill the process and clean up
  function handleExit() {
    if (permissionMode !== "pending") {
      const key = sessionKey(directory, permissionMode);
      const existing = persistedSessions.get(key);
      if (existing) {
        if (existing.unsubscribe) existing.unsubscribe();
        if (!existing.exited && window.orxa?.claudeTerminal) {
          void window.orxa.claudeTerminal.close(existing.processId);
        }
        persistedSessions.delete(key);
      }
    }
    onExit();
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
        <button type="button" className="claude-toolbar-btn" onClick={handleRestart} aria-label="restart">
          <RefreshCw size={11} />
          restart
        </button>
        <button type="button" className="claude-toolbar-btn" onClick={handleExit} aria-label="exit">
          <X size={11} />
          exit
        </button>
      </div>
      <div className="claude-terminal-body" ref={containerRef} />
    </div>
  );
}
