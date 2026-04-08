import path from 'node:path'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { assert, it } from '@effect/vitest'
import { DEFAULT_TERMINAL_ID } from '@orxa-code/contracts'
import { Effect } from 'effect'
import { expect } from 'vitest'

import {
  createManager,
  historyLogPath,
  multiTerminalHistoryLogPath,
  openInput,
  pathExists,
  readFileString,
  restartInput,
  waitFor,
  writeFileString,
} from './Manager.test.helpers'

it.layer(NodeServices.layer, { excludeTestServices: true })(
  'TerminalManager transcript reset behavior',
  it => {
    it.effect('clears transcript and emits cleared event', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter, logsDir, getEvents } = yield* createManager()
        yield* manager.open(openInput())
        const process = ptyAdapter.processes[0]
        expect(process).toBeDefined()
        if (!process) return

        process.emitData('hello\n')
        yield* waitFor(pathExists(historyLogPath(logsDir)))
        yield* manager.clear({ threadId: 'thread-1', terminalId: DEFAULT_TERMINAL_ID })
        yield* waitFor(Effect.map(readFileString(historyLogPath(logsDir)), text => text === ''))

        const events = yield* getEvents
        expect(events.some(event => event.type === 'cleared')).toBe(true)
        expect(
          events.some(
            event =>
              event.type === 'cleared' &&
              event.threadId === 'thread-1' &&
              event.terminalId === 'default'
          )
        ).toBe(true)
      })
    )

    it.effect('restarts terminal with empty transcript and respawns pty', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter, logsDir } = yield* createManager()
        yield* manager.open(openInput())
        const firstProcess = ptyAdapter.processes[0]
        expect(firstProcess).toBeDefined()
        if (!firstProcess) return
        firstProcess.emitData('before restart\n')
        yield* waitFor(pathExists(historyLogPath(logsDir)))

        const snapshot = yield* manager.restart(restartInput())
        assert.equal(snapshot.history, '')
        assert.equal(snapshot.status, 'running')
        expect(ptyAdapter.spawnInputs).toHaveLength(2)
        yield* waitFor(Effect.map(readFileString(historyLogPath(logsDir)), text => text === ''))
      })
    )

    it.effect('emits exited event and reopens with clean transcript after exit', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter, logsDir, getEvents } = yield* createManager()
        yield* manager.open(openInput())
        const process = ptyAdapter.processes[0]
        expect(process).toBeDefined()
        if (!process) return
        process.emitData('old data\n')
        yield* waitFor(pathExists(historyLogPath(logsDir)))
        process.emitExit({ exitCode: 0, signal: 0 })

        yield* waitFor(
          Effect.map(getEvents, events => events.some(event => event.type === 'exited'))
        )
        const reopened = yield* manager.open(openInput())

        assert.equal(reopened.history, '')
        expect(ptyAdapter.spawnInputs).toHaveLength(2)
        expect(yield* readFileString(historyLogPath(logsDir))).toBe('')
      })
    )
  }
)

it.layer(NodeServices.layer, { excludeTestServices: true })(
  'TerminalManager history sanitization',
  it => {
    it.effect('ignores trailing writes after terminal exit', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter } = yield* createManager()
        yield* manager.open(openInput())
        const process = ptyAdapter.processes[0]
        expect(process).toBeDefined()
        if (!process) return

        process.emitExit({ exitCode: 0, signal: 0 })

        yield* manager.write({
          threadId: 'thread-1',
          terminalId: DEFAULT_TERMINAL_ID,
          data: '\r',
        })
        expect(process.writes).toEqual([])
      })
    )

    it.effect('caps persisted history to configured line limit', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter } = yield* createManager(3)
        yield* manager.open(openInput())
        const process = ptyAdapter.processes[0]
        expect(process).toBeDefined()
        if (!process) return

        process.emitData('line1\nline2\nline3\nline4\n')
        yield* manager.close({ threadId: 'thread-1' })

        const reopened = yield* manager.open(openInput())
        const nonEmptyLines = reopened.history.split('\n').filter(line => line.length > 0)
        expect(nonEmptyLines).toEqual(['line2', 'line3', 'line4'])
      })
    )

    it.effect(
      'strips replay-unsafe terminal query and reply sequences from persisted history',
      () =>
        Effect.gen(function* () {
          const { manager, ptyAdapter } = yield* createManager()
          yield* manager.open(openInput())
          const process = ptyAdapter.processes[0]
          expect(process).toBeDefined()
          if (!process) return

          process.emitData('prompt ')
          process.emitData('\u001b[32mok\u001b[0m ')
          process.emitData('\u001b]11;rgb:ffff/ffff/ffff\u0007')
          process.emitData('\u001b[1;1R')
          process.emitData('done\n')

          yield* manager.close({ threadId: 'thread-1' })

          const reopened = yield* manager.open(openInput())
          assert.equal(reopened.history, 'prompt \u001b[32mok\u001b[0m done\n')
        })
    )
  }
)

