import {
  ApprovalRequestId,
  type OrchestrationEvent,
  type OrchestrationThread,
} from '@orxa-code/contracts'
import { Effect, Exit, ManagedRuntime, Option, Ref, Schedule, Schema, Scope, Stream } from 'effect'

import { type OrchestrationEngineShape } from '../src/orchestration/Services/OrchestrationEngine.ts'
import { type ProjectionSnapshotQuery } from '../src/orchestration/Services/ProjectionSnapshotQuery.ts'
import { type OrchestrationRuntimeReceipt } from '../src/orchestration/Services/RuntimeReceiptBus.ts'
import { type ProjectionPendingApprovalRepository } from '../src/persistence/Services/ProjectionPendingApprovals.ts'

export type PendingApprovalRow = {
  readonly status: 'pending' | 'resolved'
  readonly decision: 'accept' | 'acceptForSession' | 'decline' | 'cancel' | null
  readonly resolvedAt: string | null
}

class WaitForTimeoutError extends Schema.TaggedErrorClass<WaitForTimeoutError>()(
  'WaitForTimeoutError',
  { description: Schema.String }
) {}

export function waitFor<A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => boolean,
  description: string,
  timeoutMs?: number
): Effect.Effect<A, never>
export function waitFor<A, B extends A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => value is B,
  description: string,
  timeoutMs?: number
): Effect.Effect<B, never>
export function waitFor<A, E>(
  read: Effect.Effect<A, E>,
  predicate: (value: A) => boolean,
  description: string,
  timeoutMs = 40_000
): Effect.Effect<A, never> {
  const retrySignal = 'wait_for_retry'
  const retryIntervalMs = 10
  const maxRetries = Math.max(0, Math.floor(timeoutMs / retryIntervalMs))
  const retrySchedule = Schedule.spaced(`${retryIntervalMs} millis`)

  return read.pipe(
    Effect.filterOrFail(predicate, () => retrySignal),
    Effect.retry({
      schedule: retrySchedule,
      times: maxRetries,
      while: error => error === retrySignal,
    }),
    Effect.mapError(error =>
      error === retrySignal ? new WaitForTimeoutError({ description }) : error
    ),
    Effect.orDie
  )
}

function createWaitForReceipt(receiptHistory: Ref.Ref<ReadonlyArray<OrchestrationRuntimeReceipt>>) {
  function waitForReceipt(
    predicate: (receipt: OrchestrationRuntimeReceipt) => boolean,
    timeoutMs?: number
  ): Effect.Effect<OrchestrationRuntimeReceipt, never>
  function waitForReceipt<Receipt extends OrchestrationRuntimeReceipt>(
    predicate: (receipt: OrchestrationRuntimeReceipt) => receipt is Receipt,
    timeoutMs?: number
  ): Effect.Effect<Receipt, never>
  function waitForReceipt(
    predicate: (receipt: OrchestrationRuntimeReceipt) => boolean,
    timeoutMs?: number
  ) {
    const readMatchingReceipt = Ref.get(receiptHistory).pipe(
      Effect.map(history => history.find(predicate))
    )

    return waitFor(
      readMatchingReceipt,
      (receipt): receipt is OrchestrationRuntimeReceipt => receipt !== undefined,
      'runtime receipt',
      timeoutMs
    )
  }

  return waitForReceipt
}

export function createHarnessWaiters(input: {
  readonly snapshotQuery: ProjectionSnapshotQuery['Service']
  readonly engine: OrchestrationEngineShape
  readonly pendingApprovalRepository: ProjectionPendingApprovalRepository['Service']
  readonly receiptHistory: Ref.Ref<ReadonlyArray<OrchestrationRuntimeReceipt>>
}) {
  const waitForThread = (
    threadId: string,
    predicate: (thread: OrchestrationThread) => boolean,
    timeoutMs?: number
  ) =>
    waitFor(
      input.snapshotQuery
        .getSnapshot()
        .pipe(
          Effect.map(snapshot => snapshot.threads.find(thread => thread.id === threadId) ?? null)
        ),
      (thread): thread is OrchestrationThread => thread !== null && predicate(thread),
      `projected thread '${threadId}'`,
      timeoutMs
    ).pipe(Effect.map(thread => thread as OrchestrationThread))

  const waitForDomainEvent = (
    predicate: (event: OrchestrationEvent) => boolean,
    timeoutMs?: number
  ) =>
    waitFor(
      Stream.runCollect(input.engine.readEvents(0)).pipe(
        Effect.map((chunk): ReadonlyArray<OrchestrationEvent> => Array.from(chunk))
      ),
      events => events.some(predicate),
      'domain event',
      timeoutMs
    )

  const waitForPendingApproval = (
    requestId: string,
    predicate: (row: PendingApprovalRow) => boolean,
    timeoutMs?: number
  ) =>
    waitFor(
      input.pendingApprovalRepository
        .getByRequestId({
          requestId: ApprovalRequestId.makeUnsafe(requestId),
        })
        .pipe(
          Effect.map(row =>
            Option.match(row, {
              onNone: () => null,
              onSome: value => ({
                status: value.status,
                decision: value.decision,
                resolvedAt: value.resolvedAt,
              }),
            })
          )
        ),
      (row): row is PendingApprovalRow => row !== null && predicate(row),
      `pending approval '${requestId}'`,
      timeoutMs
    ).pipe(Effect.map(row => row as PendingApprovalRow))

  return {
    waitForThread,
    waitForDomainEvent,
    waitForPendingApproval,
    waitForReceipt: createWaitForReceipt(input.receiptHistory),
  }
}

export function createHarnessDispose<R, E>(
  runtime: ManagedRuntime.ManagedRuntime<R, E>,
  scope: Scope.Closeable
): Effect.Effect<void, never> {
  let disposed = false

  return Effect.gen(function* () {
    if (disposed) {
      return
    }
    disposed = true

    const shutdown = Effect.gen(function* () {
      const closeScopeExit = yield* Effect.exit(Scope.close(scope, Exit.void))
      const disposeRuntimeExit = yield* Effect.exit(Effect.promise(() => runtime.dispose()))
      const failureCause = Exit.isFailure(closeScopeExit)
        ? closeScopeExit.cause
        : Exit.isFailure(disposeRuntimeExit)
          ? disposeRuntimeExit.cause
          : null

      if (failureCause) {
        return yield* Effect.failCause(failureCause)
      }
    })

    yield* shutdown.pipe(Effect.orDie)
  })
}
