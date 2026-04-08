import {
  CommandId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationSession,
  type RuntimeMode,
} from '@orxa-code/contracts'
import { Cache, Cause, Duration, Effect, Layer, Option, Schema, Stream } from 'effect'
import { makeDrainableWorker } from '@orxa-code/shared/DrainableWorker'

import { GitCore } from '../../git/Services/GitCore.ts'
import { ProviderAdapterRequestError, ProviderServiceError } from '../../provider/Errors.ts'
import { TextGeneration } from '../../git/Services/TextGeneration.ts'
import { ProviderService } from '../../provider/Services/ProviderService.ts'
import { OrchestrationEngineService } from '../Services/OrchestrationEngine.ts'
import {
  ProviderCommandReactor,
  type ProviderCommandReactorShape,
} from '../Services/ProviderCommandReactor.ts'
import { ServerSettingsService } from '../../serverSettings.ts'
import { createProviderCommandReactorEventProcessor } from './ProviderCommandReactor.eventHandlers.ts'
import { createProviderCommandReactorSessionRuntime } from './ProviderCommandReactor.sessionRuntime.ts'

type ProviderIntentEvent = Extract<
  OrchestrationEvent,
  {
    type:
      | 'thread.runtime-mode-set'
      | 'thread.turn-start-requested'
      | 'thread.turn-interrupt-requested'
      | 'thread.approval-response-requested'
      | 'thread.user-input-response-requested'
      | 'thread.session-stop-requested'
  }
>

function toNonEmptyProviderInput(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function mapProviderSessionStatusToOrchestrationStatus(
  status: 'connecting' | 'ready' | 'running' | 'error' | 'closed'
): OrchestrationSession['status'] {
  switch (status) {
    case 'connecting':
      return 'starting'
    case 'running':
      return 'running'
    case 'error':
      return 'error'
    case 'closed':
      return 'stopped'
    case 'ready':
    default:
      return 'ready'
  }
}

const turnStartKeyForEvent = (event: ProviderIntentEvent): string =>
  event.commandId !== null ? `command:${event.commandId}` : `event:${event.eventId}`

const serverCommandId = (tag: string): CommandId =>
  CommandId.makeUnsafe(`server:${tag}:${crypto.randomUUID()}`)

const HANDLED_TURN_START_KEY_MAX = 10_000
const HANDLED_TURN_START_KEY_TTL = Duration.minutes(30)
const DEFAULT_RUNTIME_MODE: RuntimeMode = 'full-access'
const WORKTREE_BRANCH_PREFIX = 'orxa'
const TEMP_WORKTREE_BRANCH_PATTERN = new RegExp(`^${WORKTREE_BRANCH_PREFIX}\\/[0-9a-f]{8}$`)
const DEFAULT_THREAD_TITLE = 'New thread'

function canReplaceThreadTitle(currentTitle: string, titleSeed?: string): boolean {
  const trimmedCurrentTitle = currentTitle.trim()
  if (trimmedCurrentTitle === DEFAULT_THREAD_TITLE) {
    return true
  }

  const trimmedTitleSeed = titleSeed?.trim()
  return trimmedTitleSeed !== undefined && trimmedTitleSeed.length > 0
    ? trimmedCurrentTitle === trimmedTitleSeed
    : false
}

function isUnknownPendingApprovalRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = Cause.squash(cause)
  if (Schema.is(ProviderAdapterRequestError)(error)) {
    const detail = error.detail.toLowerCase()
    return (
      detail.includes('unknown pending approval request') ||
      detail.includes('unknown pending permission request')
    )
  }
  const message = Cause.pretty(cause)
  return (
    message.includes('unknown pending approval request') ||
    message.includes('unknown pending permission request')
  )
}

function isUnknownPendingUserInputRequestError(cause: Cause.Cause<ProviderServiceError>): boolean {
  const error = Cause.squash(cause)
  if (Schema.is(ProviderAdapterRequestError)(error)) {
    return error.detail.toLowerCase().includes('unknown pending user-input request')
  }
  return Cause.pretty(cause).toLowerCase().includes('unknown pending user-input request')
}

