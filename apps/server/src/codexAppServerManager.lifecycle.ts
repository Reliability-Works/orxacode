import { Effect } from 'effect'

import { resolveCodexModelForAccount } from './provider/codexAccount'

import {
  isRecoverableThreadResumeError,
  normalizeCodexModelSlug,
  readResumeThreadId,
} from './codexAppServerManager.protocol'
import {
  buildSessionOverrides,
  readThreadIdFromThreadOpenResponse,
} from './codexAppServerManager.turn'

export interface OpenThreadCollaborators {
  readonly account: import('./provider/codexAccount').CodexAccountSnapshot
  readonly emitLifecycleEvent: (method: string, message: string) => void
  readonly emitErrorEvent: (method: string, message: string) => void
  readonly sendRequest: <T>(method: string, params: unknown) => Promise<T>
  readonly runPromise: (effect: Effect.Effect<unknown, never>) => Promise<unknown>
}

export interface FinalizeStartedSessionCollaborators {
  readonly updateSession: (updates: Partial<import('@orxa-code/contracts').ProviderSession>) => void
  readonly emitLifecycleEvent: (method: string, message: string) => void
  readonly runPromise: (effect: Effect.Effect<unknown, never>) => Promise<unknown>
}

export function finalizeStartedSession(
  collab: FinalizeStartedSessionCollaborators,
  input: OpenThreadInput,
  providerThreadId: string,
  threadOpenMethod: 'thread/start' | 'thread/resume'
): void {
  collab.updateSession({
    status: 'ready',
    resumeCursor: { threadId: providerThreadId },
  })
  collab.emitLifecycleEvent('session/threadOpenResolved', `Codex ${threadOpenMethod} resolved.`)
  void Effect.logInfo('codex app-server thread open resolved', {
    threadId: input.threadId,
    threadOpenMethod,
    requestedResumeThreadId: readResumeThreadId(input) ?? null,
    resolvedThreadId: providerThreadId,
    requestedRuntimeMode: input.runtimeMode,
  }).pipe(collab.runPromise)
  collab.emitLifecycleEvent('session/ready', `Connected to thread ${providerThreadId}`)
}

export interface OpenThreadInput {
  readonly threadId: import('@orxa-code/contracts').ThreadId
  readonly runtimeMode: import('@orxa-code/contracts').RuntimeMode
  readonly model?: string
  readonly serviceTier?: string
  readonly cwd?: string
  readonly resumeCursor?: unknown
}

export async function openThreadForSession(
  collab: OpenThreadCollaborators,
  input: OpenThreadInput,
  resolvedCwd: string
): Promise<{ providerThreadId: string; method: 'thread/start' | 'thread/resume' }> {
  const normalizedModel = resolveCodexModelForAccount(
    normalizeCodexModelSlug(input.model),
    collab.account
  )
  const sessionOverrides = buildSessionOverrides(input, normalizedModel)
  const threadStartParams = {
    ...sessionOverrides,
    experimentalRawEvents: false,
  }
  const resumeThreadId = readResumeThreadId(input)

  collab.emitLifecycleEvent(
    'session/threadOpenRequested',
    resumeThreadId
      ? `Attempting to resume thread ${resumeThreadId}.`
      : 'Starting a new Codex thread.'
  )
  await Effect.logInfo('codex app-server opening thread', {
    threadId: input.threadId,
    requestedRuntimeMode: input.runtimeMode,
    requestedModel: normalizedModel ?? null,
    requestedCwd: resolvedCwd,
    resumeThreadId: resumeThreadId ?? null,
  }).pipe(collab.runPromise)

  const threadOpen = await requestThreadOpen(
    collab,
    input,
    sessionOverrides,
    threadStartParams,
    resumeThreadId
  )
  const providerThreadId = readThreadIdFromThreadOpenResponse(
    threadOpen.response,
    threadOpen.method
  )

  return { providerThreadId, method: threadOpen.method }
}

async function requestThreadOpen(
  collab: OpenThreadCollaborators,
  input: OpenThreadInput,
  sessionOverrides: ReturnType<typeof buildSessionOverrides>,
  threadStartParams: ReturnType<typeof buildSessionOverrides> & {
    experimentalRawEvents: boolean
  },
  resumeThreadId: string | undefined
): Promise<{ method: 'thread/start' | 'thread/resume'; response: unknown }> {
  if (!resumeThreadId) {
    return {
      method: 'thread/start',
      response: await collab.sendRequest('thread/start', threadStartParams),
    }
  }

  try {
    return {
      method: 'thread/resume',
      response: await collab.sendRequest('thread/resume', {
        ...sessionOverrides,
        threadId: resumeThreadId,
      }),
    }
  } catch (error) {
    if (!isRecoverableThreadResumeError(error)) {
      collab.emitErrorEvent(
        'session/threadResumeFailed',
        error instanceof Error ? error.message : 'Codex thread resume failed.'
      )
      await Effect.logWarning('codex app-server thread resume failed', {
        threadId: input.threadId,
        requestedRuntimeMode: input.runtimeMode,
        resumeThreadId,
        recoverable: false,
        cause: error instanceof Error ? error.message : String(error),
      }).pipe(collab.runPromise)
      throw error
    }

    collab.emitLifecycleEvent(
      'session/threadResumeFallback',
      `Could not resume thread ${resumeThreadId}; started a new thread instead.`
    )
    await Effect.logWarning('codex app-server thread resume fell back to fresh start', {
      threadId: input.threadId,
      requestedRuntimeMode: input.runtimeMode,
      resumeThreadId,
      recoverable: true,
      cause: error instanceof Error ? error.message : String(error),
    }).pipe(collab.runPromise)

    return {
      method: 'thread/start',
      response: await collab.sendRequest('thread/start', threadStartParams),
    }
  }
}
