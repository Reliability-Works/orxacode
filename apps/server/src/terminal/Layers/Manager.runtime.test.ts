import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, it } from '@effect/vitest'
import type { TerminalEvent } from '@orxa-code/contracts'
import { Duration, Effect, Exit, Fiber, Ref, Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { expect } from 'vitest'

import {
  createManager,
  FakePtyAdapter,
  historyLogPath,
  openInput,
  pathExists,
  waitFor,
} from './Manager.test.helpers'

it.layer(NodeServices.layer, { excludeTestServices: true })(
  'TerminalManager subprocess polling',
  it => {
    it.effect('emits subprocess activity events when child-process state changes', () =>
      Effect.gen(function* () {
        let hasRunningSubprocess = false
        const { manager, getEvents } = yield* createManager(5, {
          subprocessChecker: () => Effect.succeed(hasRunningSubprocess),
          subprocessPollIntervalMs: 20,
        })

        yield* manager.open(openInput())
        expect((yield* getEvents).some(event => event.type === 'activity')).toBe(false)

        hasRunningSubprocess = true
        yield* waitFor(
          Effect.map(getEvents, events =>
            events.some(event => event.type === 'activity' && event.hasRunningSubprocess === true)
          ),
          '1200 millis'
        )

        hasRunningSubprocess = false
        yield* waitFor(
          Effect.map(getEvents, events =>
            events.some(event => event.type === 'activity' && event.hasRunningSubprocess === false)
          ),
          '1200 millis'
        )
      })
    )

    it.effect('does not invoke subprocess polling until a terminal session is running', () =>
      Effect.gen(function* () {
        let checks = 0
        const { manager } = yield* createManager(5, {
          subprocessChecker: () => {
            checks += 1
            return Effect.succeed(false)
          },
          subprocessPollIntervalMs: 20,
        })

        yield* Effect.sleep('80 millis')
        assert.equal(checks, 0)

        yield* manager.open(openInput())
        yield* waitFor(
          Effect.sync(() => checks > 0),
          '1200 millis'
        )
      })
    )
  }
)

it.layer(NodeServices.layer, { excludeTestServices: true })(
  'TerminalManager shutdown behavior',
  it => {
    it.effect('escalates terminal shutdown to SIGKILL when process does not exit in time', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter } = yield* createManager(5, { processKillGraceMs: 10 })
        yield* manager.open(openInput())
        const process = ptyAdapter.processes[0]
        expect(process).toBeDefined()
        if (!process) return

        const closeFiber = yield* manager.close({ threadId: 'thread-1' }).pipe(Effect.forkScoped)
        yield* Effect.yieldNow
        yield* TestClock.adjust('10 millis')
        yield* Fiber.join(closeFiber)

        assert.equal(process.killSignals[0], 'SIGTERM')
        expect(process.killSignals).toContain('SIGKILL')
      }).pipe(Effect.provide(TestClock.layer()))
    )

    it.effect('evicts oldest inactive terminal sessions when retention limit is exceeded', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter, logsDir, getEvents } = yield* createManager(5, {
          maxRetainedInactiveSessions: 1,
        })

        yield* manager.open(openInput({ threadId: 'thread-1' }))
        yield* manager.open(openInput({ threadId: 'thread-2' }))

        const first = ptyAdapter.processes[0]
        const second = ptyAdapter.processes[1]
        expect(first).toBeDefined()
        expect(second).toBeDefined()
        if (!first || !second) return

        first.emitData('first-history\n')
        second.emitData('second-history\n')
        yield* waitFor(pathExists(historyLogPath(logsDir, 'thread-1')))
        first.emitExit({ exitCode: 0, signal: 0 })
        yield* Effect.sleep(Duration.millis(5))
        second.emitExit({ exitCode: 0, signal: 0 })

        yield* waitFor(
          Effect.map(
            getEvents,
            events => events.filter(event => event.type === 'exited').length === 2
          )
        )

        const reopenedSecond = yield* manager.open(openInput({ threadId: 'thread-2' }))
        const reopenedFirst = yield* manager.open(openInput({ threadId: 'thread-1' }))

        assert.equal(reopenedFirst.history, 'first-history\n')
        assert.equal(reopenedSecond.history, '')
      })
    )

    it.effect('scoped runtime shutdown stops active terminals cleanly', () =>
      Effect.gen(function* () {
        const scope = yield* Scope.make('sequential')
        const { manager, ptyAdapter } = yield* createManager(5, {
          processKillGraceMs: 10,
        }).pipe(Effect.provideService(Scope.Scope, scope))
        yield* manager.open(openInput())
        const process = ptyAdapter.processes[0]
        expect(process).toBeDefined()
        if (!process) return

        const closeScope = yield* Scope.close(scope, Exit.void).pipe(Effect.forkScoped)
        yield* Effect.yieldNow
        yield* TestClock.adjust('10 millis')
        yield* Fiber.join(closeScope)

        assert.equal(process.killSignals[0], 'SIGTERM')
        expect(process.killSignals).toContain('SIGKILL')
      }).pipe(Effect.provide(TestClock.layer()))
    )
  }
)

