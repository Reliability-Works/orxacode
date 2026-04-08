import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'
import { type GitActionProgressEvent, type GitActionProgressPhase } from '@orxa-code/contracts'

import type {
  GitActionProgressReporter,
  GitManagerShape,
  GitRunStackedActionOptions,
} from '../Services/GitManager.ts'
import { sanitizeProgressText, type GitActionProgressPayload } from './GitManagerShared.ts'

export function createProgressEmitter(
  input: { cwd: string; action: 'commit' | 'commit_push' | 'commit_push_pr' },
  options?: GitRunStackedActionOptions
): {
  actionId: string
  emit: (event: GitActionProgressPayload) => Effect.Effect<void, never>
} {
  const actionId = options?.actionId ?? randomUUID()
  const reporter = options?.progressReporter
  return {
    actionId,
    emit: event =>
      reporter
        ? reporter.publish({
            actionId,
            cwd: input.cwd,
            action: input.action,
            ...event,
          } as GitActionProgressEvent)
        : Effect.void,
  }
}

export function createActionScopedEmitter(input: {
  cwd: string
  action: 'commit' | 'commit_push' | 'commit_push_pr'
  progressReporter?: GitActionProgressReporter
  actionId?: string
}): (event: GitActionProgressPayload) => Effect.Effect<void, never> {
  return event =>
    input.progressReporter && input.actionId
      ? input.progressReporter.publish({
          actionId: input.actionId,
          cwd: input.cwd,
          action: input.action,
          ...event,
        } as GitActionProgressEvent)
      : Effect.void
}

export function createCommitProgress(
  emit: (event: GitActionProgressPayload) => Effect.Effect<void, never>
) {
  let currentHookName: string | null = null

  return {
    progress: {
      onOutputLine: ({ stream, text }: { stream: 'stdout' | 'stderr'; text: string }) => {
        const sanitized = sanitizeProgressText(text)
        if (!sanitized) {
          return Effect.void
        }
        return emit({
          kind: 'hook_output',
          hookName: currentHookName,
          stream,
          text: sanitized,
        })
      },
      onHookStarted: (hookName: string) => {
        currentHookName = hookName
        return emit({
          kind: 'hook_started',
          hookName,
        })
      },
      onHookFinished: ({
        hookName,
        exitCode,
        durationMs,
      }: {
        hookName: string
        exitCode: number | null
        durationMs: number | null
      }) => {
        if (currentHookName === hookName) {
          currentHookName = null
        }
        return emit({
          kind: 'hook_finished',
          hookName,
          exitCode,
          durationMs,
        })
      },
    },
    finishPendingHook: () => {
      if (currentHookName === null) {
        return Effect.void
      }

      const hookName = currentHookName
      currentHookName = null
      return emit({
        kind: 'hook_finished',
        hookName,
        exitCode: 0,
        durationMs: null,
      })
    },
  }
}

export function createPhases(
  input: Parameters<GitManagerShape['runStackedAction']>[0]
): GitActionProgressPhase[] {
  return [
    ...(input.featureBranch ? (['branch'] as const) : []),
    'commit',
    ...(input.action !== 'commit' ? (['push'] as const) : []),
    ...(input.action === 'commit_push_pr' ? (['pr'] as const) : []),
  ]
}
