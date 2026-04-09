/**
 * Shared dependency surface for the Claude adapter helper modules.
 *
 * The Claude provider runtime layer is composed of cohesive helper groups
 * (streaming, approvals, session, turn). Each group is implemented as a
 * sibling module exporting plain functions that take a `ClaudeAdapterDeps`
 * value built once inside the layer's `Effect.gen` body. This module owns
 * the dependency surface so the helper modules can stay decoupled from
 * the layer wiring shell.
 *
 * @module ClaudeAdapter.deps
 */
import type { Options as ClaudeQueryOptions, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { type ProviderRuntimeEvent, type ThreadId } from '@orxa-code/contracts'
import { type FileSystem, Queue } from 'effect'

import type { ServerConfigShape } from '../../config.ts'
import type { ServerSettingsShape } from '../../serverSettings.ts'
import type { ClaudeQueryRuntime, ClaudeSessionContext } from './ClaudeAdapter.types.ts'
import type { EventNdjsonLogger } from './EventNdjsonLogger.ts'
import {
  makeProviderAdapterEventStamping,
  type ProviderAdapterEventStamping,
} from './ProviderAdapter.shared.ts'

export interface ClaudeAdapterDeps extends ProviderAdapterEventStamping {
  readonly fileSystem: FileSystem.FileSystem
  readonly serverConfig: ServerConfigShape
  readonly serverSettingsService: ServerSettingsShape
  readonly nativeEventLogger: EventNdjsonLogger | undefined
  readonly createQuery: (input: {
    readonly prompt: AsyncIterable<SDKUserMessage>
    readonly options: ClaudeQueryOptions
  }) => ClaudeQueryRuntime
  readonly sessions: Map<ThreadId, ClaudeSessionContext>
  readonly runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>
}

export const makeClaudeAdapterDeps = (input: {
  readonly fileSystem: FileSystem.FileSystem
  readonly serverConfig: ServerConfigShape
  readonly serverSettingsService: ServerSettingsShape
  readonly nativeEventLogger: EventNdjsonLogger | undefined
  readonly createQuery: ClaudeAdapterDeps['createQuery']
  readonly sessions: Map<ThreadId, ClaudeSessionContext>
  readonly runtimeEventQueue: Queue.Queue<ProviderRuntimeEvent>
}): ClaudeAdapterDeps => {
  const stamping = makeProviderAdapterEventStamping(input.runtimeEventQueue)
  return {
    fileSystem: input.fileSystem,
    serverConfig: input.serverConfig,
    serverSettingsService: input.serverSettingsService,
    nativeEventLogger: input.nativeEventLogger,
    createQuery: input.createQuery,
    sessions: input.sessions,
    runtimeEventQueue: input.runtimeEventQueue,
    ...stamping,
  }
}
