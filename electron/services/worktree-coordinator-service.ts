import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type {
  CreateWorkspaceWorktreeInput,
  OpenDirectoryResult,
  OpenDirectoryTarget,
  WorkspaceWorktree,
} from '../../shared/ipc'

type RunGitResult = {
  ok: boolean
  stdout: string
  stderr: string
}

type WorktreeCoordinatorDeps = {
  openDirectoryIn: (
    directory: string,
    target: OpenDirectoryTarget
  ) => Promise<OpenDirectoryResult>
  removeProjectDirectory: (directory: string) => Promise<boolean>
}

function sanitizeWorktreeName(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9/_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/\/{2,}/g, '/')
      .slice(0, 64) || 'feature'
  )
}

function toWorktreeDirectoryName(branchName: string) {
  return branchName.replace(/[\\/]+/g, '__')
}

function parseWorktreeList(stdout: string, repoRoot: string) {
  const entries: WorkspaceWorktree[] = []
  const blocks = stdout
    .trim()
    .split(/\n{2,}/)
    .map(block => block.split(/\r?\n/).map(line => line.trim()).filter(Boolean))
    .filter(block => block.length > 0)

  for (const block of blocks) {
    const worktreeLine = block.find(line => line.startsWith('worktree '))
    if (!worktreeLine) {
      continue
    }
    const directory = worktreeLine.slice('worktree '.length).trim()
    const branchLine = block.find(line => line.startsWith('branch '))
    const branchRef = branchLine ? branchLine.slice('branch '.length).trim() : ''
    const branch = branchRef.startsWith('refs/heads/')
      ? branchRef.slice('refs/heads/'.length)
      : branchRef || null
    const resolvedDirectory = path.resolve(directory)
    entries.push({
      id: resolvedDirectory,
      name: path.basename(resolvedDirectory),
      directory: resolvedDirectory,
      repoRoot,
      branch,
      isMain: resolvedDirectory === repoRoot,
      locked: block.some(line => line.startsWith('locked')),
      prunable: block.some(line => line.startsWith('prunable')),
    })
  }

  return entries.sort((left, right) => {
    if (left.isMain !== right.isMain) {
      return left.isMain ? -1 : 1
    }
    return left.directory.localeCompare(right.directory)
  })
}

export class WorktreeCoordinatorService {
  private readonly openDirectoryIn: WorktreeCoordinatorDeps['openDirectoryIn']
  private readonly removeProjectDirectory: WorktreeCoordinatorDeps['removeProjectDirectory']

  constructor(deps: WorktreeCoordinatorDeps) {
    this.openDirectoryIn = deps.openDirectoryIn
    this.removeProjectDirectory = deps.removeProjectDirectory
  }

  async listWorktrees(workspaceDir: string): Promise<WorkspaceWorktree[]> {
    const repoRoot = await this.resolveRepoRoot(workspaceDir)
    const stdout = await this.getGitStdout(workspaceDir, ['worktree', 'list', '--porcelain'])
    return parseWorktreeList(stdout, repoRoot)
  }

  async createWorktree(input: CreateWorkspaceWorktreeInput): Promise<WorkspaceWorktree> {
    const repoRoot = await this.resolveRepoRoot(input.workspaceDir)
    const branchName = sanitizeWorktreeName(input.name)
    const worktreesRoot = path.join(repoRoot, '.worktrees')
    const directory = path.join(worktreesRoot, toWorktreeDirectoryName(branchName))
    mkdirSync(worktreesRoot, { recursive: true })

    const baseRef = input.baseRef?.trim() || 'HEAD'
    const createBranchResult = await this.runGit(repoRoot, [
      'worktree',
      'add',
      '-b',
      branchName,
      directory,
      baseRef,
    ])

    if (!createBranchResult.ok) {
      const attachExistingBranchResult = await this.runGit(repoRoot, [
        'worktree',
        'add',
        directory,
        branchName,
      ])
      if (!attachExistingBranchResult.ok) {
        throw new Error(
          [createBranchResult.stderr, attachExistingBranchResult.stderr]
            .filter(Boolean)
            .join('\n')
            .trim() || 'Failed to create worktree'
        )
      }
    }

    const worktrees = await this.listWorktrees(repoRoot)
    const created = worktrees.find(entry => entry.directory === path.resolve(directory))
    if (!created) {
      throw new Error('Created worktree could not be loaded')
    }
    return created
  }

  async openWorktree(directory: string, target: OpenDirectoryTarget) {
    return this.openDirectoryIn(directory, target)
  }

  async deleteWorktree(workspaceDir: string, directory: string) {
    const repoRoot = await this.resolveRepoRoot(workspaceDir)
    const resolvedDirectory = path.resolve(directory)
    if (resolvedDirectory === repoRoot) {
      throw new Error('Cannot remove the primary workspace worktree')
    }

    const result = await this.runGit(workspaceDir, ['worktree', 'remove', '--force', resolvedDirectory])
    if (!result.ok) {
      throw new Error(result.stderr || 'Failed to remove worktree')
    }

    rmSync(resolvedDirectory, { recursive: true, force: true })
    await this.removeProjectDirectory(resolvedDirectory)
    return true
  }

  private async resolveRepoRoot(workspaceDir: string) {
    const commonDir = await this.getGitStdout(workspaceDir, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ])
    if (commonDir.endsWith('/.git')) {
      return path.dirname(commonDir)
    }
    return this.getGitStdout(workspaceDir, ['rev-parse', '--show-toplevel'])
  }

  private async getGitStdout(workspaceDir: string, args: string[]) {
    const result = await this.runGit(workspaceDir, args)
    if (!result.ok) {
      throw new Error(result.stderr || `git ${args.join(' ')} failed`)
    }
    return result.stdout.trim()
  }

  private async runGit(workspaceDir: string, args: string[]) {
    const cwd = path.resolve(workspaceDir)
    const gitEnv = { ...process.env } as NodeJS.ProcessEnv
    delete gitEnv.GIT_DIR
    delete gitEnv.GIT_WORK_TREE
    delete gitEnv.GIT_COMMON_DIR
    delete gitEnv.GIT_INDEX_FILE

    return await new Promise<RunGitResult>(resolve => {
      const child = spawn('git', ['-C', cwd, ...args], {
        cwd,
        env: {
          ...gitEnv,
          GIT_DISCOVERY_ACROSS_FILESYSTEM: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      const stdout: string[] = []
      const stderr: string[] = []
      child.stdout?.on('data', chunk => stdout.push(String(chunk)))
      child.stderr?.on('data', chunk => stderr.push(String(chunk)))
      child.on('error', error => {
        resolve({
          ok: false,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
        })
      })
      child.on('close', code => {
        resolve({
          ok: code === 0,
          stdout: stdout.join(''),
          stderr: stderr.join(''),
        })
      })
    })
  }
}

export const worktreeCoordinatorTestExports = {
  parseWorktreeList,
  sanitizeWorktreeName,
  toWorktreeDirectoryName,
}
