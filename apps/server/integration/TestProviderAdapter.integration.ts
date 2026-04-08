import { type ProviderRuntimeEvent, type ProviderKind } from '@orxa-code/contracts'
import { Effect, Queue } from 'effect'

import {
  createTestProviderAdapterHarness,
  type FixtureProviderRuntimeEvent,
  type LegacyProviderRuntimeEvent,
  type TestProviderAdapterHarness,
  type TestTurnResponse,
} from './TestProviderAdapter.integration.helpers.ts'

export type {
  FixtureProviderRuntimeEvent,
  LegacyProviderRuntimeEvent,
  TestProviderAdapterHarness,
  TestTurnResponse,
}

interface MakeTestProviderAdapterHarnessOptions {
  readonly provider?: ProviderKind
}

export const makeTestProviderAdapterHarness = (options?: MakeTestProviderAdapterHarnessOptions) =>
  Effect.gen(function* () {
    const provider = options?.provider ?? 'codex'
    const runtimeEvents = yield* Queue.unbounded<ProviderRuntimeEvent>()

    return createTestProviderAdapterHarness(provider, runtimeEvents)
  })
