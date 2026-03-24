import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import type { OrxaEvent, OrxaTerminalOwner, OrxaTerminalSession, TerminalConnectResult } from "../../shared/ipc";
import { spawnNativePty, type NativePtyProcess } from "./native-pty";

type TerminalProcess = {
  pid: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
  onData: (listener: (chunk: string) => void) => void;
  onExit: (listener: (event: { exitCode: number | null }) => void) => void;
};

type TerminalRecord = {
  session: OrxaTerminalSession;
  process: TerminalProcess;
  connected: boolean;
  bufferedOutput: string[];
};

function resolveTerminalDirectory(input: string) {
  const normalized = path.resolve(input);
  if (!existsSync(normalized)) {
    throw new Error(`Terminal directory does not exist: ${normalized}`);
  }
  return normalized;
}

function resolveShellCandidates() {
  const rawCandidates = [
    process.platform === "win32" ? process.env.ComSpec : undefined,
    process.platform === "win32" ? "powershell.exe" : "/bin/zsh",
    process.platform === "win32" ? "cmd.exe" : "/bin/bash",
    process.platform === "win32" ? undefined : "/bin/sh",
    process.env.SHELL,
  ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);

  const deduped = [...new Set(rawCandidates.map((entry) => entry.trim()))];
  return deduped.filter((entry) => {
    if (!path.isAbsolute(entry)) {
      return true;
    }
    return existsSync(entry);
  });
}

function resolveArgs(shell: string) {
  if (process.platform === "win32") {
    return shell.toLowerCase().includes("powershell") ? ["-NoLogo"] : [];
  }
  return ["-l"];
}

function wrapNativePtyProcess(processHandle: NativePtyProcess): TerminalProcess {
  return {
    pid: processHandle.pid,
    write: (data) => processHandle.write(data),
    resize: (cols, rows) => processHandle.resize(Math.max(1, cols), Math.max(1, rows)),
    kill: () => processHandle.kill(),
    onData: (listener) => {
      processHandle.onData(listener);
    },
    onExit: (listener) => {
      processHandle.onExit(({ exitCode }) => listener({ exitCode: exitCode ?? null }));
    },
  };
}

function wrapScriptProcess(processHandle: ChildProcessWithoutNullStreams): TerminalProcess {
  return {
    pid: processHandle.pid ?? -1,
    write: (data) => {
      processHandle.stdin.write(data);
    },
    resize: () => {
      // BSD script does not expose a clean resize hook. Keep this as a no-op
      // for now; shells still function, but full-screen TUIs may not track size.
    },
    kill: () => {
      processHandle.kill("SIGTERM");
    },
    onData: (listener) => {
      processHandle.stdout.on("data", (chunk) => listener(chunk.toString()));
      processHandle.stderr.on("data", (chunk) => listener(chunk.toString()));
    },
    onExit: (listener) => {
      processHandle.on("exit", (exitCode) => listener({ exitCode: exitCode ?? null }));
    },
  };
}

function spawnFallbackScriptPty(shell: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  if (process.platform !== "darwin") {
    throw new Error("script PTY fallback is only available on macOS");
  }
  const scriptBinary = "/usr/bin/script";
  if (!existsSync(scriptBinary)) {
    throw new Error("macOS script binary not found");
  }
  const processHandle = spawn(scriptBinary, ["-q", "/dev/null", shell, ...args], {
    cwd,
    env,
    stdio: "pipe",
  });
  return wrapScriptProcess(processHandle);
}

export class OrxaTerminalService {
  private sessions = new Map<string, TerminalRecord>();

  onEvent?: (event: OrxaEvent) => void;

  listPtys(directory: string, owner: OrxaTerminalOwner = "workspace") {
    const normalizedDirectory = resolveTerminalDirectory(directory);
    return [...this.sessions.values()]
      .map((entry) => entry.session)
      .filter((entry) => entry.directory === normalizedDirectory && entry.owner === owner)
      .sort((left, right) => left.createdAt - right.createdAt);
  }

