import { ApprovalRequestId, ThreadId } from '@orxa-code/contracts'
import { vi } from 'vitest'

import { CodexAppServerManager } from './codexAppServerManager'
import type { CodexChildRoute } from './codexChildThreads'

export const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value)

type AnyFn = (...args: never[]) => unknown
type SpyTarget<K extends string> = Record<K, AnyFn>

interface BaseSession {
  provider: string
  status: string
  threadId: string
  runtimeMode: string
  model: string
  resumeCursor: { threadId: string }
  activeTurnId?: string
  createdAt: string
  updatedAt: string
}

const DEFAULT_BASE_SESSION: BaseSession = {
  provider: 'codex',
  status: 'ready',
  threadId: 'thread_1',
  runtimeMode: 'full-access',
  model: 'gpt-5.3-codex',
  resumeCursor: { threadId: 'thread_1' },
  createdAt: '2026-02-10T00:00:00.000Z',
  updatedAt: '2026-02-10T00:00:00.000Z',
}

const DEFAULT_ACCOUNT = {
  type: 'unknown',
  planType: null,
  sparkEnabled: true,
}

function makeBaseSession(overrides: Partial<BaseSession> & Record<string, unknown> = {}) {
  return { ...DEFAULT_BASE_SESSION, ...overrides }
}

function makeBaseAccount() {
  return { ...DEFAULT_ACCOUNT }
}

function spyRequireSession(manager: CodexAppServerManager, context: unknown) {
  return vi
    .spyOn(manager as unknown as SpyTarget<'requireSession'>, 'requireSession')
    .mockReturnValue(context)
}

function spySendRequest(manager: CodexAppServerManager, result?: unknown) {
  const spy = vi.spyOn(manager as unknown as SpyTarget<'sendRequest'>, 'sendRequest')
  if (result !== undefined) {
    ;(spy as unknown as { mockResolvedValue: (value: unknown) => void }).mockResolvedValue(result)
  }
  return spy
}

function spyUpdateSession(manager: CodexAppServerManager) {
  return vi
    .spyOn(manager as unknown as SpyTarget<'updateSession'>, 'updateSession')
    .mockImplementation(() => {})
}

function spyEmitEvent(manager: CodexAppServerManager) {
  return vi
    .spyOn(manager as unknown as SpyTarget<'emitEvent'>, 'emitEvent')
    .mockImplementation(() => {})
}

function spyWriteMessage(manager: CodexAppServerManager) {
  return vi
    .spyOn(manager as unknown as SpyTarget<'writeMessage'>, 'writeMessage')
    .mockImplementation(() => {})
}

export function createSendTurnHarness() {
  const manager = new CodexAppServerManager()
  const context = {
    session: makeBaseSession(),
    account: makeBaseAccount(),
    collabReceiverTurns: new Map(),
  }

  const requireSession = spyRequireSession(manager, context)
  const sendRequest = spySendRequest(manager, { turn: { id: 'turn_1' } })
  const updateSession = spyUpdateSession(manager)

  return { manager, context, requireSession, sendRequest, updateSession }
}

export function createThreadControlHarness() {
  const manager = new CodexAppServerManager()
  const context = {
    session: makeBaseSession(),
    collabReceiverTurns: new Map(),
  }

  const requireSession = spyRequireSession(manager, context)
  const sendRequest = spySendRequest(manager)
  const updateSession = spyUpdateSession(manager)

  return { manager, context, requireSession, sendRequest, updateSession }
}

export function createPendingUserInputHarness() {
  const manager = new CodexAppServerManager()
  const context = {
    session: makeBaseSession(),
    pendingUserInputs: new Map([
      [
        ApprovalRequestId.makeUnsafe('req-user-input-1'),
        {
          requestId: ApprovalRequestId.makeUnsafe('req-user-input-1'),
          jsonRpcId: 42,
          threadId: asThreadId('thread_1'),
        },
      ],
    ]),
    collabReceiverTurns: new Map(),
  }

  const requireSession = spyRequireSession(manager, context)
  const writeMessage = spyWriteMessage(manager)
  const emitEvent = spyEmitEvent(manager)

  return { manager, context, requireSession, writeMessage, emitEvent }
}

export function createCollabNotificationHarness() {
  const manager = new CodexAppServerManager()
  const context = {
    session: makeBaseSession({
      status: 'running',
      threadId: asThreadId('thread_1'),
      activeTurnId: 'turn_parent',
      resumeCursor: { threadId: 'provider_parent' },
    }),
    account: makeBaseAccount(),
    pending: new Map(),
    pendingApprovals: new Map(),
    pendingUserInputs: new Map(),
    collabReceiverTurns: new Map<string, CodexChildRoute>(),
    nextRequestId: 1,
    stopping: false,
  }

  const emitEvent = spyEmitEvent(manager)
  const updateSession = spyUpdateSession(manager)

  return { manager, context, emitEvent, updateSession }
}