it.layer(NodeServices.layer, { excludeTestServices: true })(
  'TerminalManager chunked history handling',
  it => {
    it.effect(
      'preserves clear and style control sequences while dropping chunk-split query traffic',
      () =>
        Effect.gen(function* () {
          const { manager, ptyAdapter } = yield* createManager()
          yield* manager.open(openInput())
          const process = ptyAdapter.processes[0]
          expect(process).toBeDefined()
          if (!process) return

          process.emitData('before clear\n')
          process.emitData('\u001b[H\u001b[2J')
          process.emitData('prompt ')
          process.emitData('\u001b]11;')
          process.emitData('rgb:ffff/ffff/ffff\u0007\u001b[1;1')
          process.emitData('R\u001b[36mdone\u001b[0m\n')

          yield* manager.close({ threadId: 'thread-1' })

          const reopened = yield* manager.open(openInput())
          assert.equal(
            reopened.history,
            'before clear\n\u001b[H\u001b[2Jprompt \u001b[36mdone\u001b[0m\n'
          )
        })
    )

    it.effect('does not leak final bytes from ESC sequences with intermediate bytes', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter } = yield* createManager()
        yield* manager.open(openInput())
        const process = ptyAdapter.processes[0]
        expect(process).toBeDefined()
        if (!process) return

        process.emitData('before ')
        process.emitData('\u001b(B')
        process.emitData('after\n')

        yield* manager.close({ threadId: 'thread-1' })

        const reopened = yield* manager.open(openInput())
        assert.equal(reopened.history, 'before \u001b(Bafter\n')
      })
    )

    it.effect(
      'preserves chunk-split ESC sequences with intermediate bytes without leaking final bytes',
      () =>
        Effect.gen(function* () {
          const { manager, ptyAdapter } = yield* createManager()
          yield* manager.open(openInput())
          const process = ptyAdapter.processes[0]
          expect(process).toBeDefined()
          if (!process) return

          process.emitData('before ')
          process.emitData('\u001b(')
          process.emitData('Bafter\n')

          yield* manager.close({ threadId: 'thread-1' })

          const reopened = yield* manager.open(openInput())
          assert.equal(reopened.history, 'before \u001b(Bafter\n')
        })
    )
  }
)

it.layer(NodeServices.layer, { excludeTestServices: true })(
  'TerminalManager history file lifecycle',
  it => {
    it.effect('deletes history file when close(deleteHistory=true)', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter, logsDir } = yield* createManager()
        yield* manager.open(openInput())
        const process = ptyAdapter.processes[0]
        expect(process).toBeDefined()
        if (!process) return
        process.emitData('bye\n')
        yield* waitFor(pathExists(historyLogPath(logsDir)))

        yield* manager.close({ threadId: 'thread-1', deleteHistory: true })
        expect(yield* pathExists(historyLogPath(logsDir))).toBe(false)
      })
    )

    it.effect('closes all terminals for a thread when close omits terminalId', () =>
      Effect.gen(function* () {
        const { manager, ptyAdapter, logsDir } = yield* createManager()
        yield* manager.open(openInput({ terminalId: 'default' }))
        yield* manager.open(openInput({ terminalId: 'sidecar' }))
        const defaultProcess = ptyAdapter.processes[0]
        const sidecarProcess = ptyAdapter.processes[1]
        expect(defaultProcess).toBeDefined()
        expect(sidecarProcess).toBeDefined()
        if (!defaultProcess || !sidecarProcess) return

        defaultProcess.emitData('default\n')
        sidecarProcess.emitData('sidecar\n')
        yield* waitFor(pathExists(multiTerminalHistoryLogPath(logsDir, 'thread-1', 'default')))
        yield* waitFor(pathExists(multiTerminalHistoryLogPath(logsDir, 'thread-1', 'sidecar')))

        yield* manager.close({ threadId: 'thread-1', deleteHistory: true })

        assert.equal(defaultProcess.killed, true)
        assert.equal(sidecarProcess.killed, true)
        expect(yield* pathExists(multiTerminalHistoryLogPath(logsDir, 'thread-1', 'default'))).toBe(
          false
        )
        expect(yield* pathExists(multiTerminalHistoryLogPath(logsDir, 'thread-1', 'sidecar'))).toBe(
          false
        )
      })
    )

    it.effect('migrates legacy transcript filenames to terminal-scoped history path on open', () =>
      Effect.gen(function* () {
        const { manager, logsDir } = yield* createManager()
        const legacyPath = path.join(logsDir, 'thread-1.log')
        const nextPath = historyLogPath(logsDir)
        yield* writeFileString(legacyPath, 'legacy-line\n')

        const snapshot = yield* manager.open(openInput())

        assert.equal(snapshot.history, 'legacy-line\n')
        expect(yield* pathExists(nextPath)).toBe(true)
        expect(yield* readFileString(nextPath)).toBe('legacy-line\n')
        expect(yield* pathExists(legacyPath)).toBe(false)
      })
    )
  }
)
