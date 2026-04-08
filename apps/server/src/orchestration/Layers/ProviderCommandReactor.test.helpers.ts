import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as NodeServices from '@effect/platform-node/NodeServices'
import type { ModelSelection, ProviderRuntimeEvent, ProviderSession } from '@orxa-code/contracts'
import { ApprovalRequestId, MessageId, ProjectId, ThreadId, TurnId } from '@orxa-code/contracts'
import { Effect, Exit, Layer, ManagedRuntime, PubSub, Scope, Stream } from 'effect'
import { afterEach, vi } from 'vitest'

import { deriveServerPaths, ServerConfig } from '../../config.ts'
import { GitCore, type GitCoreShape } from '../../git/Services/GitCore.ts'
import { TextGeneration, type TextGenerationShape } from '../../git/Services/TextGeneration.ts'
import { OrchestrationCommandReceiptRepositoryLive } from '../../persistence/Layers/OrchestrationCommandReceipts.ts'
import { OrchestrationEventStoreLive } from '../../persistence/Layers/OrchestrationEventStore.ts'
import { SqlitePersistenceMemory } from '../../persistence/Layers/Sqlite.ts'
import {
  ProviderService,
  type ProviderServiceShape,
} from '../../provider/Services/ProviderService.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { TextGenerationError } from '@orxa-code/contracts'
import { OrchestrationEngineLive } from './OrchestrationEngine.ts'
import { OrchestrationProjectionPipelineLive } from './ProjectionPipeline.ts'
import { OrchestrationProjectionSnapshotQueryLive } from './ProjectionSnapshotQuery.ts'
import { ProviderCommandReactorLive } from './ProviderCommandReactor.ts'
import { OrchestrationEngineService } from '../Services/OrchestrationEngine.ts'
import { ProviderCommandReactor } from '../Services/ProviderCommandReactor.ts'
import { dispatchProjectAndThreadCreate } from './Reactor.test.shared-helpers.ts'

export const asProjectId = (value: string): ProjectId => ProjectId.makeUnsafe(value)
export const asApprovalRequestId = (value: string): ApprovalRequestId =>
  ApprovalRequestId.makeUnsafe(value)
export const asMessageId = (value: string): MessageId => MessageId.makeUnsafe(value)
export const asTurnId = (value: string): TurnId => TurnId.makeUnsafe(value)

const deriveServerPathsSync = (baseDir: string, devUrl: URL | undefined) =>
  Effect.runSync(deriveServerPaths(baseDir, devUrl).pipe(Effect.provide(NodeServices.layer)))

const resolveSessionThreadId = (sessionInput: unknown, sessionIndex: number) =>
  typeof sessionInput === 'object' &&
  sessionInput !== null &&
  'threadId' in sessionInput &&
  typeof sessionInput.threadId === 'string'
    ? ThreadId.makeUnsafe(sessionInput.threadId)
    : ThreadId.makeUnsafe(`thread-${sessionIndex}`)

const resolveSessionRuntimeMode = (sessionInput: unknown) =>
  typeof sessionInput === 'object' &&
  sessionInput !== null &&
  'runtimeMode' in sessionInput &&
  (sessionInput.runtimeMode === 'approval-required' || sessionInput.runtimeMode === 'full-access')
    ? sessionInput.runtimeMode
    : 'full-access'

const resolveResumeCursor = (sessionInput: unknown) =>
  typeof sessionInput === 'object' && sessionInput !== null && 'resumeCursor' in sessionInput
    ? sessionInput.resumeCursor
    : undefined

const createStartSessionMock = (
  modelSelection: ModelSelection,
  now: string,
  runtimeSessions: Array<ProviderSession>
) => {
  let nextSessionIndex = 1
  return vi.fn((...args: [unknown, unknown]) => {
    const sessionInput = args[1]
    const sessionIndex = nextSessionIndex++
    const resumeCursor = resolveResumeCursor(sessionInput)
    const threadId = resolveSessionThreadId(sessionInput, sessionIndex)
    const session: ProviderSession = {
      provider: modelSelection.provider,
      status: 'ready' as const,
      runtimeMode: resolveSessionRuntimeMode(sessionInput),
      ...(modelSelection.model !== undefined ? { model: modelSelection.model } : {}),
      threadId,
      resumeCursor: resumeCursor ?? { opaque: `resume-${sessionIndex}` },
      createdAt: now,
      updatedAt: now,
    }
    runtimeSessions.push(session)
    return Effect.succeed(session)
  })
}