it.layer(NodeServices.layer, { excludeTestServices: true })(
  'TerminalManager shell fallback',
  it => {
    it.effect('retries with fallback shells when preferred shell spawn fails', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter } = yield* createManager(5, {
          shellResolver: () => '/definitely/missing-shell -l',
        })
        ptyAdapter.spawnFailures.push(new Error('posix_spawnp failed.'))

        const snapshot = yield* manager.open(openInput())

        assert.equal(snapshot.status, 'running')
        expect(ptyAdapter.spawnInputs.length).toBeGreaterThanOrEqual(2)
        expect(ptyAdapter.spawnInputs[0]?.shell).toBe('/definitely/missing-shell')

        if (process.platform === 'win32') {
          expect(
            ptyAdapter.spawnInputs.some(
              input => input.shell === 'cmd.exe' || input.shell === 'powershell.exe'
            )
          ).toBe(true)
        } else {
          expect(
            ptyAdapter.spawnInputs
              .slice(1)
              .some(input => input.shell !== '/definitely/missing-shell')
          ).toBe(true)
        }
      })
    )
  }
)

it.layer(NodeServices.layer, { excludeTestServices: true })(
  'TerminalManager environment filtering',
  it => {
    it.effect('filters app runtime env variables from terminal sessions', () =>
      Effect.gen(function* () {
        const originalValues = new Map<string, string | undefined>()
        const setEnv = (key: string, value: string | undefined) => {
          if (!originalValues.has(key)) {
            originalValues.set(key, process.env[key])
          }
          if (value === undefined) {
            delete process.env[key]
            return
          }
          process.env[key] = value
        }
        const restoreEnv = () => {
          for (const [key, value] of originalValues) {
            if (value === undefined) {
              delete process.env[key]
            } else {
              process.env[key] = value
            }
          }
        }

        setEnv('PORT', '5173')
        setEnv('ORXA_PORT', '3773')
        setEnv('VITE_DEV_SERVER_URL', 'http://localhost:5173')
        setEnv('TEST_TERMINAL_KEEP', 'keep-me')

        try {
          const { manager, ptyAdapter } = yield* createManager()
          yield* manager.open(openInput())
          const spawnInput = ptyAdapter.spawnInputs[0]
          expect(spawnInput).toBeDefined()
          if (!spawnInput) return

          expect(spawnInput.env.PORT).toBeUndefined()
          expect(spawnInput.env.ORXA_PORT).toBeUndefined()
          expect(spawnInput.env.VITE_DEV_SERVER_URL).toBeUndefined()
          expect(spawnInput.env.TEST_TERMINAL_KEEP).toBe('keep-me')
        } finally {
          restoreEnv()
        }
      })
    )
  }
)

