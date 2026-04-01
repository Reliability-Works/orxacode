import path from 'node:path'
import type { GitCommitRequest, GitCommitResult } from '../../shared/ipc'
import { isGhAuthError, isMissingGhCliError, sanitizeError } from './opencode-runtime-helpers'

export const DEFAULT_COMMIT_GUIDANCE = [
  'Write a high-quality conventional commit message.',
  'Use this format:',
  '1) First line: <type>(optional-scope): concise summary in imperative mood.',
  '2) Blank line.',
  '3) Body bullets grouped by area, clearly describing what changed and why.',
  '4) Mention notable side effects, risk, and follow-up work if relevant.',
  '5) Keep it specific to the included diff and avoid generic phrasing.',
].join('\n')

type CommitWorkflowDeps = {
  resolveGitRepoRoot: (directory: string) => Promise<string | undefined>
  currentBranch: (repoRoot: string) => Promise<string>
  runCommand: (command: string, args: string[], cwd: string) => Promise<void>
  runCommandWithOutput: (command: string, args: string[], cwd: string) => Promise<string>
  resolveCommandPath: (command: string, cwd: string) => Promise<string | undefined>
  gitGenerateCommitMessage: (
    directory: string,
    includeUnstaged: boolean,
    guidancePrompt: string,
    options?: { requireGeneratedMessage?: boolean }
  ) => Promise<string>
  toCommitMessageArgs: (message: string) => string[]
  pushBranch: (repoRoot: string, branch: string) => Promise<void>
  buildManualPrUrl: (
    repoRoot: string,
    branch: string,
    baseBranch?: string
  ) => Promise<string | undefined>
}

function toNormalizedBlocks(message: string) {
  const normalized = message.replace(/\r\n/g, '\n').trim()
  return normalized
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(part => part.length > 0)
}

export function parseGitPatchStats(output: string) {
  const trimmed = output.trim()
  if (
    !trimmed ||
    trimmed === 'No local changes.' ||
    trimmed === 'Not a git repository.' ||
    trimmed.startsWith('Loading diff')
  ) {
    return { filesChanged: 0, insertions: 0, deletions: 0 }
  }

  let insertions = 0
  let deletions = 0
  const changedFiles = new Set<string>()
  const lines = output.split(/\r?\n/)

  for (const line of lines) {
    const diffHeaderMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/)
    if (diffHeaderMatch) {
      const filePath = diffHeaderMatch[2] ?? diffHeaderMatch[1]
      if (filePath) {
        changedFiles.add(filePath)
      }
      continue
    }

    const untrackedMatch = line.match(/^\?\?\s+(.+)$/)
    if (untrackedMatch) {
      const filePath = untrackedMatch[1]?.trim()
      if (filePath) {
        changedFiles.add(filePath)
        insertions += 1
      }
      continue
    }

    const inlineUntracked = [...line.matchAll(/\?\?\s+([^?]+?)(?=\s+\?\?|$)/g)]
    if (inlineUntracked.length > 0) {
      for (const match of inlineUntracked) {
        const filePath = (match[1] ?? '').trim()
        if (!filePath) {
          continue
        }
        changedFiles.add(filePath)
        insertions += 1
      }
      continue
    }

    if (line.startsWith('+++') || line.startsWith('---')) {
      continue
    }

    if (line.startsWith('+')) {
      insertions += 1
      continue
    }
    if (line.startsWith('-')) {
      deletions += 1
    }
  }

  return {
    filesChanged: changedFiles.size,
    insertions,
    deletions,
  }
}

export function fallbackCommitMessage(stats: {
  filesChanged: number
  insertions: number
  deletions: number
}) {
  const files = Math.max(stats.filesChanged, 1)
  return [
    `chore: update ${files} file${files === 1 ? '' : 's'}`,
    '',
    `- apply local working tree updates across ${files} file${files === 1 ? '' : 's'}`,
    `- add ${stats.insertions} line${stats.insertions === 1 ? '' : 's'} and remove ${stats.deletions} line${stats.deletions === 1 ? '' : 's'}`,
  ].join('\n')
}

export function toCommitMessageArgs(message: string) {
  const blocks = toNormalizedBlocks(message)
  if (blocks.length === 0) {
    return ['-m', message.replace(/\r\n/g, '\n').trim()]
  }
  const args: string[] = []
  for (const block of blocks) {
    args.push('-m', block)
  }
  return args
}

export function normalizeGitHubRemote(remoteUrl: string) {
  const trimmed = remoteUrl.trim()
  if (!trimmed) {
    return undefined
  }

  let slug: string | undefined
  const sshMatch = trimmed.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/i)
  if (sshMatch) {
    slug = sshMatch[1]
  }

  if (!slug) {
    const sshProtocolMatch = trimmed.match(/^ssh:\/\/git@github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i)
    if (sshProtocolMatch) {
      slug = sshProtocolMatch[1]
    }
  }

  if (!slug) {
    const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/i)
    if (httpsMatch) {
      slug = httpsMatch[1]
    }
  }

  if (!slug) {
    return undefined
  }

  return `https://github.com/${slug.replace(/\.git$/i, '')}`
}

