import type { ChildProcess } from "node:child_process";
import { ipcMain } from "electron";
import { CLAUDE_SESSION_PTY_TITLE_PREFIX, IPC, type ClaudeTerminalMode, type OrxaEvent } from "../../shared/ipc";
import type { OpencodeService } from "../services/opencode-service";
import { assertString } from "./validators";

type ClaudeTerminalState = {
  nextId: number;
  processes: Map<string, { directory: string; proc?: ChildProcess }>;
};

type TerminalHandlersDeps = {
  service: OpencodeService;
  claudeState: ClaudeTerminalState;
  publishEvent: (event: OrxaEvent) => void;
};

export function registerTerminalHandlers({
  service,
  claudeState,
}: TerminalHandlersDeps) {
  ipcMain.handle(IPC.terminalList, async (_event, directory: unknown) => service.listPtys(assertString(directory, "directory")));
  ipcMain.handle(IPC.terminalCreate, async (_event, directory: unknown, cwd?: unknown, title?: unknown) =>
    service.createPty(
      assertString(directory, "directory"),
      typeof cwd === "string" ? cwd : undefined,
      typeof title === "string" ? title : undefined,
    ),
  );
  ipcMain.handle(IPC.terminalConnect, async (_event, directory: unknown, ptyID: unknown) =>
    service.connectPty(assertString(directory, "directory"), assertString(ptyID, "ptyID")),
  );
  ipcMain.handle(IPC.terminalWrite, async (_event, directory: unknown, ptyID: unknown, data: unknown) =>
    service.writePty(assertString(directory, "directory"), assertString(ptyID, "ptyID"), typeof data === "string" ? data : ""),
  );
  ipcMain.handle(IPC.terminalResize, async (_event, directory: unknown, ptyID: unknown, cols: unknown, rows: unknown) => {
    if (typeof cols !== "number" || typeof rows !== "number") {
      throw new Error("cols and rows must be numbers");
    }
    return service.resizePty(assertString(directory, "directory"), assertString(ptyID, "ptyID"), cols, rows);
  });
  ipcMain.handle(IPC.terminalClose, async (_event, directory: unknown, ptyID: unknown) =>
    service.closePty(assertString(directory, "directory"), assertString(ptyID, "ptyID")),
  );

  ipcMain.handle(
    IPC.claudeTerminalCreate,
    async (_event, directory: unknown, mode: unknown, cols?: unknown, rows?: unknown) => {
      const dir = assertString(directory, "directory");
      const m = assertString(mode, "mode") as ClaudeTerminalMode;
      const title = `${CLAUDE_SESSION_PTY_TITLE_PREFIX}${m}`;
      const pty = await service.createPty(dir, dir, title);
      claudeState.processes.set(pty.id, { directory: dir });
      await service.connectPty(dir, pty.id);
      if (typeof cols === "number" && typeof rows === "number") {
        await service.resizePty(dir, pty.id, cols, rows);
      }
      return { processId: pty.id, directory: dir };
    },
  );

  ipcMain.handle(IPC.claudeTerminalWrite, async (_event, processId: unknown, data: unknown) => {
    const id = assertString(processId, "processId");
    const entry = claudeState.processes.get(id);
    if (entry?.proc) {
      const str = typeof data === "string" ? data : "";
      entry.proc.stdin?.write(str);
      return true;
    }
    if (entry?.directory) {
      return service.writePty(entry.directory, id, typeof data === "string" ? data : "");
    }
    return false;
  });

  ipcMain.handle(IPC.claudeTerminalResize, async (_event, processId: unknown, cols: unknown, rows: unknown) => {
    const id = assertString(processId, "processId");
    const entry = claudeState.processes.get(id);
    if (typeof cols !== "number" || typeof rows !== "number") {
      throw new Error("cols and rows must be numbers");
    }
    if (entry?.proc) {
      return true;
    }
    if (entry?.directory) {
      await service.resizePty(entry.directory, id, cols, rows);
      return true;
    }
    return false;
  });

  ipcMain.handle(IPC.claudeTerminalClose, async (_event, processId: unknown) => {
    const id = assertString(processId, "processId");
    const entry = claudeState.processes.get(id);
    if (entry?.proc) {
      const proc = entry.proc;
      entry.proc.kill("SIGTERM");
      setTimeout(() => {
        if (claudeState.processes.has(id)) {
          proc.kill("SIGKILL");
        }
      }, 3000);
      return true;
    }
    if (entry?.directory) {
      claudeState.processes.delete(id);
      await service.closePty(entry.directory, id);
      return true;
    }
    return false;
  });
}
