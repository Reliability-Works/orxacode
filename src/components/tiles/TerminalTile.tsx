import { useEffect, useRef } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import type { CanvasTile, CanvasTheme } from "../../types/canvas";
import { CanvasTileComponent } from "../CanvasTile";

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

interface TerminalTileProps {
  tile: CanvasTile;
  canvasTheme: CanvasTheme;
  onUpdate: (id: string, patch: Partial<CanvasTile>) => void;
  onRemove: (id: string) => void;
  onBringToFront: (id: string) => void;
  snapToGrid?: boolean;
  gridSize?: number;
  allTiles?: CanvasTile[];
}

export function TerminalTile({
  tile,
  canvasTheme,
  onUpdate,
  onRemove,
  onBringToFront,
  snapToGrid,
  gridSize,
  allTiles,
}: TerminalTileProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const cleanupRef = useRef<Array<() => void>>([]);

  // Resolve directory and cwd from tile meta
  const directory = typeof tile.meta.directory === "string" ? tile.meta.directory : "";
  const cwd = typeof tile.meta.cwd === "string" ? tile.meta.cwd : directory;
  const metaLabel = cwd || directory || "terminal";

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Guard: if the terminal IPC is not available, degrade gracefully
    if (!window.orxa?.terminal) {
      container.style.display = "flex";
      container.style.alignItems = "center";
      container.style.justifyContent = "center";
      container.style.color = "var(--text-muted)";
      container.style.fontSize = "12px";
      container.textContent = "Terminal unavailable in this environment.";
      return;
    }

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

    // Create the PTY then connect
    void window.orxa.terminal.create(directory, cwd).then((pty) => {
      ptyIdRef.current = pty.id;

      void window.orxa.terminal.connect(directory, pty.id).then(() => {
        void window.orxa.terminal.resize(directory, pty.id, terminal.cols, terminal.rows);
      });

      // Forward local keystrokes to the PTY
      const disposeInput = terminal.onData((data) => {
        void window.orxa.terminal.write(directory, pty.id, data);
      });
      cleanups.push(() => disposeInput.dispose());

      // Receive output from the PTY
      const unsubscribe = window.orxa.events.subscribe((event) => {
        if (event.type === "pty.output" && event.payload.ptyID === pty.id && event.payload.directory === directory) {
          terminal.write(event.payload.chunk);
        }
        if (event.type === "pty.closed" && event.payload.ptyID === pty.id && event.payload.directory === directory) {
          terminal.writeln("\r\n\u001b[33m[terminal closed]\u001b[0m");
        }
      });
      cleanups.push(unsubscribe);
    });

    // Watch the container for resize and reflow xterm
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

    return () => {
      for (const cleanup of cleanupRef.current) cleanup();
      cleanupRef.current = [];

      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;

      if (ptyIdRef.current && window.orxa?.terminal) {
        void window.orxa.terminal.close(directory, ptyIdRef.current);
        ptyIdRef.current = null;
      }
    };
    // Mount once only — the tile ID is stable for this instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <CanvasTileComponent
      tile={tile}
      canvasTheme={canvasTheme}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={onBringToFront}
      icon={<TerminalIcon size={12} />}
      label="terminal"
      iconColor="#22C55E"
      metadata={metaLabel}
      snapToGrid={snapToGrid}
      gridSize={gridSize}
      allTiles={allTiles}
    >
      <div className="terminal-tile-body" ref={containerRef} />
    </CanvasTileComponent>
  );
}
