import path from 'node:path'
import type { GitBranchState, GitCommitSummary } from '../../shared/ipc'
import { isMissingGhCliError, sanitizeError } from './opencode-runtime-helpers'
import { DEFAULT_COMMIT_GUIDANCE } from './opencode-git-commit-workflow'
export {
  DEFAULT_COMMIT_GUIDANCE,
  fallbackCommitMessage,
  gitCommitWorkflow,
  normalizeGitHubRemote,
  parseGitPatchStats,
  toCommitMessageArgs,
} from './opencode-git-commit-workflow'

type BasicDeps = {
  resolveGitRepoRoot: (directory: string) => Promise<string | undefined>
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>
  runCommandWithOutput: (command: string, args: string[], cwd: string) => Promise<string>
  currentBranch: (repoRoot: string) => Promise<string>
  collectGitStats: (
    repoRoot: string,
    includeUnstaged: boolean
  ) => Promise<{ filesChanged: number; insertions: number; deletions: number }>
  gitRefExists: (repoRoot: string, ref: string) => Promise<boolean>
  gitBranches: (directory: string) => Promise<GitBranchState>
  renderUntrackedDiff: (repoRoot: string, relativePath: string) => Promise<string>
  resolveCommandPath: (command: string, cwd: string) => Promise<string | undefined>
  buildManualPrUrl: (
    repoRoot: string,
    branch: string,
    baseBranch?: string
  ) => Promise<string | undefined>
  toCommitMessageArgs: (message: string) => string[]
  gitGenerateCommitMessage: (
    directory: string,
    includeUnstaged: boolean,
    guidancePrompt: string,
    options?: { requireGeneratedMessage?: boolean }
  ) => Promise<string>
  pushBranch: (repoRoot: string, branch: string) => Promise<void>
}

export async function gitDiffWorkflow(
  directory: string,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'runCommandWithOutput' | 'renderUntrackedDiff'>
) {
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    return 'Not a git repository.'
  }
  const unstaged = await deps
    .runCommandWithOutput('git', ['-C', repoRoot, '--no-pager', 'diff', '--', '.'], cwd)
    .catch(error => `Failed to load unstaged diff: ${sanitizeError(error)}`)
  const staged = await deps
    .runCommandWithOutput('git', ['-C', repoRoot, '--no-pager', 'diff', '--staged', '--', '.'], cwd)
    .catch(error => `Failed to load staged diff: ${sanitizeError(error)}`)
  const untracked = await deps
    .runCommandWithOutput(
      'git',
      ['-C', repoRoot, 'ls-files', '--others', '--exclude-standard'],
      cwd
    )
    .catch(error => `Failed to load untracked files: ${sanitizeError(error)}`)

  const sections: string[] = []
  if (unstaged.trim().length > 0) {
    sections.push('## Unstaged\n', unstaged.trimEnd())
  }
  if (staged.trim().length > 0) {
    sections.push('## Staged\n', staged.trimEnd())
  }
  if (untracked.trim().length > 0) {
    const files = untracked
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
    if (files.length > 0) {
      const rendered = await Promise.all(
        files.map(filePath => deps.renderUntrackedDiff(repoRoot, filePath))
      )
      const output = rendered.filter(chunk => chunk.trim().length > 0).join('\n\n')
      if (output.trim().length > 0) {
        sections.push('## Untracked\n', output)
      }
    }
  }
  if (sections.length === 0) {
    return 'No local changes.'
  }
  return sections.join('\n\n')
}

export async function gitLogWorkflow(
  directory: string,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'runCommandWithOutput'>
) {
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    return 'Not a git repository.'
  }
  const output = await deps
    .runCommandWithOutput(
      'git',
      ['-C', repoRoot, '--no-pager', 'log', '--oneline', '--decorate', '-n', '40'],
      cwd
    )
    .catch(error => `Unable to load git log: ${sanitizeError(error)}`)
  return output.trim().length > 0 ? output.trimEnd() : 'No commit history found.'
}

export async function gitIssuesWorkflow(
  directory: string,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'runCommandWithOutput'>
) {
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    return 'Not a git repository.'
  }
  const output = await deps
    .runCommandWithOutput('gh', ['issue', 'list', '--limit', '30'], repoRoot)
    .catch(error => {
      const message = sanitizeError(error)
      if (isMissingGhCliError(error)) {
        return 'GitHub CLI is not available. Install `gh` and run `gh auth login`.'
      }
      return `Unable to load issues: ${message}`
    })
  return output.trim().length > 0 ? output.trimEnd() : 'No open issues.'
}

