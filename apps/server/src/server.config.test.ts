import { KeybindingRule, ResolvedKeybindingRule, WS_METHODS } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { assertInclude, assertTrue } from '@effect/vitest/utils'
import { Effect, FileSystem, Path, Stream } from 'effect'

import {
  buildAppUnderTest,
  getWsServerUrl,
  provideServerTest,
  withWsRpcClient,
} from './server.test.helpers.ts'

it.effect('routes websocket rpc server.upsertKeybinding', () =>
  provideServerTest(
    Effect.gen(function* () {
      const rule: KeybindingRule = {
        command: 'terminal.toggle',
        key: 'ctrl+k',
      }
      const resolved: ResolvedKeybindingRule = {
        command: 'terminal.toggle',
        shortcut: {
          key: 'k',
          metaKey: false,
          ctrlKey: true,
          shiftKey: false,
          altKey: false,
          modKey: true,
        },
      }

      yield* buildAppUnderTest({
        layers: {
          keybindings: {
            upsertKeybindingRule: () => Effect.succeed([resolved]),
          },
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws')
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client => client[WS_METHODS.serverUpsertKeybinding](rule))
      )

      assert.deepEqual(response.issues, [])
      assert.deepEqual(response.keybindings, [resolved])
    })
  )
)

it.effect('rejects websocket rpc handshake when auth token is missing', () =>
  provideServerTest(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const workspaceDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-ws-auth-required-' })
      yield* fs.writeFileString(
        path.join(workspaceDir, 'needle-file.ts'),
        'export const needle = 1;'
      )

      yield* buildAppUnderTest({
        config: {
          authToken: 'secret-token',
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws')
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.projectsSearchEntries]({
            cwd: workspaceDir,
            query: 'needle',
            limit: 10,
          })
        ).pipe(Effect.result)
      )

      assertTrue(result._tag === 'Failure')
      assertInclude(String(result.failure), 'SocketOpenError')
    })
  )
)

it.effect('accepts websocket rpc handshake when auth token is provided', () =>
  provideServerTest(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const workspaceDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-ws-auth-ok-' })
      yield* fs.writeFileString(
        path.join(workspaceDir, 'needle-file.ts'),
        'export const needle = 1;'
      )

      yield* buildAppUnderTest({
        config: {
          authToken: 'secret-token',
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws?token=secret-token')
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.projectsSearchEntries]({
            cwd: workspaceDir,
            query: 'needle',
            limit: 10,
          })
        )
      )

      assert.isAtLeast(response.entries.length, 1)
      assert.equal(response.truncated, false)
    })
  )
)

it.effect('accepts websocket rpc handshake when remote access token is provided', () =>
  provideServerTest(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const workspaceDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-ws-remote-auth-' })
      yield* fs.writeFileString(
        path.join(workspaceDir, 'needle-file.ts'),
        'export const needle = 1;'
      )

      yield* buildAppUnderTest({
        config: {
          authToken: 'desktop-token',
          remoteAccessToken: 'remote-token',
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws?token=remote-token')
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.projectsSearchEntries]({
            cwd: workspaceDir,
            query: 'needle',
            limit: 10,
          })
        )
      )

      assert.isAtLeast(response.entries.length, 1)
      assert.equal(response.truncated, false)
    })
  )
)

it.effect('routes websocket rpc subscribeServerConfig streams snapshot then update', () =>
  provideServerTest(
    Effect.gen(function* () {
      const providers = [] as const
      const changeEvent = {
        keybindings: [],
        issues: [],
      } as const

      yield* buildAppUnderTest({
        layers: {
          keybindings: {
            loadConfigState: Effect.succeed({
              keybindings: [],
              issues: [],
            }),
            streamChanges: Stream.succeed(changeEvent),
          },
          providerRegistry: {
            getProviders: Effect.succeed(providers),
          },
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws')
      const events = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.subscribeServerConfig]({}).pipe(Stream.take(2), Stream.runCollect)
        )
      )

      const [first, second] = Array.from(events)
      assert.equal(first?.type, 'snapshot')
      if (first?.type === 'snapshot') {
        assert.equal(first.version, 1)
        assert.deepEqual(first.config.keybindings, [])
        assert.deepEqual(first.config.issues, [])
        assert.deepEqual(first.config.providers, providers)
      }
      assert.deepEqual(second, {
        version: 1,
        type: 'keybindingsUpdated',
        payload: { issues: [] },
      })
    })
  )
)

it.effect('routes websocket rpc subscribeServerConfig emits provider status updates', () =>
  provideServerTest(
    Effect.gen(function* () {
      const providers = [] as const

      yield* buildAppUnderTest({
        layers: {
          keybindings: {
            loadConfigState: Effect.succeed({
              keybindings: [],
              issues: [],
            }),
            streamChanges: Stream.empty,
          },
          providerRegistry: {
            getProviders: Effect.succeed([]),
            streamChanges: Stream.succeed(providers),
          },
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws')
      const events = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.subscribeServerConfig]({}).pipe(Stream.take(2), Stream.runCollect)
        )
      )

      const [first, second] = Array.from(events)
      assert.equal(first?.type, 'snapshot')
      assert.deepEqual(second, {
        version: 1,
        type: 'providerStatuses',
        payload: { providers },
      })
    })
  )
)

it.effect(
  'routes websocket rpc subscribeServerLifecycle replays snapshot and streams updates',
  () =>
    provideServerTest(
      Effect.gen(function* () {
        const lifecycleEvents = [
          {
            version: 1 as const,
            sequence: 1,
            type: 'welcome' as const,
            payload: {
              cwd: '/tmp/project',
              projectName: 'project',
            },
          },
        ] as const
        const liveEvents = Stream.make({
          version: 1 as const,
          sequence: 2,
          type: 'ready' as const,
          payload: { at: new Date().toISOString() },
        })

        yield* buildAppUnderTest({
          layers: {
            serverLifecycleEvents: {
              snapshot: Effect.succeed({
                sequence: 1,
                events: lifecycleEvents,
              }),
              stream: liveEvents,
            },
          },
        })

        const wsUrl = yield* getWsServerUrl('/ws')
        const events = yield* Effect.scoped(
          withWsRpcClient(wsUrl, client =>
            client[WS_METHODS.subscribeServerLifecycle]({}).pipe(Stream.take(2), Stream.runCollect)
          )
        )

        const [first, second] = Array.from(events)
        assert.equal(first?.type, 'welcome')
        assert.equal(first?.sequence, 1)
        assert.equal(second?.type, 'ready')
        assert.equal(second?.sequence, 2)
      })
    )
)