const createStopSessionMock = (runtimeSessions: Array<ProviderSession>) =>
  vi.fn((sessionInput: unknown) =>
    Effect.sync(() => {
      const threadId =
        typeof sessionInput === 'object' && sessionInput !== null && 'threadId' in sessionInput
          ? (sessionInput as { threadId?: ThreadId }).threadId
          : undefined
      if (!threadId) {
        return
      }
      const index = runtimeSessions.findIndex(session => session.threadId === threadId)
      if (index >= 0) {
        runtimeSessions.splice(index, 1)
      }
    })
  )

const createRenameBranchMock = () =>
  vi.fn((branchInput: unknown) =>
    Effect.succeed({
      branch:
        typeof branchInput === 'object' &&
        branchInput !== null &&
        'newBranch' in branchInput &&
        typeof branchInput.newBranch === 'string'
          ? branchInput.newBranch
          : 'renamed-branch',
    })
  )

const createGenerateBranchNameMock = () =>
  vi.fn<TextGenerationShape['generateBranchName']>((...args) => {
    void args
    return Effect.fail(
      new TextGenerationError({
        operation: 'generateBranchName',
        detail: 'disabled in test harness',
      })
    )
  })

const createGenerateThreadTitleMock = () =>
  vi.fn<TextGenerationShape['generateThreadTitle']>((...args) => {
    void args
    return Effect.fail(
      new TextGenerationError({
        operation: 'generateThreadTitle',
        detail: 'disabled in test harness',
      })
    )
  })

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  const poll = async (): Promise<void> => {
    if (await predicate()) {
      return
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for expectation.')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
    return poll()
  }

  return poll()
}

let runtime: ManagedRuntime.ManagedRuntime<
  OrchestrationEngineService | ProviderCommandReactor,
  unknown
> | null = null
let scope: Scope.Closeable | null = null
const createdStateDirs = new Set<string>()
const createdBaseDirs = new Set<string>()

