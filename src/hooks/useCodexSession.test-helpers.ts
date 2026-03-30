import { afterEach, beforeEach, vi } from 'vitest'
import { resetPersistedCodexStateForTests, setPersistedCodexState } from './codex-session-storage'

export const SESSION_KEY = '/workspace::session-1'

export function buildOrxaCodex() {
  return {
    start: vi.fn(async () => ({
      status: 'connected' as const,
      serverInfo: { name: 'codex', version: '1.0.0' },
    })),
    stop: vi.fn(async () => ({ status: 'disconnected' as const })),
    getState: vi.fn(async () => ({ status: 'disconnected' as const })),
    startThread: vi.fn(async () => ({
      id: 'thr-1',
      preview: '',
      modelProvider: 'openai',
      createdAt: Date.now(),
    })),
    getThreadRuntime: vi.fn(async () => ({ thread: null, childThreads: [] })) as ReturnType<
      typeof vi.fn
    >,
    resumeThread: vi.fn(async () => ({ thread: null })) as ReturnType<typeof vi.fn>,
    listThreads: vi.fn(async () => ({
      threads: [] as Array<Record<string, unknown>>,
      nextCursor: undefined,
    })),
    archiveThreadTree: vi.fn(async () => undefined),
    startTurn: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    deny: vi.fn(async () => undefined),
    respondToUserInput: vi.fn(async () => undefined),
    interruptTurn: vi.fn(async () => undefined),
    interruptThreadTree: vi.fn(async () => undefined),
  }
}

export function buildOrxaEvents() {
  return {
    subscribe: vi.fn(() => vi.fn()),
  }
}

export function createMockOpencode(partial: Partial<typeof window.orxa.opencode> = {}) {
  return {
    gitDiff: vi.fn(async () => 'No local changes.'),
    gitStatus: vi.fn(async () => ''),
    readProjectFile: vi.fn(async (_directory: string, relativePath: string) => ({
      path: `/workspace/${relativePath}`,
      relativePath,
      content: '',
      binary: false,
      truncated: false,
    })),
    ...partial,
  }
}

export function createMockOrxa(partial: Partial<typeof window.orxa> = {}) {
  const { opencode: opcPartial, ...rest } = partial
  return {
    codex: buildOrxaCodex(),
    opencode: createMockOpencode(opcPartial as Partial<typeof window.orxa.opencode>),
    events: buildOrxaEvents(),
    ...rest,
  } as unknown as typeof window.orxa
}

export function createMockNotify() {
  const ref: { current: ((event: unknown) => void) | undefined } = { current: undefined }
  const subscribe = vi.fn((handler: (event: import('@shared/ipc').OrxaEvent) => void) => {
    ref.current = handler as (event: unknown) => void
    return vi.fn()
  }) as unknown as (handler: (event: import('@shared/ipc').OrxaEvent) => void) => (() => void)
  return { ref, subscribe }
}

export function createMockGitDiff(beforeContent: string, afterContent: string) {
  const beforeDiff = `## Unstaged\ndiff --git a/src/app/page.tsx b/src/app/page.tsx\n--- a/src/app/page.tsx\n+++ b/src/app/page.tsx\n@@ -1 +1 @@\n-old\n+${beforeContent}`
  const afterDiff = `## Unstaged\ndiff --git a/src/app/page.tsx b/src/app/page.tsx\n--- a/src/app/page.tsx\n+++ b/src/app/page.tsx\n@@ -1 +1 @@\n-old\n+${afterContent}`
  return vi
    .fn<() => Promise<string>>()
    .mockResolvedValueOnce(beforeDiff)
    .mockResolvedValueOnce(afterDiff)
}

export function createMockReadProjectFile(beforeContent: string, afterContent: string) {
  return vi
    .fn<() => Promise<{ path: string; relativePath: string; content: string; binary: false; truncated: false }>>()
    .mockResolvedValueOnce({
      path: '/workspace/src/app/page.tsx',
      relativePath: 'src/app/page.tsx',
      content: beforeContent + '\n',
      binary: false,
      truncated: false,
    })
    .mockResolvedValueOnce({
      path: '/workspace/src/app/page.tsx',
      relativePath: 'src/app/page.tsx',
      content: afterContent + '\n',
      binary: false,
      truncated: false,
    })
}

export function emitCommandStarted(notify: (event: unknown) => void, itemId: string) {
  notify({
    type: 'codex.notification',
    payload: {
      method: 'item/started',
      params: {
        threadId: 'thr-1',
        item: {
          id: itemId,
          type: 'commandExecution',
          command: 'rsync -a _template/ src/',
        },
      },
    },
  })
}

export function emitCommandCompleted(notify: (event: unknown) => void, itemId: string) {
  notify({
    type: 'codex.notification',
    payload: {
      method: 'item/completed',
      params: {
        threadId: 'thr-1',
        item: {
          id: itemId,
          type: 'commandExecution',
          command: 'rsync -a _template/ src/',
          exitCode: 0,
          aggregatedOutput: '',
        },
      },
    },
  })
}

export function resetTestSessionState() {
  window.localStorage.clear()
  resetPersistedCodexStateForTests()
  setPersistedCodexState(SESSION_KEY, {
    messages: [],
    thread: null,
    isStreaming: false,
    messageIdCounter: 0,
  })
}

export function setupDefaultMockOrxa() {
  window.orxa = {
    codex: buildOrxaCodex(),
    opencode: {
      gitDiff: vi.fn(async () => 'No local changes.'),
      gitStatus: vi.fn(async () => ''),
      readProjectFile: vi.fn(async (_directory: string, relativePath: string) => ({
        path: `/workspace/${relativePath}`,
        relativePath,
        content: '',
        binary: false,
        truncated: false,
      })),
    },
    events: buildOrxaEvents(),
  } as unknown as typeof window.orxa
}

export function registerCodexSessionTestLifecycle() {
  beforeEach(() => {
    resetTestSessionState()
    setupDefaultMockOrxa()
  })

  afterEach(() => {
    window.localStorage.clear()
    resetPersistedCodexStateForTests()
    // @ts-expect-error test teardown
    delete window.orxa
  })
}
