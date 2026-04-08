import { Effect, FileSystem, Option, Path, Scope, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/unstable/process'

import { GitCommandError } from '@orxa-code/contracts'

import type { ExecuteGitInput, ExecuteGitResult, GitCoreShape } from '../Services/GitCore.ts'
import {
  collectOutput,
  createTrace2Monitor,
  quoteGitCommand,
  toGitCommandError,
} from './GitCore.runner.ts'

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000

type CommandInput = ExecuteGitInput & { readonly args: ReadonlyArray<string> }

function failNonZeroExit(
  commandInput: CommandInput,
  stderr: { text: string },
  exitCode: number
): Effect.Effect<never, GitCommandError> {
  const trimmedStderr = stderr.text.trim()
  return Effect.fail(
    new GitCommandError({
      operation: commandInput.operation,
      command: quoteGitCommand(commandInput.args),
      cwd: commandInput.cwd,
      detail:
        trimmedStderr.length > 0
          ? `${quoteGitCommand(commandInput.args)} failed: ${trimmedStderr}`
          : `${quoteGitCommand(commandInput.args)} failed with code ${exitCode}.`,
    })
  )
}

function timeoutFailure(commandInput: CommandInput): Effect.Effect<never, GitCommandError> {
  return Effect.fail(
    new GitCommandError({
      operation: commandInput.operation,
      command: quoteGitCommand(commandInput.args),
      cwd: commandInput.cwd,
      detail: `${quoteGitCommand(commandInput.args)} timed out.`,
    })
  )
}

type ChildProcessHandleType = ChildProcessSpawner.ChildProcessHandle

function spawnGitChild(
  commandSpawner: ChildProcessSpawner.ChildProcessSpawner['Service'],
  commandInput: CommandInput,
  input: ExecuteGitInput,
  traceEnv: NodeJS.ProcessEnv
): Effect.Effect<ChildProcessHandleType, GitCommandError, Scope.Scope> {
  return commandSpawner
    .spawn(
      ChildProcess.make('git', commandInput.args, {
        cwd: commandInput.cwd,
        env: { ...process.env, ...input.env, ...traceEnv },
      })
    )
    .pipe(Effect.mapError(toGitCommandError(commandInput, 'failed to spawn.')))
}

const collectChildIo = Effect.fn('collectChildIo')(function* (
  child: ChildProcessHandleType,
  input: ExecuteGitInput,
  commandInput: CommandInput,
  maxOutputBytes: number,
  truncateOutputAtMaxBytes: boolean
) {
  return yield* Effect.all(
    [
      collectOutput(
        commandInput,
        child.stdout,
        maxOutputBytes,
        truncateOutputAtMaxBytes,
        input.progress?.onStdoutLine
      ),
      collectOutput(
        commandInput,
        child.stderr,
        maxOutputBytes,
        truncateOutputAtMaxBytes,
        input.progress?.onStderrLine
      ),
      child.exitCode.pipe(
        Effect.map(value => Number(value)),
        Effect.mapError(toGitCommandError(commandInput, 'failed to report exit code.'))
      ),
      input.stdin === undefined
        ? Effect.void
        : Stream.run(Stream.encodeText(Stream.make(input.stdin)), child.stdin).pipe(
            Effect.mapError(toGitCommandError(commandInput, 'failed to write stdin.'))
          ),
    ],
    { concurrency: 'unbounded' }
  ).pipe(Effect.map(([stdout, stderr, exitCode]) => ({ stdout, stderr, exitCode }) as const))
})

type RunGitCommandDeps = {
  readonly fileSystem: FileSystem.FileSystem
  readonly path: Path.Path
  readonly commandSpawner: ChildProcessSpawner.ChildProcessSpawner['Service']
}

const runGitCommand = Effect.fn('runGitCommand')(function* (
  deps: RunGitCommandDeps,
  input: ExecuteGitInput,
  commandInput: CommandInput,
  maxOutputBytes: number,
  truncateOutputAtMaxBytes: boolean
) {
  const trace2Monitor = yield* createTrace2Monitor(commandInput, input.progress).pipe(
    Effect.provideService(Path.Path, deps.path),
    Effect.provideService(FileSystem.FileSystem, deps.fileSystem),
    Effect.mapError(toGitCommandError(commandInput, 'failed to create trace2 monitor.'))
  )
  const child = yield* spawnGitChild(deps.commandSpawner, commandInput, input, trace2Monitor.env)
  const { stdout, stderr, exitCode } = yield* collectChildIo(
    child,
    input,
    commandInput,
    maxOutputBytes,
    truncateOutputAtMaxBytes
  )
  yield* trace2Monitor.flush

  if (!input.allowNonZeroExit && exitCode !== 0) {
    return yield* failNonZeroExit(commandInput, stderr, exitCode)
  }

  return {
    code: exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
  } satisfies ExecuteGitResult
})

function createExecute(deps: RunGitCommandDeps): GitCoreShape['execute'] {
  return Effect.fnUntraced(function* (input) {
    const commandInput: CommandInput = {
      ...input,
      args: [...input.args],
    }
    const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
    const truncateOutputAtMaxBytes = input.truncateOutputAtMaxBytes ?? false
    return yield* runGitCommand(
      deps,
      input,
      commandInput,
      maxOutputBytes,
      truncateOutputAtMaxBytes
    ).pipe(
      Effect.scoped,
      Effect.timeoutOption(timeoutMs),
      Effect.flatMap(result =>
        Option.match(result, {
          onNone: () => timeoutFailure(commandInput),
          onSome: Effect.succeed,
        })
      )
    )
  })
}

export const createExecuteGit = Effect.fn('createExecuteGit')(function* () {
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const commandSpawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return createExecute({ fileSystem, path, commandSpawner })
})