afterEach(async () => {
  if (scope) {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
  scope = null
  if (runtime) {
    await runtime.dispose()
  }
  runtime = null
  for (const stateDir of createdStateDirs) {
    fs.rmSync(stateDir, { recursive: true, force: true })
  }
  createdStateDirs.clear()
  for (const baseDir of createdBaseDirs) {
    fs.rmSync(baseDir, { recursive: true, force: true })
  }
  createdBaseDirs.clear()
})

interface CreateHarnessInput {
  readonly baseDir?: string
  readonly threadModelSelection?: ModelSelection
  readonly sessionModelSwitch?: 'unsupported' | 'in-session'
}

const buildProviderServiceHarness = (input: CreateHarnessInput | undefined, now: string) => {
  const runtimeEventPubSub = Effect.runSync(PubSub.unbounded<ProviderRuntimeEvent>())
  const runtimeSessions: Array<ProviderSession> = []
  const modelSelection = input?.threadModelSelection ?? {
    provider: 'codex',
    model: 'gpt-5-codex',
  }
  const startSession = createStartSessionMock(modelSelection, now, runtimeSessions)
  const sendTurn = vi.fn((...args: [unknown]) => {
    void args
    return Effect.succeed({
      threadId: ThreadId.makeUnsafe('thread-1'),
      turnId: asTurnId('turn-1'),
    })
  })
  const interruptTurn = vi.fn((...args: [unknown]) => {
    void args
    return Effect.void
  })
  const respondToRequest = vi.fn<ProviderServiceShape['respondToRequest']>(() => Effect.void)
  const respondToUserInput = vi.fn<ProviderServiceShape['respondToUserInput']>(() => Effect.void)
  const stopSession = createStopSessionMock(runtimeSessions)
  const renameBranch = createRenameBranchMock()
  const generateBranchName = createGenerateBranchNameMock()
  const generateThreadTitle = createGenerateThreadTitleMock()

  const unsupported = () => Effect.die(new Error('Unsupported provider call in test')) as never
  const service: ProviderServiceShape = {
    startSession: startSession as ProviderServiceShape['startSession'],
    sendTurn: sendTurn as ProviderServiceShape['sendTurn'],
    interruptTurn: interruptTurn as ProviderServiceShape['interruptTurn'],
    respondToRequest: respondToRequest as ProviderServiceShape['respondToRequest'],
    respondToUserInput: respondToUserInput as ProviderServiceShape['respondToUserInput'],
    stopSession: stopSession as ProviderServiceShape['stopSession'],
    listSessions: () => Effect.succeed(runtimeSessions),
    getCapabilities: (...args) => {
      void args
      return Effect.succeed({
        sessionModelSwitch: input?.sessionModelSwitch ?? 'in-session',
      })
    },
    rollbackConversation: () => unsupported(),
    streamEvents: Stream.fromPubSub(runtimeEventPubSub),
  }

  return {
    modelSelection,
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    renameBranch,
    generateBranchName,
    generateThreadTitle,
    service,
  }
}

const buildProviderCommandReactorLayer = (
  baseDir: string,
  service: ProviderServiceShape,
  renameBranch: ReturnType<typeof vi.fn>,
  generateBranchName: ReturnType<typeof vi.fn<TextGenerationShape['generateBranchName']>>,
  generateThreadTitle: ReturnType<typeof vi.fn<TextGenerationShape['generateThreadTitle']>>
) => {
  const orchestrationLayer = OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(SqlitePersistenceMemory)
  )
  return ProviderCommandReactorLive.pipe(
    Layer.provideMerge(orchestrationLayer),
    Layer.provideMerge(Layer.succeed(ProviderService, service)),
    Layer.provideMerge(Layer.succeed(GitCore, { renameBranch } as unknown as GitCoreShape)),
    Layer.provideMerge(
      Layer.mock(TextGeneration, {
        generateBranchName,
        generateThreadTitle,
      })
    ),
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
    Layer.provideMerge(NodeServices.layer)
  )
}

const seedDefaultProject = async (
  engine: OrchestrationEngineService['Service'],
  modelSelection: ModelSelection,
  now: string
) => {
  await dispatchProjectAndThreadCreate(engine, {
    projectId: asProjectId('project-1'),
    projectTitle: 'Provider Project',
    workspaceRoot: '/tmp/provider-project',
    threadId: ThreadId.makeUnsafe('thread-1'),
    threadTitle: 'Thread',
    modelSelection,
    runtimeMode: 'approval-required',
    worktreePath: null,
    createdAt: now,
  })
}

export async function createHarness(input?: CreateHarnessInput) {
  const now = new Date().toISOString()
  const baseDir = input?.baseDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'orxa-reactor-'))
  createdBaseDirs.add(baseDir)
  const { stateDir } = deriveServerPathsSync(baseDir, undefined)
  createdStateDirs.add(stateDir)

  const providerHarness = buildProviderServiceHarness(input, now)
  const layer = buildProviderCommandReactorLayer(
    baseDir,
    providerHarness.service,
    providerHarness.renameBranch,
    providerHarness.generateBranchName,
    providerHarness.generateThreadTitle
  )
  runtime = ManagedRuntime.make(layer)

  const engine = await runtime.runPromise(Effect.service(OrchestrationEngineService))
  const reactor = await runtime.runPromise(Effect.service(ProviderCommandReactor))
  scope = await Effect.runPromise(Scope.make('sequential'))
  await Effect.runPromise(reactor.start().pipe(Scope.provide(scope)))
  const drain = () => Effect.runPromise(reactor.drain)

  await seedDefaultProject(engine, providerHarness.modelSelection, now)

  return {
    engine,
    stateDir,
    drain,
    ...providerHarness,
  }
}

export { ThreadId, EventId } from '@orxa-code/contracts'
export { ProviderAdapterRequestError } from '../../provider/Errors.ts'
