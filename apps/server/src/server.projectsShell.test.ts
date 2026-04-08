import { OpenError, WS_METHODS } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { assertFailure, assertInclude, assertTrue } from '@effect/vitest/utils'
import { Effect, FileSystem, Path } from 'effect'

import {
  buildAppUnderTest,
  getWsServerUrl,
  provideServerTest,
  withWsRpcClient,
} from './server.test.helpers.ts'

it.effect('routes websocket rpc projects.searchEntries', () =>
  provideServerTest(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const workspaceDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-ws-project-search-' })
      yield* fs.writeFileString(
        path.join(workspaceDir, 'needle-file.ts'),
        'export const needle = 1;'
      )

      yield* buildAppUnderTest()

      const wsUrl = yield* getWsServerUrl('/ws')
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
      assert.isTrue(response.entries.some(entry => entry.path === 'needle-file.ts'))
      assert.equal(response.truncated, false)
    })
  )
)

it.effect('routes websocket rpc projects.searchEntries errors', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildAppUnderTest()

      const wsUrl = yield* getWsServerUrl('/ws')
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.projectsSearchEntries]({
            cwd: '/definitely/not/a/real/workspace/path',
            query: 'needle',
            limit: 10,
          })
        ).pipe(Effect.result)
      )

      assertTrue(result._tag === 'Failure')
      assertTrue(result.failure._tag === 'ProjectSearchEntriesError')
      assertInclude(
        result.failure.message,
        'Workspace root does not exist: /definitely/not/a/real/workspace/path'
      )
    })
  )
)

it.effect('routes websocket rpc projects.writeFile', () =>
  provideServerTest(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const workspaceDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-ws-project-write-' })

      yield* buildAppUnderTest()

      const wsUrl = yield* getWsServerUrl('/ws')
      const response = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.projectsWriteFile]({
            cwd: workspaceDir,
            relativePath: 'nested/created.txt',
            contents: 'written-by-rpc',
          })
        )
      )

      assert.equal(response.relativePath, 'nested/created.txt')
      const persisted = yield* fs.readFileString(path.join(workspaceDir, 'nested', 'created.txt'))
      assert.equal(persisted, 'written-by-rpc')
    })
  )
)

it.effect('routes websocket rpc projects.writeFile errors', () =>
  provideServerTest(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const workspaceDir = yield* fs.makeTempDirectoryScoped({ prefix: 'orxa-ws-project-write-' })

      yield* buildAppUnderTest()

      const wsUrl = yield* getWsServerUrl('/ws')
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.projectsWriteFile]({
            cwd: workspaceDir,
            relativePath: '../escape.txt',
            contents: 'nope',
          })
        ).pipe(Effect.result)
      )

      assertTrue(result._tag === 'Failure')
      assertTrue(result.failure._tag === 'ProjectWriteFileError')
      assert.equal(result.failure.message, 'Workspace file path must stay within the project root.')
    })
  )
)

it.effect('routes websocket rpc shell.openInEditor', () =>
  provideServerTest(
    Effect.gen(function* () {
      let openedInput: { cwd: string; editor: string } | null = null
      yield* buildAppUnderTest({
        layers: {
          open: {
            openInEditor: input =>
              Effect.sync(() => {
                openedInput = input
              }),
          },
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws')
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.shellOpenInEditor]({
            cwd: '/tmp/project',
            editor: 'cursor',
          })
        )
      )

      assert.deepEqual(openedInput, { cwd: '/tmp/project', editor: 'cursor' })
    })
  )
)

it.effect('routes websocket rpc shell.openInEditor errors', () =>
  provideServerTest(
    Effect.gen(function* () {
      const openError = new OpenError({ message: 'Editor command not found: cursor' })
      yield* buildAppUnderTest({
        layers: {
          open: {
            openInEditor: () => Effect.fail(openError),
          },
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws')
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.shellOpenInEditor]({
            cwd: '/tmp/project',
            editor: 'cursor',
          })
        ).pipe(Effect.result)
      )

      assertFailure(result, openError)
    })
  )
)
