import {
  Effect,
  FileSystem,
  Path,
  PlatformError,
  Ref,
  Result,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from 'effect'

import { GitCommandError } from '@orxa-code/contracts'
import { decodeJsonResult } from '@orxa-code/shared/schemaJson'

import type { ExecuteGitInput, ExecuteGitProgress } from '../Services/GitCore.ts'

type TraceTailState = {
  processedChars: number
  remainder: string
}

type Trace2HookStart = { hookName: string; startedAtMs: number }

interface Trace2Monitor {
  readonly env: NodeJS.ProcessEnv
  readonly flush: Effect.Effect<void, never>
}

export function quoteGitCommand(args: ReadonlyArray<string>): string {
  return `git ${args.join(' ')}`
}

export function toGitCommandError(
  input: Pick<ExecuteGitInput, 'operation' | 'cwd' | 'args'>,
  detail: string
) {
  return (cause: unknown) =>
    Schema.is(GitCommandError)(cause)
      ? cause
      : new GitCommandError({
          operation: input.operation,
          command: quoteGitCommand(input.args),
          cwd: input.cwd,
          detail: `${cause instanceof Error && cause.message.length > 0 ? cause.message : 'Unknown error'} - ${detail}`,
          ...(cause !== undefined ? { cause } : {}),
        })
}

function trace2ChildKey(record: Record<string, unknown>): string | null {
  const childId = record.child_id
  if (typeof childId === 'number' || typeof childId === 'string') {
    return String(childId)
  }
  const hookName = record.hook_name
  return typeof hookName === 'string' && hookName.trim().length > 0 ? hookName.trim() : null
}

const Trace2Record = Schema.Record(Schema.String, Schema.Unknown)

const createTraceLineHandler = (
  input: Pick<ExecuteGitInput, 'operation' | 'cwd' | 'args'>,
  {
    progress,
    hookStartByChildKey,
  }: {
    progress: ExecuteGitProgress
    hookStartByChildKey: Map<string, Trace2HookStart>
  }
) =>
  Effect.fn('handleTraceLine')(function* (line: string) {
    const trimmedLine = line.trim()
    if (trimmedLine.length === 0) {
      return
    }

    const traceRecord = decodeJsonResult(Trace2Record)(trimmedLine)
    if (Result.isFailure(traceRecord)) {
      yield* Effect.logDebug(
        `GitCore.trace2: failed to parse trace line for ${quoteGitCommand(input.args)} in ${input.cwd}`,
        traceRecord.failure
      )
      return
    }

    if (traceRecord.success.child_class !== 'hook') {
      return
    }

    const event = traceRecord.success.event
    const childKey = trace2ChildKey(traceRecord.success)
    if (childKey === null) {
      return
    }
    const started = hookStartByChildKey.get(childKey)
    const hookNameFromEvent =
      typeof traceRecord.success.hook_name === 'string' ? traceRecord.success.hook_name.trim() : ''
    const hookName = hookNameFromEvent.length > 0 ? hookNameFromEvent : (started?.hookName ?? '')
    if (hookName.length === 0) {
      return
    }

    if (event === 'child_start') {
      hookStartByChildKey.set(childKey, { hookName, startedAtMs: Date.now() })
      if (progress.onHookStarted) {
        yield* progress.onHookStarted(hookName)
      }
      return
    }

    if (event === 'child_exit') {
      hookStartByChildKey.delete(childKey)
      if (progress.onHookFinished) {
        const code = traceRecord.success.code
        yield* progress.onHookFinished({
          hookName: started?.hookName ?? hookName,
          exitCode: typeof code === 'number' && Number.isInteger(code) ? code : null,
          durationMs: started ? Math.max(0, Date.now() - started.startedAtMs) : null,
        })
      }
    }
  })

function createReadTraceDelta(input: {
  fs: FileSystem.FileSystem
  traceFilePath: string
  traceTailState: Ref.Ref<TraceTailState>
  deltaMutex: Semaphore.Semaphore
  handleTraceLine: (line: string) => Effect.Effect<void, never>
}): Effect.Effect<void, never> {
  return input.deltaMutex.withPermit(
    input.fs.readFileString(input.traceFilePath).pipe(
      Effect.flatMap(contents =>
        Effect.uninterruptible(
          Ref.modify(input.traceTailState, ({ processedChars, remainder }) => {
            if (contents.length <= processedChars) {
              return [[], { processedChars, remainder }]
            }

            const appended = contents.slice(processedChars)
            const combined = remainder + appended
            const lines = combined.split('\n')
            const nextRemainder = lines.pop() ?? ''

            return [
              lines.map(line => line.replace(/\r$/, '')),
              {
                processedChars: contents.length,
                remainder: nextRemainder,
              },
            ]
          }).pipe(
            Effect.flatMap(lines => Effect.forEach(lines, input.handleTraceLine, { discard: true }))
          )
        )
      ),
      Effect.ignore({ log: true })
    )
  )
}

export const createTrace2Monitor = Effect.fn('createTrace2Monitor')(function* (
  input: Pick<ExecuteGitInput, 'operation' | 'cwd' | 'args'>,
  progress: ExecuteGitProgress | undefined
): Effect.fn.Return<
  Trace2Monitor,
  PlatformError.PlatformError,
  Scope.Scope | FileSystem.FileSystem | Path.Path
> {
  if (!progress?.onHookStarted && !progress?.onHookFinished) {
    return {
      env: {},
      flush: Effect.void,
    }
  }

  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const traceFilePath = yield* fs.makeTempFileScoped({
    prefix: `orxa-git-trace2-${process.pid}-`,
    suffix: '.json',
  })
  const hookStartByChildKey = new Map<string, Trace2HookStart>()
  const traceTailState = yield* Ref.make<TraceTailState>({
    processedChars: 0,
    remainder: '',
  })
  const handleTraceLine = createTraceLineHandler(input, {
    progress,
    hookStartByChildKey,
  })

  const deltaMutex = yield* Semaphore.make(1)
  const readTraceDelta = createReadTraceDelta({
    fs,
    traceFilePath,
    traceTailState,
    deltaMutex,
    handleTraceLine,
  })
  const traceFileName = path.basename(traceFilePath)
  yield* Stream.runForEach(fs.watch(traceFilePath), event => {
    const eventPath = event.path
    const isTargetTraceEvent =
      eventPath === traceFilePath ||
      eventPath === traceFileName ||
      path.basename(eventPath) === traceFileName
    if (!isTargetTraceEvent) return Effect.void
    return readTraceDelta
  }).pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped)

  const finalizeTrace2Monitor = Effect.fn('finalizeTrace2Monitor')(function* () {
    yield* readTraceDelta
    const finalLine = yield* Ref.modify(traceTailState, ({ processedChars, remainder }) => [
      remainder.trim(),
      {
        processedChars,
        remainder: '',
      },
    ])
    if (finalLine.length > 0) {
      yield* handleTraceLine(finalLine)
    }
  })

  yield* Effect.addFinalizer(finalizeTrace2Monitor)

  return {
    env: {
      GIT_TRACE2_EVENT: traceFilePath,
    },
    flush: readTraceDelta,
  }
})

