import type { BrowserWindow } from "electron";
import { IPC, type OrxaEvent } from "../../shared/ipc";

const PTY_OUTPUT_FLUSH_MS = 16;
const STRUCTURED_EVENT_FLUSH_MS = 16;

type PtyBufferedOutput = {
  directory: string;
  ptyID: string;
  chunks: string[];
};

function isBatchableStructuredEvent(event: OrxaEvent) {
  return event.type === "codex.notification" || event.type === "claude-chat.notification";
}

export function createMainWindowEventPublisher(getMainWindow: () => BrowserWindow | null) {
  const ptyOutputBuffer = new Map<string, PtyBufferedOutput>();
  const ptyOutputFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let structuredEventBuffer: OrxaEvent[] = [];
  let structuredEventFlushTimer: ReturnType<typeof setTimeout> | null = null;

  const sendSingleEvent = (event: OrxaEvent) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) {
      return;
    }
    window.webContents.send(IPC.events, event);
  };

  const flushStructuredEvents = () => {
    if (structuredEventFlushTimer) {
      clearTimeout(structuredEventFlushTimer);
      structuredEventFlushTimer = null;
    }
    if (structuredEventBuffer.length === 0) {
      return;
    }
    const window = getMainWindow();
    const payload = structuredEventBuffer;
    structuredEventBuffer = [];
    if (!window || window.isDestroyed()) {
      return;
    }
    window.webContents.send(IPC.eventsBatch, payload);
  };

  const queueStructuredEvent = (event: OrxaEvent) => {
    structuredEventBuffer.push(event);
    if (!structuredEventFlushTimer) {
      structuredEventFlushTimer = setTimeout(() => {
        flushStructuredEvents();
      }, STRUCTURED_EVENT_FLUSH_MS);
    }
  };

  const flushBufferedPtyOutput = (key: string) => {
    const timer = ptyOutputFlushTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      ptyOutputFlushTimers.delete(key);
    }
    const pending = ptyOutputBuffer.get(key);
    if (!pending) {
      return;
    }
    ptyOutputBuffer.delete(key);
    sendSingleEvent({
      type: "pty.output",
      payload: {
        directory: pending.directory,
        ptyID: pending.ptyID,
        chunk: pending.chunks.join(""),
      },
    });
  };

  const flushAllPtyOutput = () => {
    for (const key of [...ptyOutputBuffer.keys()]) {
      flushBufferedPtyOutput(key);
    }
  };

  const queuePtyOutput = (event: Extract<OrxaEvent, { type: "pty.output" }>) => {
    const key = `${event.payload.directory}::${event.payload.ptyID}`;
    const existing = ptyOutputBuffer.get(key);
    if (existing) {
      existing.chunks.push(event.payload.chunk);
    } else {
      ptyOutputBuffer.set(key, {
        directory: event.payload.directory,
        ptyID: event.payload.ptyID,
        chunks: [event.payload.chunk],
      });
    }

    if (!ptyOutputFlushTimers.has(key)) {
      const timer = setTimeout(() => {
        flushBufferedPtyOutput(key);
      }, PTY_OUTPUT_FLUSH_MS);
      ptyOutputFlushTimers.set(key, timer);
    }
  };

  return {
    publish(event: OrxaEvent) {
      const window = getMainWindow();
      if (!window || window.isDestroyed()) {
        return;
      }

      if (event.type === "pty.output") {
        queuePtyOutput(event);
        return;
      }

      if (isBatchableStructuredEvent(event)) {
        queueStructuredEvent(event);
        return;
      }

      flushStructuredEvents();
      sendSingleEvent(event);
    },
    flushAll() {
      flushStructuredEvents();
      flushAllPtyOutput();
    },
  };
}
