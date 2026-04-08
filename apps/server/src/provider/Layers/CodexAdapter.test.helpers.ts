import {
  ApprovalRequestId,
  EventId,
  ProviderItemId,
  type ProviderApprovalDecision,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  ThreadId,
  TurnId,
} from '@orxa-code/contracts'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { it, vi } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'

import {
  CodexAppServerManager,
  type CodexAppServerSendTurnInput,
  type CodexAppServerStartSessionInput,
} from '../../codexAppServerManager.ts'
import { ServerConfig } from '../../config.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { ProviderSessionDirectory } from '../Services/ProviderSessionDirectory.ts'
import { makeCodexAdapterLive } from './CodexAdapter.ts'

export const asThreadId = (value: string): ThreadId => ThreadId.makeUnsafe(value)
export const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value)
export const asEventId = (value: string): EventId => EventId.makeUnsafe(value)
export const asItemId = (value: string): ProviderItemId => ProviderItemId.makeUnsafe(value)

export class FakeCodexManager extends CodexAppServerManager {
  public startSessionImpl = vi.fn(
    async (input: CodexAppServerStartSessionInput): Promise<ProviderSession> => {
      const now = new Date().toISOString()
      return {
        provider: 'codex',
        status: 'ready',
        runtimeMode: input.runtimeMode,
        threadId: input.threadId,
        cwd: input.cwd,
        createdAt: now,
        updatedAt: now,
      }
    }
  )

  public sendTurnImpl = vi.fn(
    async (input: CodexAppServerSendTurnInput): Promise<ProviderTurnStartResult> => {
      void input
      return {
        threadId: asThreadId('thread-1'),
        turnId: asTurnId('turn-1'),
      }
    }
  )

  public interruptTurnImpl = vi.fn(async (threadId: ThreadId, turnId?: TurnId): Promise<void> => {
    void threadId
    void turnId
    return undefined
  })

  public readThreadImpl = vi.fn(async (threadId: ThreadId) => {
    void threadId
    return {
      threadId: asThreadId('thread-1'),
      turns: [],
    }
  })

  public rollbackThreadImpl = vi.fn(async (threadId: ThreadId, numTurns: number) => {
    void threadId
    void numTurns
    return {
      threadId: asThreadId('thread-1'),
      turns: [],
    }
  })

  public respondToRequestImpl = vi.fn(
    async (
      threadId: ThreadId,
      requestId: ApprovalRequestId,
      decision: ProviderApprovalDecision
    ): Promise<void> => {
      void threadId
      void requestId
      void decision
      return undefined
    }
  )

  public respondToUserInputImpl = vi.fn(
    async (
      threadId: ThreadId,
      requestId: ApprovalRequestId,
      answers: ProviderUserInputAnswers
    ): Promise<void> => {
      void threadId
      void requestId
      void answers
      return undefined
    }
  )

  public stopAllImpl = vi.fn(() => undefined)

  override startSession(input: CodexAppServerStartSessionInput): Promise<ProviderSession> {
    return this.startSessionImpl(input)
  }

  override sendTurn(input: CodexAppServerSendTurnInput): Promise<ProviderTurnStartResult> {
    return this.sendTurnImpl(input)
  }

  override interruptTurn(threadId: ThreadId, turnId?: TurnId): Promise<void> {
    return this.interruptTurnImpl(threadId, turnId)
  }

  override readThread(threadId: ThreadId) {
    return this.readThreadImpl(threadId)
  }

  override rollbackThread(threadId: ThreadId, numTurns: number) {
    return this.rollbackThreadImpl(threadId, numTurns)
  }

  override respondToRequest(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision
  ): Promise<void> {
    return this.respondToRequestImpl(threadId, requestId, decision)
  }

  override respondToUserInput(
    threadId: ThreadId,
    requestId: ApprovalRequestId,
    answers: ProviderUserInputAnswers
  ): Promise<void> {
    return this.respondToUserInputImpl(threadId, requestId, answers)
  }

  override stopSession(threadId: ThreadId): void {
    void threadId
  }

  override listSessions(): ProviderSession[] {
    return []
  }

  override hasSession(threadId: ThreadId): boolean {
    void threadId
    return false
  }

  override stopAll(): void {
    this.stopAllImpl()
  }
}

const providerSessionDirectoryTestLayer = Layer.succeed(ProviderSessionDirectory, {
  upsert: () => Effect.void,
  getProvider: () =>
    Effect.die(new Error('ProviderSessionDirectory.getProvider is not used in test')),
  getBinding: () => Effect.succeed(Option.none()),
  remove: () => Effect.void,
  listThreadIds: () => Effect.succeed([]),
})

export function makeCodexAdapterTestLayer(manager: FakeCodexManager) {
  return it.layer(
    makeCodexAdapterLive({ manager }).pipe(
      Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
      Layer.provideMerge(ServerSettingsService.layerTest()),
      Layer.provideMerge(providerSessionDirectoryTestLayer),
      Layer.provideMerge(NodeServices.layer)
    )
  )
}