  createPty(directory: string, cwd?: string, title?: string, owner: OrxaTerminalOwner = "workspace") {
    const normalizedDirectory = resolveTerminalDirectory(directory);
    const normalizedCwd = resolveTerminalDirectory(cwd ?? normalizedDirectory);
    const shells = resolveShellCandidates();
    const attemptedShells: string[] = [];
    const env = {
      ...process.env,
      TERM: process.env.TERM || "xterm-256color",
      COLORTERM: process.env.COLORTERM || "truecolor",
      HOME: process.env.HOME || homedir(),
    };

    let processHandle: TerminalProcess | null = null;
    let lastError: unknown;
    for (const shell of shells) {
      attemptedShells.push(shell);
      try {
        const shellArgs = resolveArgs(shell);
        try {
          processHandle = wrapNativePtyProcess(spawnNativePty(shell, shellArgs, {
            name: "xterm-256color",
            cols: 80,
            rows: 24,
            cwd: normalizedCwd,
            env,
          }));
        } catch (nativeError) {
          lastError = nativeError;
          processHandle = spawnFallbackScriptPty(shell, shellArgs, normalizedCwd, env);
        }
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!processHandle) {
      const attempted = attemptedShells.join(", ") || "(none)";
      const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
      throw new Error(`Failed to start terminal shell in ${normalizedCwd}. Tried: ${attempted}. Last error: ${message}`);
    }

    const id = crypto.randomUUID();
    const session: OrxaTerminalSession = {
      id,
      directory: normalizedDirectory,
      cwd: normalizedCwd,
      title: title?.trim() || "Terminal",
      owner,
      status: "running",
      pid: processHandle.pid,
      exitCode: null,
      createdAt: Date.now(),
    };

    const record: TerminalRecord = {
      session,
      process: processHandle,
      connected: false,
      bufferedOutput: [],
    };

    processHandle.onData((chunk) => {
      if (record.connected) {
        this.emit({
          type: "pty.output",
          payload: {
            ptyID: id,
            directory: normalizedDirectory,
            chunk,
          },
        });
        return;
      }
      record.bufferedOutput.push(chunk);
    });

    processHandle.onExit(({ exitCode }) => {
      const current = this.sessions.get(id);
      if (!current) {
        return;
      }
      current.session = {
        ...current.session,
        status: "exited",
        exitCode: exitCode ?? null,
      };
      this.emit({
        type: "pty.closed",
        payload: {
          ptyID: id,
          directory: normalizedDirectory,
        },
      });
    });

    this.sessions.set(id, record);
    return session;
  }

  connectPty(directory: string, ptyID: string): TerminalConnectResult {
    const normalizedDirectory = resolveTerminalDirectory(directory);
    const record = this.getRecord(normalizedDirectory, ptyID);
    if (record.connected) {
      return {
        ptyID,
        directory: normalizedDirectory,
        connected: true,
      };
    }

    record.connected = true;
    const buffered = record.bufferedOutput.join("");
    record.bufferedOutput = [];
    if (buffered.length > 0) {
      setTimeout(() => {
        const current = this.sessions.get(ptyID);
        if (!current || !current.connected || current.session.directory !== normalizedDirectory) {
          return;
        }
        this.emit({
          type: "pty.output",
          payload: {
            ptyID,
            directory: normalizedDirectory,
            chunk: buffered,
          },
        });
      }, 0);
    }

    return {
      ptyID,
      directory: normalizedDirectory,
      connected: true,
    };
  }

  writePty(directory: string, ptyID: string, data: string) {
    const normalizedDirectory = resolveTerminalDirectory(directory);
    const record = this.getRecord(normalizedDirectory, ptyID);
    if (record.session.status !== "running") {
      return false;
    }
    record.process.write(data);
    return true;
  }

  resizePty(directory: string, ptyID: string, cols: number, rows: number) {
    const normalizedDirectory = resolveTerminalDirectory(directory);
    const record = this.getRecord(normalizedDirectory, ptyID);
    if (record.session.status !== "running") {
      return false;
    }
    record.process.resize(Math.max(1, cols), Math.max(1, rows));
    return true;
  }

  closePty(directory: string, ptyID: string) {
    const normalizedDirectory = resolveTerminalDirectory(directory);
    const record = this.getRecord(normalizedDirectory, ptyID);
    this.sessions.delete(ptyID);
    if (record.session.status === "running") {
      record.process.kill();
    }
    return true;
  }

  private getRecord(directory: string, ptyID: string) {
    const record = this.sessions.get(ptyID);
    if (!record || record.session.directory !== directory) {
      throw new Error(`Terminal not found: ${ptyID}`);
    }
    return record;
  }

  private emit(event: OrxaEvent) {
    this.onEvent?.(event);
  }
}
