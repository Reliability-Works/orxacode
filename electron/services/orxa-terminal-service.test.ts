import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnNativePtyMock } = vi.hoisted(() => ({
  spawnNativePtyMock: vi.fn(),
}));
const { spawnProcessMock } = vi.hoisted(() => ({
  spawnProcessMock: vi.fn(),
}));

vi.mock("./native-pty", () => ({
  spawnNativePty: spawnNativePtyMock,
}));
vi.mock("node:child_process", () => ({
  spawn: spawnProcessMock,
  default: {
    spawn: spawnProcessMock,
  },
}));

import { OrxaTerminalService } from "./orxa-terminal-service";

type DataListener = (chunk: string) => void;
type ExitListener = (event: { exitCode: number | null }) => void;

function createMockPty(pid = 101) {
  const dataListeners: DataListener[] = [];
  const exitListeners: ExitListener[] = [];
  return {
    pid,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((listener: DataListener) => {
      dataListeners.push(listener);
    }),
    onExit: vi.fn((listener: ExitListener) => {
      exitListeners.push(listener);
    }),
    emitData: (chunk: string) => {
      dataListeners.forEach((listener) => listener(chunk));
    },
    emitExit: (exitCode: number | null) => {
      exitListeners.forEach((listener) => listener({ exitCode }));
    },
  };
}

function createMockScriptProcess(pid = 201) {
  const stdoutListeners: Array<(chunk: Buffer) => void> = [];
  const stderrListeners: Array<(chunk: Buffer) => void> = [];
  const exitListeners: Array<(code: number | null) => void> = [];
  return {
    pid,
    stdin: {
      write: vi.fn(),
    },
    stdout: {
      on: vi.fn((event: string, listener: (chunk: Buffer) => void) => {
        if (event === "data") stdoutListeners.push(listener);
      }),
    },
    stderr: {
      on: vi.fn((event: string, listener: (chunk: Buffer) => void) => {
        if (event === "data") stderrListeners.push(listener);
      }),
    },
    on: vi.fn((event: string, listener: (code: number | null) => void) => {
      if (event === "exit") exitListeners.push(listener);
    }),
    kill: vi.fn(),
    emitStdout: (chunk: string) => stdoutListeners.forEach((listener) => listener(Buffer.from(chunk))),
    emitStderr: (chunk: string) => stderrListeners.forEach((listener) => listener(Buffer.from(chunk))),
    emitExit: (code: number | null) => exitListeners.forEach((listener) => listener(code)),
  };
}

describe("OrxaTerminalService", () => {
  beforeEach(() => {
    spawnNativePtyMock.mockReset();
    spawnProcessMock.mockReset();
    vi.useRealTimers();
  });

  it("buffers output until the terminal connects", async () => {
    vi.useFakeTimers();
    const pty = createMockPty();
    spawnNativePtyMock.mockReturnValue(pty);

    const service = new OrxaTerminalService();
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    service.onEvent = (event) => {
      events.push(event as { type: string; payload: Record<string, unknown> });
    };

    const directory = process.cwd();
    const session = service.createPty(directory, directory, "Tab 1");

    pty.emitData("hello");
    expect(events).toEqual([]);

    service.connectPty(directory, session.id);
    vi.runAllTimers();

    expect(events).toEqual([
      {
        type: "pty.output",
        payload: {
          ptyID: session.id,
          directory,
          chunk: "hello",
        },
      },
    ]);
  });

  it("keeps Claude-owned terminals out of workspace terminal listings", () => {
    const workspacePty = createMockPty(101);
    const claudePty = createMockPty(102);
    spawnNativePtyMock
      .mockReturnValueOnce(workspacePty)
      .mockReturnValueOnce(claudePty);

    const service = new OrxaTerminalService();
    const directory = process.cwd();

    const workspaceSession = service.createPty(directory, directory, "Tab 1", "workspace");
    const claudeSession = service.createPty(directory, directory, "Claude Code", "claude");

    expect(service.listPtys(directory)).toEqual([workspaceSession]);
    expect(service.listPtys(directory, "claude")).toEqual([claudeSession]);
  });

  it("falls back to another shell when the first candidate fails to spawn", () => {
    const scriptProcess = createMockScriptProcess(222);
    spawnNativePtyMock
      .mockImplementationOnce(() => {
        throw new Error("posix_spawnp failed.");
      });
    spawnProcessMock.mockReturnValueOnce(scriptProcess);

    const originalShell = process.env.SHELL;
    const originalPlatform = process.platform;
    process.env.SHELL = "/definitely/missing-shell";
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    try {
      const service = new OrxaTerminalService();
      const directory = process.cwd();
      const session = service.createPty(directory, directory, "Tab 1");

      expect(session.pid).toBe(222);
      expect(spawnNativePtyMock).toHaveBeenCalledTimes(1);
      expect(spawnProcessMock).toHaveBeenCalledTimes(1);
    } finally {
      process.env.SHELL = originalShell;
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  });

  it("throws a useful error when no shell can be spawned", () => {
    spawnNativePtyMock.mockImplementation(() => {
      throw new Error("posix_spawnp failed.");
    });
    spawnProcessMock.mockImplementation(() => {
      throw new Error("script spawn failed");
    });

    const originalShell = process.env.SHELL;
    const originalPlatform = process.platform;
    process.env.SHELL = "/definitely/missing-shell";
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    try {
      const service = new OrxaTerminalService();
      const directory = process.cwd();
      expect(() => service.createPty(directory, directory, "Tab 1")).toThrow(/Failed to start terminal shell/);
    } finally {
      process.env.SHELL = originalShell;
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  });

  it("emits close events and removes terminals on close", () => {
    const pty = createMockPty();
    spawnNativePtyMock.mockReturnValue(pty);

    const service = new OrxaTerminalService();
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    service.onEvent = (event) => {
      events.push(event as { type: string; payload: Record<string, unknown> });
    };

    const directory = process.cwd();
    const session = service.createPty(directory, directory, "Tab 1");
    service.connectPty(directory, session.id);
    pty.emitExit(0);

    expect(events.at(-1)).toEqual({
      type: "pty.closed",
      payload: {
        ptyID: session.id,
        directory,
      },
    });

    expect(service.closePty(directory, session.id)).toBe(true);
    expect(pty.kill).not.toHaveBeenCalled();
    expect(service.listPtys(directory)).toEqual([]);
  });
});
