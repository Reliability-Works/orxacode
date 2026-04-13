// @vitest-environment jsdom

import type { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setupEventRouterRuntimeSync } from './-eventRouterRuntimeSync'

const mocked = vi.hoisted(() => {
  const unsubscribeDomainEvent = vi.fn()
  const unsubscribeTerminalEvent = vi.fn()
  const removeForegroundReconcileListeners = vi.fn()

  return {
    unsubscribeDomainEvent,
    unsubscribeTerminalEvent,
    removeForegroundReconcileListeners,
    onDomainEvent: vi.fn(() => unsubscribeDomainEvent),
    terminalOnEvent: vi.fn(() => unsubscribeTerminalEvent),
    registerForegroundReconcileListenersMock: vi.fn(() => removeForegroundReconcileListeners),
    createRuntimeRecoveryPipelineMock: vi.fn(),
  }
})

vi.mock('../nativeApi', () => ({
  readNativeApi: () => ({
    terminal: {
      onEvent: mocked.terminalOnEvent,
    },
  }),
}))

vi.mock('../wsRpcClient', () => ({
  getWsRpcClient: () => ({
    orchestration: {
      onDomainEvent: mocked.onDomainEvent,
    },
  }),
}))

vi.mock('./-eventRouterConnectionLifecycle', () => ({
  registerForegroundReconcileListeners: mocked.registerForegroundReconcileListenersMock,
}))

vi.mock('./-eventRouterRecoveryPipeline', () => ({
  createRuntimeRecoveryPipeline: mocked.createRuntimeRecoveryPipelineMock,
}))

describe('setupEventRouterRuntimeSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('wires foreground reconcile for welcome-driven bootstrap without running it eagerly', () => {
    const runForegroundReconcile = vi.fn(async () => undefined)
    const dispose = vi.fn()
    const cancel = vi.fn()

    mocked.createRuntimeRecoveryPipelineMock.mockReturnValue({
      applyEventBatch: vi.fn(),
      dispose,
      isDisposed: () => false,
      providerInvalidationState: { current: false },
      queryInvalidationThrottler: { cancel },
      recoverFromSequenceGap: vi.fn(async () => undefined),
      recovery: {
        classifyDomainEvent: vi.fn(() => 'apply'),
      },
      runConnectionReconcile: vi.fn(async () => undefined),
      runForegroundReconcile,
      runSnapshotRecovery: vi.fn(async () => undefined),
    })

    const bootstrapFromSnapshotRef = {
      current: async () => undefined,
    }
    const cleanup = setupEventRouterRuntimeSync({
      activeEnvironmentId: 'environment-1',
      connectionId: 41,
      runtimeGeneration: 7,
      applyOrchestrationEvents: vi.fn(),
      bootstrapFromSnapshotRef,
      clearThreadUi: vi.fn(),
      disposedRef: { current: false },
      queryClient: {} as QueryClient,
      removeOrphanedTerminalStates: vi.fn(),
      removeTerminalState: vi.fn(),
      syncProjects: vi.fn(),
      syncServerReadModel: vi.fn(),
      syncThreads: vi.fn(),
    })

    expect(mocked.createRuntimeRecoveryPipelineMock).toHaveBeenCalledOnce()
    expect(runForegroundReconcile).not.toHaveBeenCalled()
    expect(bootstrapFromSnapshotRef.current).toBe(runForegroundReconcile)
    expect(mocked.onDomainEvent).toHaveBeenCalledOnce()
    expect(mocked.terminalOnEvent).toHaveBeenCalledOnce()
    expect(mocked.registerForegroundReconcileListenersMock).toHaveBeenCalledOnce()

    cleanup?.()

    expect(dispose).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledOnce()
    expect(mocked.unsubscribeDomainEvent).toHaveBeenCalledOnce()
    expect(mocked.unsubscribeTerminalEvent).toHaveBeenCalledOnce()
    expect(mocked.removeForegroundReconcileListeners).toHaveBeenCalledOnce()
  })
})