it.layer(NodeServices.layer, { excludeTestServices: true })(
  'TerminalManager environment overrides',
  it => {
    it.effect('injects runtime env overrides into spawned terminals', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter } = yield* createManager()
        yield* manager.open(
          openInput({
            env: {
              ORXA_PROJECT_ROOT: '/repo',
              ORXA_WORKTREE_PATH: '/repo/worktree-a',
              CUSTOM_FLAG: '1',
            },
          })
        )
        const spawnInput = ptyAdapter.spawnInputs[0]
        expect(spawnInput).toBeDefined()
        if (!spawnInput) return

        assert.equal(spawnInput.env.ORXA_PROJECT_ROOT, '/repo')
        assert.equal(spawnInput.env.ORXA_WORKTREE_PATH, '/repo/worktree-a')
        assert.equal(spawnInput.env.CUSTOM_FLAG, '1')
      })
    )

    it.effect('starts zsh with prompt spacer disabled to avoid `%` end markers', () =>
      Effect.gen(function* () {
        if (process.platform === 'win32') return
        const { manager, ptyAdapter } = yield* createManager(5, {
          shellResolver: () => '/bin/zsh',
        })
        yield* manager.open(openInput())
        const spawnInput = ptyAdapter.spawnInputs[0]
        expect(spawnInput).toBeDefined()
        if (!spawnInput) return

        expect(spawnInput.args).toEqual(['-o', 'nopromptsp'])
      })
    )
  }
)

it.layer(NodeServices.layer, { excludeTestServices: true })(
  'TerminalManager PTY callback streaming',
  it => {
    it.effect('bridges PTY callbacks back into Effect-managed event streaming', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter, getEvents } = yield* createManager(5, {
          ptyAdapter: new FakePtyAdapter('async'),
        })

        yield* manager.open(openInput())
        const process = ptyAdapter.processes[0]
        expect(process).toBeDefined()
        if (!process) return

        process.emitData('hello from callback\n')

        yield* waitFor(
          Effect.map(getEvents, events =>
            events.some(event => event.type === 'output' && event.data === 'hello from callback\n')
          ),
          '1200 millis'
        )
      })
    )
  }
)

it.layer(NodeServices.layer, { excludeTestServices: true })(
  'TerminalManager PTY callback subscribers',
  it => {
    it.effect('pushes PTY callbacks to direct event subscribers', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter } = yield* createManager(5, {
          ptyAdapter: new FakePtyAdapter('async'),
        })
        const scope = yield* Effect.scope
        const subscriberEvents = yield* Ref.make<ReadonlyArray<TerminalEvent>>([])
        const unsubscribe = yield* manager.subscribe(event =>
          Ref.update(subscriberEvents, events => [...events, event])
        )
        yield* Scope.addFinalizer(scope, Effect.sync(unsubscribe))

        yield* manager.open(openInput())
        const process = ptyAdapter.processes[0]
        expect(process).toBeDefined()
        if (!process) return

        process.emitData('hello from subscriber\n')

        yield* waitFor(
          Effect.map(Ref.get(subscriberEvents), events =>
            events.some(
              event => event.type === 'output' && event.data === 'hello from subscriber\n'
            )
          ),
          '1200 millis'
        )
      })
    )

    it.effect('preserves queued PTY output ordering through exit callbacks', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter, getEvents } = yield* createManager(5, {
          ptyAdapter: new FakePtyAdapter('async'),
        })

        yield* manager.open(openInput())
        const process = ptyAdapter.processes[0]
        expect(process).toBeDefined()
        if (!process) return

        process.emitData('first\n')
        process.emitData('second\n')
        process.emitExit({ exitCode: 0, signal: 0 })

        yield* waitFor(
          Effect.map(getEvents, events => {
            const relevant = events.filter(
              event => event.type === 'output' || event.type === 'exited'
            )
            return relevant.length >= 3
          }),
          '1200 millis'
        )

        const relevant = (yield* getEvents).filter(
          event => event.type === 'output' || event.type === 'exited'
        )
        expect(relevant).toEqual([
          expect.objectContaining({ type: 'output', data: 'first\n' }),
          expect.objectContaining({ type: 'output', data: 'second\n' }),
          expect.objectContaining({ type: 'exited', exitCode: 0, exitSignal: 0 }),
        ])
      })
    )
  }
)