async function ensureRepoRoot(
  directory: string,
  deps: Pick<CommitWorkflowDeps, 'resolveGitRepoRoot'>
) {
  const cwd = path.resolve(directory)
  const repoRoot = await deps.resolveGitRepoRoot(cwd)
  if (!repoRoot) {
    throw new Error('Not a git repository.')
  }
  return { cwd, repoRoot }
}

async function ensureStagedChanges(
  repoRoot: string,
  includeUnstaged: boolean,
  deps: Pick<CommitWorkflowDeps, 'runCommand' | 'runCommandWithOutput'>
) {
  if (includeUnstaged) {
    await deps.runCommand('git', ['-C', repoRoot, 'add', '-A'], repoRoot)
  }
  const staged = await deps
    .runCommandWithOutput('git', ['-C', repoRoot, 'diff', '--cached', '--name-only'], repoRoot)
    .catch(() => '')
  if (staged.trim().length === 0) {
    throw new Error(includeUnstaged ? 'No changes to commit.' : 'No staged changes to commit.')
  }
}

async function resolveCommitMessage(
  directory: string,
  request: GitCommitRequest,
  deps: Pick<CommitWorkflowDeps, 'gitGenerateCommitMessage'>
) {
  if (request.message && request.message.trim().length > 0) {
    return request.message.trim()
  }
  const guidancePrompt =
    request.guidancePrompt && request.guidancePrompt.trim().length > 0
      ? request.guidancePrompt.trim()
      : DEFAULT_COMMIT_GUIDANCE
  const shouldRequireGeneratedMessage =
    request.nextStep === 'commit_and_create_pr' || Boolean(request.guidancePrompt?.trim())
  const message = await deps.gitGenerateCommitMessage(
    directory,
    request.includeUnstaged,
    guidancePrompt,
    {
      requireGeneratedMessage: shouldRequireGeneratedMessage,
    }
  )
  if (!message || message.trim().length === 0) {
    throw new Error('Commit message cannot be empty.')
  }
  return message.trim()
}

async function resolveGitHubCliAvailability(
  repoRoot: string,
  deps: Pick<CommitWorkflowDeps, 'resolveCommandPath' | 'runCommandWithOutput'>
) {
  const ghCommandPath = await deps.resolveCommandPath('gh', repoRoot)
  if (!ghCommandPath) {
    return {
      ghCommandPath: undefined,
      ghUnavailableReason: 'GitHub CLI is not available. Install `gh` and run `gh auth login`.',
    }
  }

  try {
    await deps.runCommandWithOutput(ghCommandPath, ['auth', 'status'], repoRoot)
    return { ghCommandPath, ghUnavailableReason: undefined }
  } catch (error) {
    if (isMissingGhCliError(error)) {
      return {
        ghCommandPath: undefined,
        ghUnavailableReason: 'GitHub CLI is not available. Install `gh` and run `gh auth login`.',
      }
    }
    if (isGhAuthError(error)) {
      return {
        ghCommandPath: undefined,
        ghUnavailableReason: 'GitHub CLI is not authenticated. Run `gh auth login` and retry.',
      }
    }
    throw new Error(`Unable to verify GitHub CLI auth: ${sanitizeError(error)}`)
  }
}

async function createPullRequestFromCommit(
  repoRoot: string,
  branch: string,
  message: string,
  request: GitCommitRequest,
  deps: Pick<CommitWorkflowDeps, 'runCommand' | 'runCommandWithOutput' | 'buildManualPrUrl' | 'pushBranch'> & {
    ghCommandPath?: string
    ghUnavailableReason?: string
  }
) {
  if (request.nextStep === 'commit_and_push' || request.nextStep === 'commit_and_create_pr') {
    await deps.pushBranch(repoRoot, branch)
  }
  if (request.nextStep !== 'commit_and_create_pr') {
    return undefined
  }

  const baseBranch = await resolvePullRequestBaseBranch(repoRoot, branch, request.baseBranch, deps)

  if (deps.ghUnavailableReason) {
    return deps.buildManualPrUrl(repoRoot, branch, baseBranch)
  }

  const prArgs = buildPullRequestCreateArgs(branch, baseBranch)

  const ghCommandPath = deps.ghCommandPath ?? 'gh'
  try {
    const output = await deps.runCommandWithOutput(ghCommandPath, prArgs, repoRoot)
    const urlMatch = output.match(/https?:\/\/[^\s]+/i)
    return urlMatch ? urlMatch[0] : deps.buildManualPrUrl(repoRoot, branch, baseBranch)
  } catch (error) {
    const detail = sanitizeError(error)
    if (isMissingGhCliError(error) || isGhAuthError(error)) {
      return deps.buildManualPrUrl(repoRoot, branch, baseBranch)
    }

    const normalized = detail.toLowerCase()
    const canRetryWithoutFill =
      normalized.includes('could not compute title or body defaults') ||
      normalized.includes('unknown revision or path not in the working tree') ||
      normalized.includes('ambiguous argument')
    if (!canRetryWithoutFill) {
      throw new Error(`Unable to create PR: ${detail}`)
    }

    const fallbackOutput = await createFallbackPullRequestOutput(
      deps,
      ghCommandPath,
      repoRoot,
      branch,
      baseBranch,
      message
    )
    const fallbackUrlMatch = fallbackOutput.match(/https?:\/\/[^\s]+/i)
    return fallbackUrlMatch ? fallbackUrlMatch[0] : deps.buildManualPrUrl(repoRoot, branch, baseBranch)
  }
}

