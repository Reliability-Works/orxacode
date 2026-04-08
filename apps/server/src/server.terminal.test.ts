import { TerminalNotRunningError, WS_METHODS } from '@orxa-code/contracts'
import { assert, it } from '@effect/vitest'
import { assertFailure } from '@effect/vitest/utils'
import { Effect } from 'effect'

import {
  buildAppUnderTest,
  getWsServerUrl,
  provideServerTest,
  withWsRpcClient,
} from './server.test.helpers.ts'

const terminalSnapshot = {
  threadId: 'thread-1',
  terminalId: 'default',
  cwd: '/tmp/project',
  status: 'running' as const,
  pid: 1234,
  history: '',
  exitCode: null,
  exitSignal: null,
  updatedAt: new Date().toISOString(),
}

it.effect('routes websocket rpc terminal open and restart methods', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: {
          terminalManager: {
            open: () => Effect.succeed(terminalSnapshot),
            restart: () => Effect.succeed(terminalSnapshot),
          },
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws')
      const opened = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.terminalOpen]({
            threadId: 'thread-1',
            terminalId: 'default',
            cwd: '/tmp/project',
          })
        )
      )
      assert.equal(opened.terminalId, 'default')

      const restarted = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.terminalRestart]({
            threadId: 'thread-1',
            terminalId: 'default',
            cwd: '/tmp/project',
            cols: 120,
            rows: 40,
          })
        )
      )
      assert.equal(restarted.terminalId, 'default')
    })
  )
)

it.effect('routes websocket rpc terminal write, resize, clear, and close methods', () =>
  provideServerTest(
    Effect.gen(function* () {
      yield* buildAppUnderTest({
        layers: {
          terminalManager: {
            write: () => Effect.void,
            resize: () => Effect.void,
            clear: () => Effect.void,
            close: () => Effect.void,
          },
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws')
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.terminalWrite]({
            threadId: 'thread-1',
            terminalId: 'default',
            data: 'echo hi\n',
          })
        )
      )
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.terminalResize]({
            threadId: 'thread-1',
            terminalId: 'default',
            cols: 120,
            rows: 40,
          })
        )
      )
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.terminalClear]({
            threadId: 'thread-1',
            terminalId: 'default',
          })
        )
      )
      yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.terminalClose]({
            threadId: 'thread-1',
            terminalId: 'default',
          })
        )
      )
    })
  )
)

it.effect('routes websocket rpc terminal.write errors', () =>
  provideServerTest(
    Effect.gen(function* () {
      const terminalError = new TerminalNotRunningError({
        threadId: 'thread-1',
        terminalId: 'default',
      })
      yield* buildAppUnderTest({
        layers: {
          terminalManager: {
            write: () => Effect.fail(terminalError),
          },
        },
      })

      const wsUrl = yield* getWsServerUrl('/ws')
      const result = yield* Effect.scoped(
        withWsRpcClient(wsUrl, client =>
          client[WS_METHODS.terminalWrite]({
            threadId: 'thread-1',
            terminalId: 'default',
            data: 'echo fail\n',
          })
        ).pipe(Effect.result)
      )

      assertFailure(result, terminalError)
    })
  )
)