function stalePendingRequestDetail(
  requestKind: 'approval' | 'user-input',
  requestId: string
): string {
  return `Stale pending ${requestKind} request: ${requestId}. Provider callback state does not survive app restarts or recovered sessions. Restart the turn to continue.`
}

function isTemporaryWorktreeBranch(branch: string): boolean {
  return TEMP_WORKTREE_BRANCH_PATTERN.test(branch.trim().toLowerCase())
}

function buildGeneratedWorktreeBranchName(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/^refs\/heads\//, '')
    .replace(/['"`]/g, '')

  const withoutPrefix = normalized.startsWith(`${WORKTREE_BRANCH_PREFIX}/`)
    ? normalized.slice(`${WORKTREE_BRANCH_PREFIX}/`.length)
    : normalized

  const branchFragment = withoutPrefix
    .replace(/[^a-z0-9/_-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/-+/g, '-')
    .replace(/^[./_-]+|[./_-]+$/g, '')
    .slice(0, 64)
    .replace(/[./_-]+$/g, '')

  const safeFragment = branchFragment.length > 0 ? branchFragment : 'update'
  return `${WORKTREE_BRANCH_PREFIX}/${safeFragment}`
}

const make = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService
  const providerService = yield* ProviderService
  const git = yield* GitCore
  const textGeneration = yield* TextGeneration
  const serverSettingsService = yield* ServerSettingsService
  const handledTurnStartKeys = yield* Cache.make<string, true>({
    capacity: HANDLED_TURN_START_KEY_MAX,
    timeToLive: HANDLED_TURN_START_KEY_TTL,
    lookup: () => Effect.succeed(true),
  })

  const hasHandledTurnStartRecently = (key: string) =>
    Cache.getOption(handledTurnStartKeys, key).pipe(
      Effect.flatMap(cached =>
        Cache.set(handledTurnStartKeys, key, true).pipe(Effect.as(Option.isSome(cached)))
      )
    )
  const threadModelSelections = new Map<string, ModelSelection>()
  const runtime = createProviderCommandReactorSessionRuntime({
    orchestrationEngine,
    providerService,
    git,
    textGeneration,
    serverSettingsService,
    threadModelSelections,
    toNonEmptyProviderInput,
    canReplaceThreadTitle,
    isTemporaryWorktreeBranch,
    buildGeneratedWorktreeBranchName,
    createProviderFailureCommandId: () => serverCommandId('provider-failure-activity'),
    createSessionSetCommandId: () => serverCommandId('provider-session-set'),
    createWorktreeRenameCommandId: () => serverCommandId('worktree-branch-rename'),
    createThreadTitleRenameCommandId: () => serverCommandId('thread-title-rename'),
    mapProviderSessionStatusToOrchestrationStatus,
  })
  const processDomainEventSafely = createProviderCommandReactorEventProcessor({
    ...runtime,
    orchestrationEngine,
    providerService,
    threadModelSelections,
    turnStartKeyForEvent,
    canReplaceThreadTitle,
    hasHandledTurnStartRecently,
    isUnknownPendingApprovalRequestError,
    isUnknownPendingUserInputRequestError,
    stalePendingRequestDetail,
    defaultRuntimeMode: DEFAULT_RUNTIME_MODE,
  })
  const worker = yield* makeDrainableWorker(processDomainEventSafely)
  const start: ProviderCommandReactorShape['start'] = Effect.fn('start')(function* () {
    const processEvent = Effect.fn('processEvent')(function* (event: OrchestrationEvent) {
      if (
        event.type === 'thread.runtime-mode-set' ||
        event.type === 'thread.turn-start-requested' ||
        event.type === 'thread.turn-interrupt-requested' ||
        event.type === 'thread.approval-response-requested' ||
        event.type === 'thread.user-input-response-requested' ||
        event.type === 'thread.session-stop-requested'
      ) {
        return yield* worker.enqueue(event)
      }
    })

    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, processEvent)
    )
  })

  return {
    start,
    drain: worker.drain,
  } satisfies ProviderCommandReactorShape
})

export const ProviderCommandReactorLive = Layer.effect(ProviderCommandReactor, make)