async function resolvePullRequestBaseBranch(
  repoRoot: string,
  branch: string,
  baseBranch: string | undefined,
  deps: Pick<CommitWorkflowDeps, 'runCommand'>
) {
  const normalizedBaseBranch = baseBranch?.trim()
  if (!normalizedBaseBranch) {
    return undefined
  }
  if (normalizedBaseBranch === branch) {
    throw new Error('Base branch must be different from the current branch.')
  }
  await deps
    .runCommand('git', ['-C', repoRoot, 'check-ref-format', '--branch', normalizedBaseBranch], repoRoot)
    .catch(() => {
      throw new Error('Invalid PR base branch name.')
    })
  return normalizedBaseBranch
}

function buildPullRequestCreateArgs(branch: string, baseBranch?: string) {
  const prArgs = ['pr', 'create', '--fill', '--head', branch]
  if (baseBranch) {
    prArgs.push('--base', baseBranch)
  }
  return prArgs
}

async function createFallbackPullRequestOutput(
  deps: Pick<CommitWorkflowDeps, 'runCommandWithOutput' | 'buildManualPrUrl'>,
  ghCommandPath: string,
  repoRoot: string,
  branch: string,
  baseBranch: string | undefined,
  message: string
) {
  const [titleLine, ...bodyLines] = message.split(/\r?\n/)
  const fallbackTitle =
    titleLine.trim().length > 0 ? titleLine.trim() : `chore: open PR from ${branch}`
  const fallbackBody = bodyLines.join('\n').trim() || `Automated PR created from ${branch}.`
  const fallbackOutput = await deps
    .runCommandWithOutput(
      ghCommandPath,
      buildPullRequestFallbackArgs(branch, fallbackTitle, fallbackBody, baseBranch),
      repoRoot
    )
    .catch(async fallbackError => {
      const fallbackDetail = sanitizeError(fallbackError)
      if (isMissingGhCliError(fallbackError) || isGhAuthError(fallbackError)) {
        const fallbackUrl = await deps.buildManualPrUrl(repoRoot, branch, baseBranch)
        if (fallbackUrl) {
          return fallbackUrl
        }
      }
      throw new Error(`Unable to create PR: ${fallbackDetail}`)
    })
  return fallbackOutput
}

function buildPullRequestFallbackArgs(
  branch: string,
  title: string,
  body: string,
  baseBranch?: string
) {
  const args = ['pr', 'create', '--title', title, '--body', body, '--head', branch]
  if (baseBranch) {
    args.push('--base', baseBranch)
  }
  return args
}

export async function gitCommitWorkflow(
  directory: string,
  request: GitCommitRequest,
  deps: CommitWorkflowDeps
): Promise<GitCommitResult> {
  const { repoRoot } = await ensureRepoRoot(directory, deps)
  const branch = await deps.currentBranch(repoRoot)
  await ensureStagedChanges(repoRoot, request.includeUnstaged, deps)
  const message = await resolveCommitMessage(directory, request, deps)
  const { ghCommandPath, ghUnavailableReason } = await resolveGitHubCliAvailability(repoRoot, deps)
  await deps.runCommand('git', ['-C', repoRoot, 'commit', ...deps.toCommitMessageArgs(message)], repoRoot)
  const commitHash = (
    await deps.runCommandWithOutput('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], repoRoot)
  ).trim()
  const prUrl = await createPullRequestFromCommit(repoRoot, branch, message, request, {
    runCommand: deps.runCommand,
    runCommandWithOutput: deps.runCommandWithOutput,
    buildManualPrUrl: deps.buildManualPrUrl,
    pushBranch: deps.pushBranch,
    ghCommandPath,
    ghUnavailableReason,
  })
  const pushed = request.nextStep === 'commit_and_push' || request.nextStep === 'commit_and_create_pr'
  return {
    repoRoot,
    branch,
    commitHash,
    message,
    pushed,
    prUrl,
  }
}
