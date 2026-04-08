import { Effect } from 'effect'

import type { GitCommandError } from '@orxa-code/contracts'

import type { ExecuteGitResult, GitCoreShape } from '../Services/GitCore.ts'
import type {
  ExecuteGitFn,
  ExecuteGitOptions,
  RunGitFn,
  RunGitStdoutFn,
  RunGitStdoutWithOptionsFn,
} from './GitCore.deps.ts'
import { OUTPUT_TRUNCATED_MARKER, commandLabel, createGitCommandError } from './GitCore.parsers.ts'

export function buildGitCommandHelpers(execute: GitCoreShape['execute']): {
  executeGit: ExecuteGitFn
  runGit: RunGitFn
  runGitStdout: RunGitStdoutFn
  runGitStdoutWithOptions: RunGitStdoutWithOptionsFn
} {
  const executeGit: ExecuteGitFn = (
    operation: string,
    cwd: string,
    args: readonly string[],
    options: ExecuteGitOptions = {}
  ): Effect.Effect<ExecuteGitResult, GitCommandError> =>
    execute({
      operation,
      cwd,
      args,
      ...(options.stdin !== undefined ? { stdin: options.stdin } : {}),
      allowNonZeroExit: true,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.maxOutputBytes !== undefined ? { maxOutputBytes: options.maxOutputBytes } : {}),
      ...(options.truncateOutputAtMaxBytes !== undefined
        ? { truncateOutputAtMaxBytes: options.truncateOutputAtMaxBytes }
        : {}),
      ...(options.progress ? { progress: options.progress } : {}),
    }).pipe(
      Effect.flatMap(result => {
        if (options.allowNonZeroExit || result.code === 0) {
          return Effect.succeed(result)
        }
        const stderr = result.stderr.trim()
        if (stderr.length > 0) {
          return Effect.fail(createGitCommandError(operation, cwd, args, stderr))
        }
        if (options.fallbackErrorMessage) {
          return Effect.fail(
            createGitCommandError(operation, cwd, args, options.fallbackErrorMessage)
          )
        }
        return Effect.fail(
          createGitCommandError(
            operation,
            cwd,
            args,
            `${commandLabel(args)} failed: code=${result.code ?? 'null'}`
          )
        )
      })
    )

  const runGit: RunGitFn = (operation, cwd, args, allowNonZeroExit = false) =>
    executeGit(operation, cwd, args, { allowNonZeroExit }).pipe(Effect.asVoid)

  const runGitStdout: RunGitStdoutFn = (operation, cwd, args, allowNonZeroExit = false) =>
    executeGit(operation, cwd, args, { allowNonZeroExit }).pipe(Effect.map(result => result.stdout))

  const runGitStdoutWithOptions: RunGitStdoutWithOptionsFn = (operation, cwd, args, options = {}) =>
    executeGit(operation, cwd, args, options).pipe(
      Effect.map(result =>
        result.stdoutTruncated ? `${result.stdout}${OUTPUT_TRUNCATED_MARKER}` : result.stdout
      )
    )

  return { executeGit, runGit, runGitStdout, runGitStdoutWithOptions }
}