export async function gitPrsWorkflow(
  directory: string,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'runCommandWithOutput'>
) {
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    return 'Not a git repository.'
  }
  const output = await deps
    .runCommandWithOutput('gh', ['pr', 'list', '--limit', '30'], repoRoot)
    .catch(error => {
      const message = sanitizeError(error)
      if (isMissingGhCliError(error)) {
        return 'GitHub CLI is not available. Install `gh` and run `gh auth login`.'
      }
      return `Unable to load pull requests: ${message}`
    })
  return output.trim().length > 0 ? output.trimEnd() : 'No open pull requests.'
}

export async function gitCommitSummaryWorkflow(
  directory: string,
  includeUnstaged: boolean,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'currentBranch' | 'collectGitStats'>
): Promise<GitCommitSummary> {
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    throw new Error('Not a git repository.')
  }
  const branch = await deps.currentBranch(repoRoot)
  const stats = await deps.collectGitStats(repoRoot, includeUnstaged)
  return {
    repoRoot,
    branch,
    filesChanged: stats.filesChanged,
    insertions: stats.insertions,
    deletions: stats.deletions,
  }
}

export async function gitGenerateCommitMessageWorkflow(
  directory: string,
  includeUnstaged: boolean,
  guidancePrompt: string,
  options: { requireGeneratedMessage?: boolean } = {},
  deps: Pick<
    BasicDeps,
    'resolveGitRepoRoot' | 'currentBranch' | 'collectGitStats' | 'runCommandWithOutput'
  > & {
    generateCommitMessageWithAgent: (
      directory: string,
      prompt: string
    ) => Promise<string | undefined>
    fallbackCommitMessage: (stats: {
      filesChanged: number
      insertions: number
      deletions: number
    }) => string
  }
): Promise<string> {
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    throw new Error('Not a git repository.')
  }
  const branch = await deps.currentBranch(repoRoot)
  const stats = await deps.collectGitStats(repoRoot, includeUnstaged)
  const status = await deps
    .runCommandWithOutput('git', ['-C', repoRoot, 'status', '--short'], repoRoot)
    .catch(() => '')
  const diffArgs = includeUnstaged
    ? ['-C', repoRoot, '--no-pager', 'diff', '--compact-summary', 'HEAD', '--', '.']
    : ['-C', repoRoot, '--no-pager', 'diff', '--compact-summary', '--cached', '--', '.']
  const diff = await deps.runCommandWithOutput('git', diffArgs, repoRoot).catch(() => '')
  const payload = [
    'Generate a commit message for this repository update.',
    '',
    'Guidance:',
    guidancePrompt.trim().length > 0 ? guidancePrompt.trim() : DEFAULT_COMMIT_GUIDANCE,
    '',
    `Branch: ${branch}`,
    `Files changed: ${stats.filesChanged}`,
    `Insertions: ${stats.insertions}`,
    `Deletions: ${stats.deletions}`,
    '',
    'git status --short:',
    status.trim().length > 0 ? status.slice(0, 3000) : '(no output)',
    '',
    'git diff summary:',
    diff.trim().length > 0 ? diff.slice(0, 14_000) : '(no output)',
    '',
    'Return only the commit message text, with no markdown fences.',
  ].join('\n')

  const generated = await deps
    .generateCommitMessageWithAgent(directory, payload)
    .catch(() => undefined)
  if (generated && generated.trim().length > 0) {
    return generated.trim()
  }

  if (options.requireGeneratedMessage) {
    throw new Error(
      'Unable to auto-generate commit message. Enter a commit message manually and try again.'
    )
  }

  return deps.fallbackCommitMessage(stats)
}


