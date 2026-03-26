import { ipcMain } from "electron";
import { IPC, type ClaudeTerminalMode, type OrxaTerminalOwner } from "../../shared/ipc";
import type { OrxaTerminalService } from "../services/orxa-terminal-service";
import { assertString } from "./validators";

type ClaudeTerminalState = {
  processes: Map<string, { directory: string }>;
};

type TerminalHandlersDeps = {
  service: OrxaTerminalService;
  claudeState: ClaudeTerminalState;
};

export function registerTerminalHandlers({
  service,
  claudeState,
}: TerminalHandlersDeps) {
  ipcMain.handle(IPC.terminalList, async (_event, directory: unknown, owner?: unknown) =>
    service.listPtys(
      assertString(directory, "directory"),
      owner === "workspace" || owner === "canvas" || owner === "claude"
        ? owner as OrxaTerminalOwner
        : "workspace",
    ),
  );
  ipcMain.handle(IPC.terminalCreate, async (_event, directory: unknown, cwd?: unknown, title?: unknown, owner?: unknown) =>
    service.createPty(
      assertString(directory, "directory"),
      typeof cwd === "string" ? cwd : undefined,
      typeof title === "string" ? title : undefined,
      owner === "workspace" || owner === "canvas" || owner === "claude" ? owner as OrxaTerminalOwner : "workspace",
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
      const title = m === "full" ? "Claude Code (Full)" : "Claude Code";
      const pty = await service.createPty(dir, dir, title, "claude");
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
    if (entry?.directory) {
      await service.resizePty(entry.directory, id, cols, rows);
      return true;
    }
    return false;
  });

  ipcMain.handle(IPC.claudeTerminalClose, async (_event, processId: unknown) => {
    const id = assertString(processId, "processId");
    const entry = claudeState.processes.get(id);
    if (entry?.directory) {
      claudeState.processes.delete(id);
      await service.closePty(entry.directory, id);
      return true;
    }
    return false;
  });
}
