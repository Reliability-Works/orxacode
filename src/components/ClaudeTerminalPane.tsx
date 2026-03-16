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

interface Props {
  directory: string;
  onExit: () => void;
}

export function ClaudeTerminalPane({ directory, onExit }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
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

      // Dispose any previous instance
      runCleanups();
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      if (ptyIdRef.current && window.orxa?.terminal) {
        void window.orxa.terminal.close(directory, ptyIdRef.current);
        ptyIdRef.current = null;
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

      // Use exec to replace the shell process with claude — prevents command echo.
      // Strip ANTHROPIC_* env vars to prevent API billing override.
      const envPrefix = "env -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_API_KEY";
      const claudeCmd = mode === "full" ? "claude --dangerously-skip-permissions" : "claude";
      const command = `exec ${envPrefix} ${claudeCmd}\n`;

      void window.orxa.terminal.create(directory, directory, "claude code").then((pty) => {
        ptyIdRef.current = pty.id;

        void window.orxa.terminal.connect(directory, pty.id).then(() => {
          void window.orxa.terminal.resize(directory, pty.id, terminal.cols, terminal.rows);

          // Send the exec command FIRST — before subscribing to output.
          // This runs in the shell background. The shell will echo the command
          // and then exec into claude. We delay subscribing to output so the
          // user never sees the shell prompt or command echo.
          void window.orxa.terminal.write(directory, pty.id, command);

          // Wait for the shell to exec into claude before showing output.
          // 300ms is enough for exec to replace the shell with claude.
          const timerId = window.setTimeout(() => {
            if (!window.orxa?.events) return;

            const unsubscribe = window.orxa.events.subscribe((event) => {
              if (
                event.type === "pty.output" &&
                event.payload.ptyID === pty.id &&
                event.payload.directory === directory
              ) {
                terminal.write(event.payload.chunk as string);
              }
              if (
                event.type === "pty.closed" &&
                event.payload.ptyID === pty.id &&
                event.payload.directory === directory
              ) {
                terminal.writeln("\r\n\u001b[33m[claude session ended]\u001b[0m");
              }
            });
            cleanups.push(unsubscribe);
          }, 300);
          cleanups.push(() => window.clearTimeout(timerId));
        });

        const disposeInput = terminal.onData((data) => {
          void window.orxa.terminal.write(directory, pty.id, data);
        });
        cleanups.push(() => disposeInput.dispose());
      });

      const resizeObs = new ResizeObserver(() => {
        fit.fit();
        if (ptyIdRef.current) {
          void window.orxa.terminal.resize(directory, ptyIdRef.current, terminal.cols, terminal.rows);
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

      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      fitAddonRef.current = null;

      if (ptyIdRef.current && window.orxa?.terminal) {
        void window.orxa.terminal.close(directory, ptyIdRef.current);
        ptyIdRef.current = null;
      }
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
    launchTerminal(permissionMode);
  }

  if (unavailable) {
    return (
      <div className="claude-pane">
        <div className="claude-toolbar">
          <Bot size={14} color="#8b5cf6" />
          <span className="claude-toolbar-label">claude code</span>
          <span className="claude-toolbar-path">{directory}</span>
          <button type="button" className="claude-toolbar-btn" onClick={onExit}>
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
          <button type="button" className="claude-toolbar-btn" onClick={onExit} aria-label="exit">
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
        <button type="button" className="claude-toolbar-btn" onClick={onExit} aria-label="exit">
          <X size={11} />
          exit
        </button>
      </div>
      <div className="claude-terminal-body" ref={containerRef} />
    </div>
  );
}
