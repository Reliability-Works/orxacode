/**
 * Shared dependency surface for the Opencode adapter helper modules.
 *
 * Mirrors `ClaudeAdapter.deps.ts` in shape: a plain factory function that
 * composes the adapter's non-Effect collaborators (SDK runtime factory,
 * session map, runtime event queue, clock + id helpers) into a single
 * `OpencodeAdapterDeps` record. The f04/f05 runtime layer builds one of
 * these inside its `Effect.gen` body and hands it to the helper modules.
 *
 * The factory does not spawn anything itself — it only wires the
 * subprocess lifecycle helper from `opencodeAppServer.ts` into the
 * `createRuntime` closure so callers can override it in tests.
 *
 * @module OpencodeAdapter.deps
 */
import { type ProviderRuntimeEvent, type ThreadId } from '@orxa-code/contracts'
import { type FileSystem, Queue } from 'effect'

import type { ServerConfigShape } from '../../config.ts'
import type { ServerSettingsShape } from '../../serverSettings.ts'
import { startOpencodeServer, type StartOpencodeServerInput } from '../opencodeAppServer.ts'
import type {
  OpencodeAdapterLiveOptions,
  OpencodeClientRuntime,
  OpencodeSessionContext,
} from './OpencodeAdapter.types.ts'
import {
  makeProviderAdapterEventStamping,
  type ProviderAdapterEventStamping,
} from './ProviderAdapter.shared.ts'

export interface OpencodeAdapterDeps extends ProviderAdapterEventStamping {
  readonly fileSystem: FileSystem.FileSystem
  readonly serverConfig: ServerConfigShape
  readonly serverSettingsService: ServerSettingsShape
  readonly createRuntime: (input: {
    readonly binaryPath: string
    readonly env?: NodeJS.ProcessEnv | undefined
    readonly signal?: AbortSignal | undefined
  }) => Promise<OpencodeClientRuntime>
  readonly sessions: Map<ThreadId, OpencodeSessionContext>
  readonly runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>
}

export interface MakeOpencodeAdapterDepsInput {
  readonly fileSystem: FileSystem.FileSystem
  readonly serverConfig: ServerConfigShape
  readonly serverSettingsService: ServerSettingsShape
  readonly sessions: Map<ThreadId, OpencodeSessionContext>
  readonly runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>
  readonly options?: OpencodeAdapterLiveOptions | undefined
}

function defaultCreateRuntime(input: StartOpencodeServerInput): Promise<OpencodeClientRuntime> {
  return startOpencodeServer(input)
}

export const makeOpencodeAdapterDeps = (
  input: MakeOpencodeAdapterDepsInput
): OpencodeAdapterDeps => {
  const stamping = makeProviderAdapterEventStamping(input.runtimeEventQueue)
  const createRuntime = input.options?.createRuntime ?? defaultCreateRuntime
  return {
    fileSystem: input.fileSystem,
    serverConfig: input.serverConfig,
    serverSettingsService: input.serverSettingsService,
    createRuntime,
    sessions: input.sessions,
    runtimeEventQueue: input.runtimeEventQueue,
    ...stamping,
  }
}
