import { render } from '@testing-library/react'
import { vi, type Mock } from 'vitest'
import type { CodexCollaborationMode, CodexModelEntry } from '@shared/ipc'
import { CodexPane } from './CodexPane'
import { setPersistedCodexState } from '../hooks/codex-session-storage'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'

export const mockOnExit = vi.fn()

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
    getThreadRuntime: vi.fn(async () => ({ thread: null, childThreads: [] })),
    resumeThread: vi.fn(async () => ({ thread: null })) as ReturnType<typeof vi.fn>,
    listThreads: vi.fn(async () => ({ threads: [], nextCursor: undefined })),
    listModels: vi.fn<() => Promise<CodexModelEntry[]>>(async () => []),
    listCollaborationModes: vi.fn<() => Promise<CodexCollaborationMode[]>>(async () => []),
    archiveThreadTree: vi.fn(async () => undefined),
    setThreadName: vi.fn(async () => undefined),
    generateRunMetadata: vi.fn(async () => ({
      title: 'Fix Workspace Session Naming',
      worktreeName: 'fix/workspace-session-naming',
    })),
    startTurn: vi.fn(async () => undefined),
    steerTurn: vi.fn(async () => undefined),
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

export function buildDefaultBranchProps(overrides: Record<string, unknown> = {}) {
  return {
    branchMenuOpen: false,
    setBranchMenuOpen: vi.fn() as Mock<(updater: (value: boolean) => boolean) => void>,
    branchControlWidthCh: 20,
    branchLoading: false,
    branchSwitching: false,
    hasActiveProject: false,
    branchCurrent: undefined,
    branchDisplayValue: '',
    branchSearchInputRef: { current: null },
    branchQuery: '',
    setBranchQuery: vi.fn(),
    branchActionError: null,
    clearBranchActionError: vi.fn(),
    checkoutBranch: vi.fn(),
    filteredBranches: [],
    openBranchCreateModal: vi.fn(),
    permissionMode: 'ask-write' as const,
    onPermissionModeChange: vi.fn(),
    ...overrides,
  }
}

export function resetCodexPaneTestState() {
  mockOnExit.mockReset()
  useUnifiedRuntimeStore.setState(state => ({
    ...state,
    codexSessions: {},
    activeSessionID: undefined,
    activeProvider: undefined,
    activeWorkspaceDirectory: undefined,
  }))
  setPersistedCodexState('/workspace/project::session-1', {
    messages: [],
    thread: null,
    isStreaming: false,
    messageIdCounter: 0,
  })
}

export function renderCodexPane(
  overrides: Record<string, unknown> = {},
  propsOverrides: Record<string, unknown> = {}
) {
  return render(
    <CodexPane
      directory="/workspace/project"
      sessionStorageKey="/workspace/project::session-1"
      onExit={mockOnExit}
      {...buildDefaultBranchProps(overrides)}
      {...propsOverrides}
    />
  )
}
