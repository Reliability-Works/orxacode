import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect } from 'vitest'

import { GitCore } from '../Services/GitCore.ts'
import {
  splitNullSeparatedPaths,
  withGitTestLayer,
  initRepoWithCommit,
  makeIsolatedGitCore,
  makeTmpDir,
  runShellCommand,
  existsSync,
  path,
} from './GitCore.test.helpers.ts'
import { GitCommandError } from '@orxa-code/contracts'

it.effect('caps captured output when maxOutputBytes is exceeded', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const result = yield* runShellCommand({
        command: `node -e "process.stdout.write('x'.repeat(2000))"`,
        cwd: process.cwd(),
        timeoutMs: 10_000,
        maxOutputBytes: 128,
      })

      expect(result.code).toBe(0)
      expect(result.stdout.length).toBeLessThanOrEqual(128)
      expect(result.stdoutTruncated || result.stderrTruncated).toBe(true)
    })
  )
)

it.effect('creates a valid git repo', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* (yield* GitCore).initRepo({ cwd: tmp })
      expect(existsSync(path.join(tmp, '.git'))).toBe(true)
    })
  )
)

it.effect('listGitBranches reports isRepo: true after init + commit', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const tmp = yield* makeTmpDir()
      yield* initRepoWithCommit(tmp)
      const result = yield* (yield* GitCore).listBranches({ cwd: tmp })
      expect(result.isRepo).toBe(true)
      expect(result.hasOriginRemote).toBe(false)
      expect(result.branches.length).toBeGreaterThanOrEqual(1)
    })
  )
)

it.effect('filterIgnoredPaths chunks large path lists and preserves kept paths', () =>
  withGitTestLayer(
    Effect.gen(function* () {
      const cwd = '/virtual/repo'
      const relativePaths = Array.from({ length: 340 }, (_, index) => {
        const prefix = index % 3 === 0 ? 'ignored' : 'kept'
        return `${prefix}/segment-${String(index).padStart(4, '0')}/${'x'.repeat(900)}.ts`
      })
      const expectedPaths = relativePaths.filter(
        relativePath => !relativePath.startsWith('ignored/')
      )

      const seenChunks: string[][] = []
      const core = yield* makeIsolatedGitCore(input => {
        if (input.args.join(' ') !== 'check-ignore --no-index -z --stdin') {
          return Effect.fail(
            new GitCommandError({
              operation: input.operation,
              command: `git ${input.args.join(' ')}`,
              cwd: input.cwd,
              detail: 'unexpected git command in chunking test',
            })
          )
        }

        const chunkPaths = splitNullSeparatedPaths(input.stdin ?? '')
        seenChunks.push(chunkPaths)
        const ignoredPaths = chunkPaths.filter(relativePath => relativePath.startsWith('ignored/'))

        return Effect.succeed({
          code: ignoredPaths.length > 0 ? 0 : 1,
          stdout: ignoredPaths.length > 0 ? `${ignoredPaths.join('\0')}\0` : '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
        })
      })

      const result = yield* core.filterIgnoredPaths(cwd, relativePaths)

      expect(seenChunks.length).toBeGreaterThan(1)
      expect(seenChunks.flat()).toEqual(relativePaths)
      expect(result).toEqual(expectedPaths)
    })
  )
)
