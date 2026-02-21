import { useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";

type Props = {
  directory: string;
  ptyID: string | undefined;
  open: boolean;
  onCreate: () => Promise<void>;
};

export function TerminalPanel({ directory, ptyID, open, onCreate }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [ready, setReady] = useState(false);

  const canRender = useMemo(() => open && Boolean(directory) && Boolean(ptyID), [open, directory, ptyID]);

  useEffect(() => {
    if (!open || !ptyID || !containerRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      fontFamily: '"IBM Plex Mono", "SF Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.45,
      cursorBlink: true,
      theme: {
        background: "#071018",
        foreground: "#d5e3f0",
        cursor: "#7fd1ff",
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
      },
    });

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(containerRef.current);
    fit.fit();
    terminal.focus();

    terminalRef.current = terminal;
    fitRef.current = fit;

    setReady(true);

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (ptyID) {
        void window.orxa.terminal.resize(directory, ptyID, terminal.cols, terminal.rows);
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      setReady(false);
    };
  }, [open, directory, ptyID]);

  useEffect(() => {
    if (!canRender || !ready || !ptyID || !terminalRef.current) {
      return;
    }

    const terminal = terminalRef.current;
    terminal.writeln("\u001b[36mConnecting terminal...\u001b[0m");

    void window.orxa.terminal.connect(directory, ptyID).then(() => {
      terminal.writeln("\u001b[32mTerminal connected\u001b[0m");
      void window.orxa.terminal.resize(directory, ptyID, terminal.cols, terminal.rows);
    });

    const disposeInput = terminal.onData((data) => {
      void window.orxa.terminal.write(directory, ptyID, data);
    });

    const unsubscribe = window.orxa.events.subscribe((event) => {
      if (event.type === "pty.output" && event.payload.ptyID === ptyID && event.payload.directory === directory) {
        terminal.write(event.payload.chunk);
      }
      if (event.type === "pty.closed" && event.payload.ptyID === ptyID && event.payload.directory === directory) {
        terminal.writeln("\r\n\u001b[33m[terminal closed]\u001b[0m");
      }
    });

    return () => {
      disposeInput.dispose();
      unsubscribe();
    };
  }, [canRender, ready, directory, ptyID]);

  return (
    <section className={`terminal-panel ${open ? "open" : "closed"}`}>
      <header className="terminal-header">
        <div>
          <strong>Terminal</strong>
          <span>{ptyID ? `PTY ${ptyID.slice(-6)}` : "Press + to create a terminal"}</span>
        </div>
        <div className="terminal-actions">
          <button type="button" aria-label="New terminal" title="New terminal" onClick={() => void onCreate()}>
            +
          </button>
        </div>
      </header>
      <div className="terminal-body" ref={containerRef} />
    </section>
  );
}
