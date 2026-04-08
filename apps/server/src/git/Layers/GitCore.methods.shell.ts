import { Effect } from 'effect'

import type { GitCoreShape } from '../Services/GitCore.ts'

import type { GitCoreInternalDeps } from './GitCore.deps.ts'
import {
  WORKSPACE_FILES_MAX_OUTPUT_BYTES,
  chunkPathsForGitCheckIgnore,
  createGitCommandError,
  splitNullSeparatedPaths,
} from './GitCore.parsers.ts'

function buildReadConfigValue(deps: GitCoreInternalDeps): GitCoreShape['readConfigValue'] {
  return (cwd, key) =>
    deps.runGitStdout('GitCore.readConfigValue', cwd, ['config', '--get', key], true).pipe(
      Effect.map(stdout => stdout.trim()),
      Effect.map(trimmed => (trimmed.length > 0 ? trimmed : null))
    )
}

function buildIsInsideWorkTree(deps: GitCoreInternalDeps): GitCoreShape['isInsideWorkTree'] {
  return cwd =>
    deps
      .executeGit('GitCore.isInsideWorkTree', cwd, ['rev-parse', '--is-inside-work-tree'], {
        allowNonZeroExit: true,
        timeoutMs: 5_000,
        maxOutputBytes: 4_096,
      })
      .pipe(Effect.map(result => result.code === 0 && result.stdout.trim() === 'true'))
}

function buildListWorkspaceFiles(deps: GitCoreInternalDeps): GitCoreShape['listWorkspaceFiles'] {
  return cwd =>
    deps
      .executeGit(
        'GitCore.listWorkspaceFiles',
        cwd,
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        {
          allowNonZeroExit: true,
          timeoutMs: 20_000,
          maxOutputBytes: WORKSPACE_FILES_MAX_OUTPUT_BYTES,
          truncateOutputAtMaxBytes: true,
        }
      )
      .pipe(
        Effect.flatMap(result =>
          result.code === 0
            ? Effect.succeed({
                paths: splitNullSeparatedPaths(result.stdout, result.stdoutTruncated),
                truncated: result.stdoutTruncated,
              })
            : Effect.fail(
                createGitCommandError(
                  'GitCore.listWorkspaceFiles',
                  cwd,
                  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
                  result.stderr.trim().length > 0 ? result.stderr.trim() : 'git ls-files failed'
                )
              )
        )
      )
}

function buildFilterIgnoredPaths(deps: GitCoreInternalDeps): GitCoreShape['filterIgnoredPaths'] {
  return (cwd, relativePaths) =>
    Effect.gen(function* () {
      if (relativePaths.length === 0) {
        return relativePaths
      }

      const ignoredPaths = new Set<string>()
      const chunks = chunkPathsForGitCheckIgnore(relativePaths)

      for (const chunk of chunks) {
        const result = yield* deps.executeGit(
          'GitCore.filterIgnoredPaths',
          cwd,
          ['check-ignore', '--no-index', '-z', '--stdin'],
          {
            stdin: `${chunk.join('\0')}\0`,
            allowNonZeroExit: true,
            timeoutMs: 20_000,
            maxOutputBytes: WORKSPACE_FILES_MAX_OUTPUT_BYTES,
            truncateOutputAtMaxBytes: true,
          }
        )

        if (result.code !== 0 && result.code !== 1) {
          return yield* createGitCommandError(
            'GitCore.filterIgnoredPaths',
            cwd,
            ['check-ignore', '--no-index', '-z', '--stdin'],
            result.stderr.trim().length > 0 ? result.stderr.trim() : 'git check-ignore failed'
          )
        }

        for (const ignoredPath of splitNullSeparatedPaths(result.stdout, result.stdoutTruncated)) {
          ignoredPaths.add(ignoredPath)
        }
      }

      if (ignoredPaths.size === 0) {
        return relativePaths
      }

      return relativePaths.filter(relativePath => !ignoredPaths.has(relativePath))
    })
}

function buildInitRepo(deps: GitCoreInternalDeps): GitCoreShape['initRepo'] {
  return input =>
    deps
      .executeGit('GitCore.initRepo', input.cwd, ['init'], {
        timeoutMs: 10_000,
        fallbackErrorMessage: 'git init failed',
      })
      .pipe(Effect.asVoid)
}

function buildListLocalBranchNames(
  deps: GitCoreInternalDeps
): GitCoreShape['listLocalBranchNames'] {
  return cwd =>
    deps
      .runGitStdout('GitCore.listLocalBranchNames', cwd, [
        'branch',
        '--list',
        '--no-column',
        '--format=%(refname:short)',
      ])
      .pipe(
        Effect.map(stdout =>
          stdout
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
        )
      )
}

export function makeShellMethods(deps: GitCoreInternalDeps): {
  readConfigValue: GitCoreShape['readConfigValue']
  isInsideWorkTree: GitCoreShape['isInsideWorkTree']
  listWorkspaceFiles: GitCoreShape['listWorkspaceFiles']
  filterIgnoredPaths: GitCoreShape['filterIgnoredPaths']
  initRepo: GitCoreShape['initRepo']
  listLocalBranchNames: GitCoreShape['listLocalBranchNames']
} {
  return {
    readConfigValue: buildReadConfigValue(deps),
    isInsideWorkTree: buildIsInsideWorkTree(deps),
    listWorkspaceFiles: buildListWorkspaceFiles(deps),
    filterIgnoredPaths: buildFilterIgnoredPaths(deps),
    initRepo: buildInitRepo(deps),
    listLocalBranchNames: buildListLocalBranchNames(deps),
  }
}
