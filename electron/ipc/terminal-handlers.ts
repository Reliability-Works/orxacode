import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, accessSync, constants as fsConstants } from "node:fs";
import { ipcMain } from "electron";
import { IPC, type ClaudeTerminalMode, type OrxaEvent } from "../../shared/ipc";
import type { OpencodeService } from "../services/opencode-service";
import { assertString } from "./validators";

type ClaudeTerminalState = {
  nextId: number;
  processes: Map<string, { proc: ChildProcess; directory: string }>;
};

type TerminalHandlersDeps = {
  service: OpencodeService;
  claudeState: ClaudeTerminalState;
  publishEvent: (event: OrxaEvent) => void;
};

export function registerTerminalHandlers({
  service,
  claudeState,
  publishEvent,
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
      const termCols = typeof cols === "number" ? cols : 80;
      const termRows = typeof rows === "number" ? rows : 24;

      const processId = `claude-term-${++claudeState.nextId}`;

      const cleanEnv = { ...process.env };
      delete cleanEnv.ANTHROPIC_BASE_URL;
      delete cleanEnv.ANTHROPIC_AUTH_TOKEN;
      delete cleanEnv.ANTHROPIC_API_KEY;
      cleanEnv.COLUMNS = String(termCols);
      cleanEnv.LINES = String(termRows);
      cleanEnv.FORCE_COLOR = "1";
      cleanEnv.TERM = "xterm-256color";

      const claudeArgs = m === "full" ? ["--dangerously-skip-permissions"] : [];

      let claudeBin = "claude";
      try {
        const home = process.env.HOME ?? "";
        const nvmDir = path.join(home, ".nvm", "versions", "node");
        const candidates = [
          "/opt/homebrew/bin/claude",
          "/usr/local/bin/claude",
          path.join(home, ".volta", "bin", "claude"),
        ];
        try {
          const versions = readdirSync(nvmDir);
          for (const v of versions) {
            candidates.push(path.join(nvmDir, v, "bin", "claude"));
          }
        } catch {
          // nvm not installed
        }
        for (const candidate of candidates) {
          try {
            accessSync(candidate, fsConstants.X_OK);
            claudeBin = candidate;
            break;
          } catch {
            continue;
          }
        }
      } catch {
        // use default
      }

      const proc = spawn(claudeBin, claudeArgs, {
        cwd: dir,
        env: cleanEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });

      claudeState.processes.set(processId, { proc, directory: dir });

      proc.stdout?.on("data", (data: Buffer) => {
        publishEvent({
          type: "claude-terminal.output",
          payload: { processId, directory: dir, chunk: data.toString("utf-8") },
        });
      });
      proc.stderr?.on("data", (data: Buffer) => {
        publishEvent({
          type: "claude-terminal.output",
          payload: { processId, directory: dir, chunk: data.toString("utf-8") },
        });
      });
      proc.on("close", (exitCode) => {
        claudeState.processes.delete(processId);
        publishEvent({
          type: "claude-terminal.closed",
          payload: { processId, directory: dir, exitCode },
        });
      });

      return { processId, directory: dir };
    },
  );

  ipcMain.handle(IPC.claudeTerminalWrite, async (_event, processId: unknown, data: unknown) => {
    const id = assertString(processId, "processId");
    const entry = claudeState.processes.get(id);
    if (!entry) return false;
    const str = typeof data === "string" ? data : "";
    entry.proc.stdin?.write(str);
    return true;
  });

  ipcMain.handle(IPC.claudeTerminalResize, async (_event, processId: unknown, cols: unknown, rows: unknown) => {
    const id = assertString(processId, "processId");
    const entry = claudeState.processes.get(id);
    if (!entry) return false;
    if (typeof cols !== "number" || typeof rows !== "number") {
      throw new Error("cols and rows must be numbers");
    }
    return true;
  });

  ipcMain.handle(IPC.claudeTerminalClose, async (_event, processId: unknown) => {
    const id = assertString(processId, "processId");
    const entry = claudeState.processes.get(id);
    if (!entry) return false;
    entry.proc.kill("SIGTERM");
    setTimeout(() => {
      if (claudeState.processes.has(id)) {
        entry.proc.kill("SIGKILL");
      }
    }, 3000);
    return true;
  });
}
