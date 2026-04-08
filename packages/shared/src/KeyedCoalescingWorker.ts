/**
 * KeyedCoalescingWorker - A keyed worker that keeps only the latest value per key.
 *
 * Enqueues for an active or already-queued key are merged atomically instead of
 * creating duplicate queued items. `drainKey()` resolves only when that key has
 * no queued, pending, or active work left.
 *
 * @module KeyedCoalescingWorker
 */
import type { Scope } from 'effect'
import { Effect, TxQueue, TxRef } from 'effect'

export interface KeyedCoalescingWorker<K, V> {
  readonly enqueue: (key: K, value: V) => Effect.Effect<void>
  readonly drainKey: (key: K) => Effect.Effect<void>
}

interface KeyedCoalescingWorkerState<K, V> {
  readonly latestByKey: Map<K, V>
  readonly queuedKeys: Set<K>
  readonly activeKeys: Set<K>
}

interface KeyedCoalescingWorkItem<K, V> {
  readonly key: K
  readonly value: V
}

function processQueuedValue<K, V>(
  stateRef: TxRef.TxRef<KeyedCoalescingWorkerState<K, V>>,
  key: K
): Effect.Effect<V | null> {
  return TxRef.modify(stateRef, state => {
    const nextValue = state.latestByKey.get(key)
    if (nextValue === undefined) {
      const activeKeys = new Set(state.activeKeys)
      activeKeys.delete(key)
      return [null, { ...state, activeKeys }] as const
    }

    const latestByKey = new Map(state.latestByKey)
    latestByKey.delete(key)
    return [nextValue, { ...state, latestByKey }] as const
  }).pipe(Effect.tx)
}

function makeProcessKey<K, V, E, R>(input: {
  readonly stateRef: TxRef.TxRef<KeyedCoalescingWorkerState<K, V>>
  readonly process: (key: K, value: V) => Effect.Effect<void, E, R>
}) {
  const processKey = (key: K, value: V): Effect.Effect<void, E, R> =>
    input.process(key, value).pipe(
      Effect.flatMap(() => processQueuedValue(input.stateRef, key)),
      Effect.flatMap(nextValue => (nextValue === null ? Effect.void : processKey(key, nextValue)))
    )

  return processKey
}

function cleanupFailedKey<K, V>(
  queue: TxQueue.TxQueue<K>,
  stateRef: TxRef.TxRef<KeyedCoalescingWorkerState<K, V>>,
  key: K
): Effect.Effect<void> {
  return TxRef.modify(stateRef, state => {
    const activeKeys = new Set(state.activeKeys)
    activeKeys.delete(key)

    if (state.latestByKey.has(key) && !state.queuedKeys.has(key)) {
      const queuedKeys = new Set(state.queuedKeys)
      queuedKeys.add(key)
      return [true, { ...state, activeKeys, queuedKeys }] as const
    }

    return [false, { ...state, activeKeys }] as const
  }).pipe(
    Effect.tx,
    Effect.flatMap(shouldRequeue => (shouldRequeue ? TxQueue.offer(queue, key) : Effect.void))
  )
}

function takeNextWorkItem<K, V>(
  queue: TxQueue.TxQueue<K>,
  stateRef: TxRef.TxRef<KeyedCoalescingWorkerState<K, V>>
): Effect.Effect<KeyedCoalescingWorkItem<K, V> | null> {
  return TxQueue.take(queue).pipe(
    Effect.flatMap(key =>
      TxRef.modify(stateRef, state => {
        const queuedKeys = new Set(state.queuedKeys)
        queuedKeys.delete(key)

        const value = state.latestByKey.get(key)
        if (value === undefined) {
          return [null, { ...state, queuedKeys }] as const
        }

        const latestByKey = new Map(state.latestByKey)
        latestByKey.delete(key)
        const activeKeys = new Set(state.activeKeys)
        activeKeys.add(key)

        return [
          { key, value } satisfies KeyedCoalescingWorkItem<K, V>,
          { ...state, latestByKey, queuedKeys, activeKeys },
        ] as const
      }).pipe(Effect.tx)
    )
  )
}

function runWorkerLoop<K, V, E, R>(input: {
  readonly queue: TxQueue.TxQueue<K>
  readonly stateRef: TxRef.TxRef<KeyedCoalescingWorkerState<K, V>>
  readonly processKey: (key: K, value: V) => Effect.Effect<void, E, R>
}): Effect.Effect<void, never, Scope.Scope | R> {
  return takeNextWorkItem(input.queue, input.stateRef).pipe(
    Effect.flatMap(item =>
      item === null
        ? Effect.void
        : input
            .processKey(item.key, item.value)
            .pipe(Effect.catchCause(() => cleanupFailedKey(input.queue, input.stateRef, item.key)))
    ),
    Effect.forever,
    Effect.forkScoped,
    Effect.asVoid
  )
}

function makeEnqueue<K, V>(
  queue: TxQueue.TxQueue<K>,
  stateRef: TxRef.TxRef<KeyedCoalescingWorkerState<K, V>>,
  merge: (current: V, next: V) => V
): KeyedCoalescingWorker<K, V>['enqueue'] {
  return (key, value) =>
    TxRef.modify(stateRef, state => {
      const latestByKey = new Map(state.latestByKey)
      const existing = latestByKey.get(key)
      latestByKey.set(key, existing === undefined ? value : merge(existing, value))

      if (state.queuedKeys.has(key) || state.activeKeys.has(key)) {
        return [false, { ...state, latestByKey }] as const
      }

      const queuedKeys = new Set(state.queuedKeys)
      queuedKeys.add(key)
      return [true, { ...state, latestByKey, queuedKeys }] as const
    }).pipe(
      Effect.flatMap(shouldOffer => (shouldOffer ? TxQueue.offer(queue, key) : Effect.void)),
      Effect.tx,
      Effect.asVoid
    )
}

function makeDrainKey<K, V>(
  stateRef: TxRef.TxRef<KeyedCoalescingWorkerState<K, V>>
): KeyedCoalescingWorker<K, V>['drainKey'] {
  return key =>
    TxRef.get(stateRef).pipe(
      Effect.tap(state =>
        state.latestByKey.has(key) || state.queuedKeys.has(key) || state.activeKeys.has(key)
          ? Effect.txRetry
          : Effect.void
      ),
      Effect.asVoid,
      Effect.tx
    )
}

export const makeKeyedCoalescingWorker = <K, V, E, R>(options: {
  readonly merge: (current: V, next: V) => V
  readonly process: (key: K, value: V) => Effect.Effect<void, E, R>
}): Effect.Effect<KeyedCoalescingWorker<K, V>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const queue = yield* Effect.acquireRelease(TxQueue.unbounded<K>(), TxQueue.shutdown)
    const stateRef = yield* TxRef.make<KeyedCoalescingWorkerState<K, V>>({
      latestByKey: new Map(),
      queuedKeys: new Set(),
      activeKeys: new Set(),
    })
    const processKey = makeProcessKey({
      stateRef,
      process: options.process,
    })

    yield* runWorkerLoop({
      queue,
      stateRef,
      processKey,
    })

    const enqueue = makeEnqueue(queue, stateRef, options.merge)
    const drainKey = makeDrainKey(stateRef)

    return { enqueue, drainKey } satisfies KeyedCoalescingWorker<K, V>
  })