export async function gitBranchesWorkflow(
  directory: string,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'runCommandWithOutput' | 'currentBranch'>
): Promise<GitBranchState> {
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    throw new Error('Not a git repository.')
  }

  const current = await deps.currentBranch(repoRoot)
  const localOutput = await deps
    .runCommandWithOutput(
      'git',
      ['-C', repoRoot, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'],
      repoRoot
    )
    .catch(() => '')
  const remoteOutput = await deps
    .runCommandWithOutput(
      'git',
      ['-C', repoRoot, 'for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'],
      repoRoot
    )
    .catch(() => '')
  const localBranches = localOutput
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .sort((left, right) => left.localeCompare(right))
  const remoteBranches = remoteOutput
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => line !== 'origin')
    .filter(line => !line.endsWith('/HEAD'))
    .map(line => line.replace(/^origin\//, ''))
  const branches = [...new Set([...localBranches, ...remoteBranches])].sort((left, right) =>
    left.localeCompare(right)
  )
  if (!branches.includes(current)) {
    branches.unshift(current)
  }

  return {
    repoRoot,
    current,
    branches,
  }
}

export async function gitCheckoutBranchWorkflow(
  directory: string,
  branch: string,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'runCommand' | 'gitRefExists' | 'gitBranches'>
): Promise<GitBranchState> {
  const nextBranch = branch.trim()
  if (!nextBranch) {
    throw new Error('Branch name is required.')
  }

  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    throw new Error('Not a git repository.')
  }

  await deps
    .runCommand('git', ['-C', repoRoot, 'check-ref-format', '--branch', nextBranch], repoRoot)
    .catch(() => {
      throw new Error('Invalid branch name.')
    })

  const hasLocal = await deps.gitRefExists(repoRoot, `refs/heads/${nextBranch}`)
  if (hasLocal) {
    await deps.runCommand('git', ['-C', repoRoot, 'checkout', nextBranch], repoRoot)
  } else {
    const hasRemote = await deps.gitRefExists(repoRoot, `refs/remotes/origin/${nextBranch}`)
    if (hasRemote) {
      try {
        await deps.runCommand(
          'git',
          ['-C', repoRoot, 'checkout', '-b', nextBranch, '--track', `origin/${nextBranch}`],
          repoRoot
        )
      } catch (error) {
        const message = sanitizeError(error).toLowerCase()
        if (!message.includes('already exists')) {
          throw error
        }
        await deps.runCommand('git', ['-C', repoRoot, 'checkout', nextBranch], repoRoot)
      }
    } else {
      try {
        await deps.runCommand('git', ['-C', repoRoot, 'checkout', '-b', nextBranch], repoRoot)
      } catch (error) {
        const message = sanitizeError(error).toLowerCase()
        if (!message.includes('already exists')) {
          throw error
        }
        await deps.runCommand('git', ['-C', repoRoot, 'checkout', nextBranch], repoRoot)
      }
    }
  }

  return deps.gitBranches(repoRoot)
}

export async function gitStageAllWorkflow(
  directory: string,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'runCommand'>
): Promise<boolean> {
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    throw new Error('Not a git repository.')
  }
  await deps.runCommand('git', ['-C', repoRoot, 'add', '-A', '--', '.'], repoRoot)
  return true
}

export async function gitRestoreAllUnstagedWorkflow(
  directory: string,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'runCommand'>
): Promise<boolean> {
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    throw new Error('Not a git repository.')
  }
  await deps.runCommand('git', ['-C', repoRoot, 'restore', '--worktree', '--', '.'], repoRoot)
  return true
}

export async function gitStagePathWorkflow(
  directory: string,
  filePath: string,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'runCommand'>
): Promise<boolean> {
  const targetPath = filePath.trim()
  if (!targetPath) {
    throw new Error('File path is required.')
  }
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    throw new Error('Not a git repository.')
  }
  await deps.runCommand('git', ['-C', repoRoot, 'add', '--', targetPath], repoRoot)
  return true
}

export async function gitRestorePathWorkflow(
  directory: string,
  filePath: string,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'runCommand'>
): Promise<boolean> {
  const targetPath = filePath.trim()
  if (!targetPath) {
    throw new Error('File path is required.')
  }
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    throw new Error('Not a git repository.')
  }
  await deps.runCommand(
    'git',
    ['-C', repoRoot, 'restore', '--worktree', '--', targetPath],
    repoRoot
  )
  return true
}

export async function gitUnstagePathWorkflow(
  directory: string,
  filePath: string,
  deps: Pick<BasicDeps, 'resolveGitRepoRoot' | 'runCommand'>
): Promise<boolean> {
  const targetPath = filePath.trim()
  if (!targetPath) {
    throw new Error('File path is required.')
  }
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    throw new Error('Not a git repository.')
  }
  await deps.runCommand('git', ['-C', repoRoot, 'restore', '--staged', '--', targetPath], repoRoot)
  return true
}
