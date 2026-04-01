import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { useCodexSession } from './useCodexSession'
import {
  SESSION_KEY,
  buildOrxaCodex,
  registerCodexSessionTestLifecycle,
} from './useCodexSession.test-helpers'

registerCodexSessionTestLifecycle()

  it("splits grouped file change summaries into one diff row per file", async () => {
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
          method: "item/completed",
          params: {
            threadId: "thr-1",
            item: {
              id: "file-group-1",
              type: "fileChange",
              aggregatedOutput: [
                "Success. Updated the following files:",
                "M /workspace/src/package.json",
                "A /workspace/src/package-lock.json",
              ].join("\n"),
              exitCode: 0,
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
            path: "src/package.json",
            type: "modified",
          }),
          expect.objectContaining({
            kind: "diff",
            path: "src/package-lock.json",
            type: "added",
          }),
        ]),
      );
    });
  });

  it("hydrates grouped file change summaries with git diff hunks when available", async () => {
    let notify: ((event: unknown) => void) | undefined;
    window.orxa = {
      codex: buildOrxaCodex(),
      opencode: {
        gitDiff: vi.fn(async () => [
          "## Unstaged",
          "diff --git a/src/package.json b/src/package.json",
          "--- a/src/package.json",
          "+++ b/src/package.json",
          "@@ -1 +1 @@",
          "-\"name\": \"old\"",
          "+\"name\": \"new\"",
          "diff --git a/src/package-lock.json b/src/package-lock.json",
          "--- /dev/null",
          "+++ b/src/package-lock.json",
          "@@ -0,0 +1 @@",
          "+{\"lock\":true}",
        ].join("\n")),
        gitStatus: vi.fn(async () => ""),
        readProjectFile: vi.fn(async (_directory: string, relativePath: string) => ({
          path: `/workspace/${relativePath}`,
          relativePath,
          content: "{\"lock\":true}\n",
          binary: false,
          truncated: false,
        })),
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
          method: "item/completed",
          params: {
            threadId: "thr-1",
            item: {
              id: "file-group-hydrated-1",
              type: "fileChange",
              aggregatedOutput: [
                "Success. Updated the following files:",
                "M /workspace/src/package.json",
                "A /workspace/src/package-lock.json",
              ].join("\n"),
              exitCode: 0,
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
            path: "src/package.json",
            diff: expect.stringContaining("+++ b/src/package.json"),
            insertions: 1,
            deletions: 1,
          }),
          expect.objectContaining({
            kind: "diff",
            path: "src/package-lock.json",
            diff: expect.stringContaining("+++ b/src/package-lock.json"),
            insertions: 1,
            deletions: 0,
          }),
        ]),
      );
    });
  });

