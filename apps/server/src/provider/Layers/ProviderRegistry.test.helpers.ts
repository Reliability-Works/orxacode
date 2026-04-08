import { ChildProcessSpawner } from 'effect/unstable/process'
import { Effect, FileSystem, Layer, Path, PubSub, Ref, Schema, Sink, Stream } from 'effect'
import * as PlatformError from 'effect/PlatformError'
import type { ServerProvider } from '@orxa-code/contracts'
import {
  DEFAULT_SERVER_SETTINGS,
  ServerSettings,
  type ServerSettings as ContractServerSettings,
} from '@orxa-code/contracts'
import { deepMerge } from '@orxa-code/shared/Struct'

import { type ServerSettingsShape } from '../../serverSettings'

const encoder = new TextEncoder()
type SpawnResult = { stdout: string; stderr: string; code: number }

function mockHandle(result: SpawnResult) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: Stream.make(encoder.encode(result.stdout)),
    stderr: Stream.make(encoder.encode(result.stderr)),
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  })
}

export function mockSpawnerLayer(handler: (args: ReadonlyArray<string>) => SpawnResult) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(command => {
      const cmd = command as unknown as { args: ReadonlyArray<string> }
      return Effect.succeed(mockHandle(handler(cmd.args)))
    })
  )
}

export function mockCommandSpawnerLayer(
  handler: (command: string, args: ReadonlyArray<string>) => SpawnResult
) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(command => {
      const cmd = command as unknown as { command: string; args: ReadonlyArray<string> }
      return Effect.succeed(mockHandle(handler(cmd.command, cmd.args)))
    })
  )
}

export function codexReadySpawnerLayer(loginStatus = 'Logged in\n') {
  return mockSpawnerLayer(args => {
    const joined = args.join(' ')
    if (joined === '--version') return { stdout: 'codex 1.0.0\n', stderr: '', code: 0 }
    if (joined === 'login status') return { stdout: loginStatus, stderr: '', code: 0 }
    throw new Error(`Unexpected args: ${joined}`)
  })
}

export function claudeReadySpawnerLayer(authStatus: string, authExitCode = 0) {
  return mockSpawnerLayer(args => {
    const joined = args.join(' ')
    if (joined === '--version') return { stdout: '1.0.0\n', stderr: '', code: 0 }
    if (joined === 'auth status') return { stdout: authStatus, stderr: '', code: authExitCode }
    throw new Error(`Unexpected args: ${joined}`)
  })
}

export function waitForProviderStatus(
  getProviders: Effect.Effect<ReadonlyArray<ServerProvider>>,
  provider: ServerProvider['provider'],
  status: ServerProvider['status'],
  maxAttempts = 20
) {
  return Effect.gen(function* () {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const providers = yield* getProviders
      if (providers.find(candidate => candidate.provider === provider)?.status === status) {
        return providers
      }
      yield* Effect.promise(() => new Promise(resolve => setTimeout(resolve, 0)))
    }

    return yield* getProviders
  })
}

export function failingSpawnerLayer(description: string) {
  return Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() =>
      Effect.fail(
        PlatformError.systemError({
          _tag: 'NotFound',
          module: 'ChildProcess',
          method: 'spawn',
          description,
        })
      )
    )
  )
}

export function makeMutableServerSettingsService(
  initial: ContractServerSettings = DEFAULT_SERVER_SETTINGS
) {
  return Effect.gen(function* () {
    const settingsRef = yield* Ref.make(initial)
    const changes = yield* PubSub.unbounded<ContractServerSettings>()

    return {
      start: Effect.void,
      ready: Effect.void,
      getSettings: Ref.get(settingsRef),
      updateSettings: patch =>
        Effect.gen(function* () {
          const current = yield* Ref.get(settingsRef)
          const next = Schema.decodeSync(ServerSettings)(deepMerge(current, patch))
          yield* Ref.set(settingsRef, next)
          yield* PubSub.publish(changes, next)
          return next
        }),
      streamChanges: Stream.fromPubSub(changes),
    } satisfies ServerSettingsShape
  })
}

export function withTempCodexHome(configContent?: string) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const tmpDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: 'orxa-test-codex-' })

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const originalCodexHome = process.env.CODEX_HOME
        process.env.CODEX_HOME = tmpDir
        return originalCodexHome
      }),
      originalCodexHome =>
        Effect.sync(() => {
          if (originalCodexHome !== undefined) {
            process.env.CODEX_HOME = originalCodexHome
          } else {
            delete process.env.CODEX_HOME
          }
        })
    )

    if (configContent !== undefined) {
      yield* fileSystem.writeFileString(path.join(tmpDir, 'config.toml'), configContent)
    }

    return { tmpDir } as const
  })
}
