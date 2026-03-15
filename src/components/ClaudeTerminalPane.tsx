import { useEffect, useRef, useState } from "react";
import { Bot, RefreshCw, X } from "lucide-react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

const TERMINAL_THEME = {
  background: "#0d1117",
  foreground: "#d5e3f0",
  cursor: "#ffffff",
  black: "#041018",
  red: "#ff6f91",
  green: "#70f1b6",
  yellow: "#ffd97d",
  blue: "#8ec7ff",
  magenta: "#d4a5ff",
  cyan: "#8ce6ff",
  white: "#e9f1f7",
  brightBlack: "#4d6478",
  brightRed: "#ff8fad",
  brightGreen: "#9bffd4",
  brightYellow: "#ffe7a8",
  brightBlue: "#b6dbff",
  brightMagenta: "#e5c4ff",
  brightCyan: "#b6f4ff",
  brightWhite: "#ffffff",
};

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

  function runCleanups() {
    for (const cleanup of cleanupRef.current) cleanup();
    cleanupRef.current = [];
  }

  function launchTerminal() {
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
      fontFamily: '"IBM Plex Mono", "SF Mono", Menlo, monospace',
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

    void window.orxa.terminal.create(directory, directory, "claude code").then((pty) => {
      ptyIdRef.current = pty.id;

      void window.orxa.terminal.connect(directory, pty.id).then(() => {
        void window.orxa.terminal.resize(directory, pty.id, terminal.cols, terminal.rows);
        // Launch claude inside the shell
        void window.orxa.terminal.write(directory, pty.id, `claude --cwd ${directory}\n`);
      });

      const disposeInput = terminal.onData((data) => {
        void window.orxa.terminal.write(directory, pty.id, data);
      });
      cleanups.push(() => disposeInput.dispose());

      const unsubscribe = window.orxa.events.subscribe((event) => {
        if (event.type === "pty.output" && event.payload.ptyID === pty.id && event.payload.directory === directory) {
          terminal.write(event.payload.chunk);
        }
        if (event.type === "pty.closed" && event.payload.ptyID === pty.id && event.payload.directory === directory) {
          terminal.writeln("\r\n\u001b[33m[claude session ended]\u001b[0m");
        }
      });
      cleanups.push(unsubscribe);
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
  }

  useEffect(() => {
    launchTerminal();

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
    // Mount once — directory is stable for the lifetime of this pane
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRestart() {
    launchTerminal();
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