export const collectOutput = Effect.fn('collectOutput')(function* <E>(
  input: Pick<ExecuteGitInput, 'operation' | 'cwd' | 'args'>,
  stream: Stream.Stream<Uint8Array, E>,
  maxOutputBytes: number,
  truncateOutputAtMaxBytes: boolean,
  onLine: ((line: string) => Effect.Effect<void, never>) | undefined
): Effect.fn.Return<{ readonly text: string; readonly truncated: boolean }, GitCommandError> {
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  let lineBuffer = ''
  let truncated = false

  const emitCompleteLines = Effect.fn('emitCompleteLines')(function* (flush: boolean) {
    let newlineIndex = lineBuffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = lineBuffer.slice(0, newlineIndex).replace(/\r$/, '')
      lineBuffer = lineBuffer.slice(newlineIndex + 1)
      if (line.length > 0 && onLine) {
        yield* onLine(line)
      }
      newlineIndex = lineBuffer.indexOf('\n')
    }

    if (flush) {
      const trailing = lineBuffer.replace(/\r$/, '')
      lineBuffer = ''
      if (trailing.length > 0 && onLine) {
        yield* onLine(trailing)
      }
    }
  })

  const processChunk = Effect.fn('processChunk')(function* (chunk: Uint8Array) {
    if (truncateOutputAtMaxBytes && truncated) {
      return
    }
    const nextBytes = bytes + chunk.byteLength
    if (!truncateOutputAtMaxBytes && nextBytes > maxOutputBytes) {
      return yield* new GitCommandError({
        operation: input.operation,
        command: quoteGitCommand(input.args),
        cwd: input.cwd,
        detail: `${quoteGitCommand(input.args)} output exceeded ${maxOutputBytes} bytes and was truncated.`,
      })
    }

    const chunkToDecode =
      truncateOutputAtMaxBytes && nextBytes > maxOutputBytes
        ? chunk.subarray(0, Math.max(0, maxOutputBytes - bytes))
        : chunk
    bytes += chunkToDecode.byteLength
    truncated = truncateOutputAtMaxBytes && nextBytes > maxOutputBytes

    const decoded = decoder.decode(chunkToDecode, { stream: !truncated })
    text += decoded
    lineBuffer += decoded
    yield* emitCompleteLines(false)
  })

  yield* Stream.runForEach(stream, processChunk).pipe(
    Effect.mapError(toGitCommandError(input, 'output stream failed.'))
  )

  const remainder = truncated ? '' : decoder.decode()
  text += remainder
  lineBuffer += remainder
  yield* emitCompleteLines(true)
  return {
    text,
    truncated,
  }
})
