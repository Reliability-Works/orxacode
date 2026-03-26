import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon } from "lucide-react";
import { SerializeAddon } from "xterm-addon-serialize";
import "xterm/css/xterm.css";
import type { OrxaTerminalSession } from "@shared/ipc";
import { CanvasTileComponent } from "../CanvasTile";
import type { CanvasTileComponentProps } from "./tile-shared";
import { consumeClaudeStartupChunk } from "../../lib/claude-terminal-startup";
import { createManagedTerminal, type ManagedTerminal } from "../../lib/xterm-terminal";

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

function getCanvasTerminalMeta(tile: CanvasTileComponentProps["tile"]) {
  const directory = typeof tile.meta.directory === "string" ? tile.meta.directory : "";
  const cwd = typeof tile.meta.cwd === "string" ? tile.meta.cwd : directory;
  const ptyId = typeof tile.meta.ptyId === "string" ? tile.meta.ptyId : null;
  const serializedOutput = typeof tile.meta.serializedOutput === "string" ? tile.meta.serializedOutput : "";
  const startupCommand = typeof tile.meta.startupCommand === "string" ? tile.meta.startupCommand : "";
  const startupFilter = tile.meta.startupFilter === "claude" ? "claude" : null;

  return { directory, cwd, ptyId, serializedOutput, startupCommand, startupFilter };
}

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

async function resolveCanvasPty(
  tile: CanvasTileComponentProps["tile"],
  onUpdate: TerminalTileProps["onUpdate"],
): Promise<{ session: OrxaTerminalSession; created: boolean }> {
  const { directory, cwd, ptyId } = getCanvasTerminalMeta(tile);
  if (!directory) {
    throw new Error("Terminal tile is missing a working directory.");
  }

  const list = await window.orxa.terminal.list(directory, "canvas");
  const existing = ptyId ? list.find((entry) => entry.id === ptyId) : undefined;
  if (existing && existing.status === "running") {
    return { session: existing, created: false };
  }

  const nextPty = await window.orxa.terminal.create(directory, cwd, undefined, "canvas");
  onUpdate(tile.id, { meta: { ...tile.meta, directory, cwd, ptyId: nextPty.id } });
  return { session: nextPty, created: true };
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
  const terminalRef = useRef<ManagedTerminal | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const cleanupRef = useRef<Array<() => void>>([]);
  const startupBufferRef = useRef<string[]>([]);
  const startupReadyRef = useRef(true);

  // Resolve directory and cwd from tile meta
  const { directory, cwd, serializedOutput, startupCommand, startupFilter } = getCanvasTerminalMeta(tile);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSerializedOutputRef = useRef(serializedOutput);
  const metaLabel = cwd || directory || "terminal";
  const tileLabel =
    tile.type === "claude_code"
      ? "claude code"
      : tile.type === "codex_cli"
        ? "codex cli"
        : tile.type === "opencode_cli"
          ? "opencode"
          : "terminal";
  const iconColor =
    tile.type === "claude_code"
      ? "#D97706"
      : tile.type === "codex_cli"
        ? "#6C7BFF"
        : tile.type === "opencode_cli"
          ? "#22D3EE"
          : "#22C55E";

  const persistSerializedOutput = (nextSerializedOutput: string) => {
    if (!nextSerializedOutput || nextSerializedOutput === lastSerializedOutputRef.current) {
      return;
    }
    lastSerializedOutputRef.current = nextSerializedOutput;
    onUpdate(tile.id, {
      meta: {
        ...tile.meta,
        directory,
        cwd,
        ptyId: typeof tile.meta.ptyId === "string" ? tile.meta.ptyId : ptyIdRef.current,
        serializedOutput: nextSerializedOutput,
      },
    });
  };

  const scheduleSnapshotPersist = () => {
    if (snapshotTimerRef.current) {
      clearTimeout(snapshotTimerRef.current);
    }
    snapshotTimerRef.current = setTimeout(() => {
      snapshotTimerRef.current = null;
      const serializeAddon = serializeAddonRef.current;
      if (!serializeAddon) {
        return;
      }
      persistSerializedOutput(serializeAddon.serialize());
    }, 120);
  };

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
    startupBufferRef.current = [];
    startupReadyRef.current = startupFilter !== "claude";
    const managed = createManagedTerminal(container, {
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 12,
      fontWeight: "300",
      fontWeightBold: "500",
      lineHeight: 1.4,
      cursorBlink: true,
      theme: TERMINAL_THEME,
    });
    const terminal = managed.terminal;
    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(serializeAddon);
    if (serializedOutput) {
      terminal.write(serializedOutput);
    }

    terminalRef.current = managed;
    serializeAddonRef.current = serializeAddon;

    const cleanups: Array<() => void> = [];
    cleanupRef.current = cleanups;

    const resizeTerminal = () => {
      managed.refit();
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

        const pty = await resolveCanvasPty(tile, onUpdate);
        if (cancelled) {
          return;
        }

        ptyIdRef.current = pty.session.id;
        await connectTerminalWithRetry(directory, pty.session.id);
        if (cancelled) {
          return;
        }

        if (pty.created && startupCommand) {
          await window.orxa.terminal.write(directory, pty.session.id, startupCommand);
        }

        const unsubscribe = window.orxa.events.subscribe((event) => {
          if (event.type === "pty.output" && event.payload.ptyID === pty.session.id && event.payload.directory === directory) {
            const sanitizedChunk = sanitizeTerminalChunk(event.payload.chunk);
            if (sanitizedChunk) {
              const displayChunk = startupFilter === "claude"
                ? (() => {
                    const next = consumeClaudeStartupChunk(startupBufferRef.current, sanitizedChunk, startupReadyRef.current);
                    startupReadyRef.current = next.startupReady;
                    startupBufferRef.current = next.startupBuffer;
                    return next.displayChunk;
                  })()
                : sanitizedChunk;
              if (displayChunk) {
                managed.writeBuffered(displayChunk);
                scheduleSnapshotPersist();
              }
            }
          }
          if (event.type === "pty.closed" && event.payload.ptyID === pty.session.id && event.payload.directory === directory) {
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
      if (snapshotTimerRef.current) {
        clearTimeout(snapshotTimerRef.current);
        snapshotTimerRef.current = null;
      }

      managed.dispose();
      terminalRef.current = null;
      serializeAddonRef.current = null;
      ptyIdRef.current = null;
    };
    // Mount once only — the tile ID is stable for this instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRemove = () => {
    const ptyId = typeof tile.meta.ptyId === "string" ? tile.meta.ptyId : ptyIdRef.current;
    if (ptyId && window.orxa?.terminal && directory) {
      void window.orxa.terminal.close(directory, ptyId).catch(() => undefined);
    }
    onRemove(tile.id);
  };

  return (
    <CanvasTileComponent
      tile={tile}
      canvasTheme={canvasTheme}
      onUpdate={onUpdate}
      onRemove={handleRemove}
      onBringToFront={onBringToFront}
      icon={<TerminalIcon size={12} />}
      label={tileLabel}
      iconColor={iconColor}
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
