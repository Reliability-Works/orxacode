import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { CanvasTileComponent } from "../CanvasTile";
import type { CanvasTileComponentProps } from "./tile-shared";

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

type TerminalTileProps = CanvasTileComponentProps;

type TerminalLoadState = "connecting" | "ready" | "error";

function sanitizeTerminalChunk(chunk: string) {
  const sanitized = chunk.replace(/\{"cursor":\d+\}/g, "");
  return sanitized.trim() === "%" ? "" : sanitized;
}

function isRetryableTerminalConnectError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Unexpected server response:\s*(500|502|503|504)/i.test(message);
}

async function connectTerminalWithRetry(
  directory: string,
  ptyID: string,
  maxAttempts = 5,
  baseDelayMs = 120,
) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await window.orxa.terminal.connect(directory, ptyID);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isRetryableTerminalConnectError(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }

  throw lastError ?? new Error("Failed to connect terminal");
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
  canvasOffsetX,
  canvasOffsetY,
  viewportScale,
}: TerminalTileProps) {
  const [loadState, setLoadState] = useState<TerminalLoadState>("connecting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
      setLoadState("error");
      setErrorMessage("Terminal unavailable in this environment.");
      return;
    }

    let cancelled = false;
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
    cleanupRef.current = cleanups;

    const resizeTerminal = () => {
      fit.fit();
      if (ptyIdRef.current) {
        void window.orxa.terminal.resize(directory, ptyIdRef.current, terminal.cols, terminal.rows);
      }
    };

    const disposeInput = terminal.onData((data) => {
      if (!ptyIdRef.current) {
        return;
      }
      void window.orxa.terminal.write(directory, ptyIdRef.current, data);
    });
    cleanups.push(() => disposeInput.dispose());

    void (async () => {
      try {
        setLoadState("connecting");
        setErrorMessage(null);

        const pty = await window.orxa.terminal.create(directory, cwd, undefined, "canvas");
        if (cancelled) {
          return;
        }

        ptyIdRef.current = pty.id;
        await connectTerminalWithRetry(directory, pty.id);
        if (cancelled) {
          return;
        }

        const unsubscribe = window.orxa.events.subscribe((event) => {
          if (event.type === "pty.output" && event.payload.ptyID === pty.id && event.payload.directory === directory) {
            const sanitizedChunk = sanitizeTerminalChunk(event.payload.chunk);
            if (sanitizedChunk) {
              terminal.write(sanitizedChunk);
            }
          }
          if (event.type === "pty.closed" && event.payload.ptyID === pty.id && event.payload.directory === directory) {
            terminal.writeln("\r\n\u001b[33m[terminal closed]\u001b[0m");
          }
        });
        cleanups.push(unsubscribe);

        setLoadState("ready");
        requestAnimationFrame(() => {
          resizeTerminal();
          terminal.focus();
        });
        setTimeout(() => {
          if (!cancelled) {
            resizeTerminal();
          }
        }, 80);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "Terminal failed to connect.";
        setLoadState("error");
        setErrorMessage(message);
        terminal.writeln("\r\n\u001b[31m[failed to connect terminal]\u001b[0m");
        terminal.writeln(`\u001b[90m${message}\u001b[0m`);
      }
    })();

    // Watch the container for resize and reflow xterm
    const resizeObs = new ResizeObserver(() => {
      resizeTerminal();
    });
    resizeObs.observe(container);
    cleanups.push(() => resizeObs.disconnect());

    return () => {
      cancelled = true;
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
      canvasOffsetX={canvasOffsetX}
      canvasOffsetY={canvasOffsetY}
      viewportScale={viewportScale}
    >
      <div className="terminal-tile-shell">
        <div className="terminal-tile-body" ref={containerRef} />
        {loadState !== "ready" ? (
          <div className={`terminal-tile-status terminal-tile-status-${loadState}`}>
            {loadState === "connecting" ? "Connecting terminal..." : errorMessage ?? "Terminal failed to load."}
          </div>
        ) : null}
      </div>
    </CanvasTileComponent>
  );
}
