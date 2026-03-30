import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useCodexSession } from './useCodexSession'
import {
  SESSION_KEY,
  buildOrxaCodex,
  createMockGitDiff,
  createMockReadProjectFile,
  emitCommandCompleted,
  emitCommandStarted,
  registerCodexSessionTestLifecycle,
} from './useCodexSession.test-helpers'

registerCodexSessionTestLifecycle()

  it("creates a live diff item so file change deltas are rendered", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/started",
          params: {
            threadId: "thr-1",
            item: {
              id: "file-1",
              type: "fileChange",
              path: "src/app.tsx",
              changeType: "modified",
            },
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/fileChange/outputDelta",
          params: {
            threadId: "thr-1",
            itemId: "file-1",
            delta: "@@ -1 +1 @@\n-old\n+new",
          },
        },
      });
    });

    expect(result.current.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "diff",
          path: "src/app.tsx",
          diff: "@@ -1 +1 @@\n-old\n+new",
        }),
      ]),
    );
  });

  it("attributes git diff changes to mutating command executions", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    const gitDiff = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("No local changes.")
      .mockResolvedValueOnce([
        "## Unstaged",
        "diff --git a/src/app/page.tsx b/src/app/page.tsx",
        "--- a/src/app/page.tsx",
        "+++ b/src/app/page.tsx",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"));
    window.orxa = {
      codex,
      opencode: {
        gitDiff,
      },
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/started",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-1",
              type: "commandExecution",
              command: ["/bin/zsh", "-lc", "rsync -a _template/ new-site/"],
            },
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/completed",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-1",
              type: "commandExecution",
              command: ["/bin/zsh", "-lc", "rsync -a _template/ new-site/"],
              exitCode: 0,
              aggregatedOutput: "",
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "diff",
            path: "src/app/page.tsx",
            type: "modified",
            insertions: 1,
            deletions: 1,
          }),
        ]),
      );
    });
  });

  it("surfaces command-attributed diffs while a mutating command is still running", async () => {
    vi.useFakeTimers();
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    const gitDiff = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("No local changes.")
      .mockResolvedValue([
        "## Unstaged",
        "diff --git a/src/app/page.tsx b/src/app/page.tsx",
        "--- a/src/app/page.tsx",
        "+++ b/src/app/page.tsx",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n"));
    const gitStatus = vi.fn<() => Promise<string>>().mockResolvedValue("");

    window.orxa = {
      codex,
      opencode: {
        gitDiff,
        gitStatus,
      },
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result, unmount } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/started",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-live-1",
              type: "commandExecution",
              command: "rsync -a _template/ src/",
            },
          },
        },
      });
    });

    await act(async () => {
      vi.advanceTimersByTime(900);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      result.current.messages.some((message) =>
        message.kind === "diff" &&
        message.path === "src/app/page.tsx" &&
        message.status === "running",
      ),
    ).toBe(true);

    unmount();
    vi.useRealTimers();
  });

  it("isolates command-attributed diffs from earlier dirty-file changes", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    window.orxa = {
      codex,
      opencode: {
        gitDiff: createMockGitDiff("before", "after"),
        readProjectFile: createMockReadProjectFile("before", "after"),
      },
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      if (!notify) return;
      emitCommandStarted(notify, "cmd-write-2");
      emitCommandCompleted(notify, "cmd-write-2");
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "diff",
            path: "src/app/page.tsx",
            diff: expect.stringContaining("-before"),
          }),
        ]),
      );
    });
    expect(result.current.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "diff",
          diff: expect.stringContaining("-old"),
        }),
      ]),
    );
  });

  it("attributes new untracked files from git status when command diffs do not include them", async () => {
    let notify: ((event: unknown) => void) | undefined;
    const codex = buildOrxaCodex();
    const gitDiff = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("No local changes.")
      .mockResolvedValueOnce("No local changes.");
    const gitStatus = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("?? src/new-page.tsx");
    const readProjectFile = vi
      .fn<() => Promise<{ path: string; relativePath: string; content: string; binary: false; truncated: false }>>()
      .mockResolvedValueOnce({
        path: "/workspace/src/new-page.tsx",
        relativePath: "src/new-page.tsx",
        content: "export default function Page() {}\n",
        binary: false,
        truncated: false,
      });

    window.orxa = {
      codex,
      opencode: {
        gitDiff,
        gitStatus,
        readProjectFile,
      },
      events: {
        subscribe: vi.fn((handler: (event: unknown) => void) => {
          notify = handler;
          return vi.fn();
        }),
      },
    } as unknown as typeof window.orxa;

    const { result } = renderHook(() => useCodexSession("/workspace", SESSION_KEY));

    await act(async () => {
      await result.current.startThread();
    });

    act(() => {
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/started",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-3",
              type: "commandExecution",
              command: "rsync -a _template/ src/",
            },
          },
        },
      });
      notify?.({
        type: "codex.notification",
        payload: {
          method: "item/completed",
          params: {
            threadId: "thr-1",
            item: {
              id: "cmd-write-3",
              type: "commandExecution",
              command: "rsync -a _template/ src/",
              exitCode: 0,
              aggregatedOutput: "",
            },
          },
        },
      });
    });

    await waitFor(() => {
      expect(result.current.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "diff",
            path: "src/new-page.tsx",
            type: "added",
            diff: expect.stringContaining("+++ b/src/new-page.tsx"),
          }),
        ]),
      );
    });
  });
