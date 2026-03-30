import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import ignore from 'ignore'
import type { KanbanTask } from '../../shared/ipc'
import { OpencodeCommandHelpers } from './opencode-command-helpers'
import { sanitizeError } from './opencode-runtime-helpers'

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'task'
  )
}

const KANBAN_MANAGED_EXCLUDE_BLOCK_START = '# orxa-kanban-managed-ignored-paths:start'
const KANBAN_MANAGED_EXCLUDE_BLOCK_END = '# orxa-kanban-managed-ignored-paths:end'
const TASK_PATCH_FILE_SUFFIX = '.patch'
const SYMLINK_PATH_SEGMENT_BLACKLIST = new Set([
  '.git',
  '.DS_Store',
  'Thumbs.db',
  'Desktop.ini',
  'Icon\r',
  '.Spotlight-V100',
  '.Trashes',
])

export class TaskWorktreeService {
  private readonly commands = new OpencodeCommandHelpers()
  private readonly patchesRootPath: string
  static readonly WORKTREE_INCLUDE_NAME = '.worktreeinclude'

  constructor(options: { patchesRootPath: string }) {
    this.patchesRootPath = options.patchesRootPath
  }

  private toPlatformRelativePath(value: string) {
    return value
      .trim()
      .replaceAll('\\', '/')
      .replace(/\/+$/g, '')
      .split('/')
      .filter(segment => segment.length > 0)
      .join('/')
  }

  private taskPatchPrefix(taskId: string) {
    return `${slugify(taskId)}.`
  }

  private parseTaskPatchCommit(taskId: string, filename: string) {
    const prefix = this.taskPatchPrefix(taskId)
    if (!filename.startsWith(prefix) || !filename.endsWith(TASK_PATCH_FILE_SUFFIX)) {
      return null
    }
    const commit = filename.slice(prefix.length, -TASK_PATCH_FILE_SUFFIX.length).trim()
    return commit.length > 0 ? commit : null
  }

  private async runGitRaw(repoPath: string, args: string[], cwd = repoPath) {
    const gitEnv = { ...process.env } as NodeJS.ProcessEnv
    delete gitEnv.GIT_DIR
    delete gitEnv.GIT_WORK_TREE
    delete gitEnv.GIT_COMMON_DIR
    delete gitEnv.GIT_INDEX_FILE

    return new Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number | null }>(
      resolve => {
        const child = spawn('git', ['-C', repoPath, ...args], {
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
          resolve({ ok: false, stdout: '', stderr: sanitizeError(error), exitCode: null })
        })
        child.on('close', code => {
          resolve({
            ok: code === 0,
            stdout: stdout.join(''),
            stderr: stderr.join(''),
            exitCode: code,
          })
        })
      }
    )
  }

  private async getGitStdout(repoPath: string, args: string[], cwd = repoPath) {
    const result = await this.runGitRaw(repoPath, args, cwd)
    if (!result.ok) {
      const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      throw new Error(`git ${args.join(' ')} failed${details ? `: ${details}` : ''}`)
    }
    return result.stdout.trim()
  }

  private async resolveRepoRoot(directory: string) {
    return this.getGitStdout(directory, ['rev-parse', '--show-toplevel'], directory)
  }

  private async currentBranch(repoRoot: string) {
    const output = await this.getGitStdout(
      repoRoot,
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      repoRoot
    )
    return output || 'HEAD'
  }

  private taskPatchFiles(taskId: string) {
    if (!existsSync(this.patchesRootPath)) {
      return [] as string[]
    }
    return readdirSync(this.patchesRootPath).filter(
      (entry: string) => this.parseTaskPatchCommit(taskId, entry) !== null
    ) as string[]
  }

  private deleteTaskPatchFiles(taskId: string) {
    for (const filename of this.taskPatchFiles(taskId)) {
      rmSync(path.join(this.patchesRootPath, filename), { force: true })
    }
  }

  private findTaskPatch(taskId: string) {
    const filename = this.taskPatchFiles(taskId).sort().at(-1)
    if (!filename) {
      return null
    }
    const commit = this.parseTaskPatchCommit(taskId, filename)
    if (!commit) {
      return null
    }
    return {
      path: path.join(this.patchesRootPath, filename),
      commit,
    }
  }

  private escapeGitIgnoreLiteral(relativePath: string) {
    return this.toPlatformRelativePath(relativePath)
      .replace(/\\/g, '\\\\')
      .replace(/^([#!])/u, '\\$1')
      .replace(/([*?[])/g, '\\$1')
  }

  private stripManagedExcludeBlock(content: string) {
    const lines = content.split('\n')
    const nextLines: string[] = []
    let insideManagedBlock = false
    for (const line of lines) {
      if (line === KANBAN_MANAGED_EXCLUDE_BLOCK_START) {
        insideManagedBlock = true
        continue
      }
      if (line === KANBAN_MANAGED_EXCLUDE_BLOCK_END) {
        insideManagedBlock = false
        continue
      }
      if (!insideManagedBlock) {
        nextLines.push(line)
      }
    }
    return nextLines.join('\n').replace(/\n+$/g, '')
  }

  private getUniquePaths(relativePaths: string[]) {
    const uniquePaths = Array.from(
      new Set(relativePaths.map(value => this.toPlatformRelativePath(value)).filter(Boolean))
    )
    uniquePaths.sort((left, right) => {
      const leftDepth = left.split('/').length
      const rightDepth = right.split('/').length
      if (leftDepth !== rightDepth) {
        return leftDepth - rightDepth
      }
      return left.localeCompare(right)
    })

    const roots: string[] = []
    for (const candidate of uniquePaths) {
      if (roots.some(root => candidate === root || candidate.startsWith(`${root}/`))) {
        continue
      }
      roots.push(candidate)
    }
    return roots
  }

  private shouldSkipSymlink(relativePath: string) {
    const segments = relativePath.split('/').filter(segment => segment.length > 0)
    if (segments.length === 0) {
      return true
    }
    return segments.some(segment => SYMLINK_PATH_SEGMENT_BLACKLIST.has(segment))
  }

  private async listIgnoredPaths(repoRoot: string) {
    const output = await this.getGitStdout(
      repoRoot,
      ['ls-files', '--others', '--ignored', '--exclude-per-directory=.gitignore', '--directory'],
      repoRoot
    )
    return output
      .split(/\r?\n/)
      .map(line => this.toPlatformRelativePath(line))
      .filter(line => line.length > 0)
  }

  private async listUntrackedPaths(worktreePath: string) {
    const output = await this.getGitStdout(
      worktreePath,
      ['ls-files', '--others', '--exclude-standard', '-z'],
      worktreePath
    ).catch(() => '')
    return output
      .split('\0')
      .map(value => value.trim())
      .filter(value => value.length > 0)
  }

  private resolveIncludedIgnoredPaths(ignoredPaths: string[], patterns: string[]) {
    const normalizedPatterns = patterns
      .map(entry => entry.trim())
      .filter(entry => entry.length > 0 && !entry.startsWith('#'))
    if (normalizedPatterns.length === 0) {
      return [] as string[]
    }
    const matcher = ignore().add(normalizedPatterns)
    return this.getUniquePaths(
      ignoredPaths.filter(
        relativePath => matcher.ignores(relativePath) || matcher.ignores(`${relativePath}/`)
      )
    ).filter(relativePath => !this.shouldSkipSymlink(relativePath))
  }

  private async syncManagedIgnoredPathExcludes(worktreePath: string, relativePaths: string[]) {
    const excludePathOutput = await this.getGitStdout(
      worktreePath,
      ['rev-parse', '--git-path', 'info/exclude'],
      worktreePath
    )
    const excludePath = path.isAbsolute(excludePathOutput)
      ? excludePathOutput
      : path.join(worktreePath, excludePathOutput)

    const existingContent = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
    const preservedContent = this.stripManagedExcludeBlock(existingContent)
    const managedBlock =
      relativePaths.length === 0
        ? ''
        : [
            KANBAN_MANAGED_EXCLUDE_BLOCK_START,
            '# Keep symlinked ignored paths ignored inside Orxa Kanban worktrees.',
            ...relativePaths.map(relativePath => `/${this.escapeGitIgnoreLiteral(relativePath)}`),
            KANBAN_MANAGED_EXCLUDE_BLOCK_END,
          ].join('\n')

    const nextContent = [preservedContent, managedBlock]
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n+$/g, '')
    const normalizedNextContent = nextContent ? `${nextContent}\n` : ''
    if (normalizedNextContent === existingContent) {
      return
    }
    mkdirSync(path.dirname(excludePath), { recursive: true })
    writeFileSync(excludePath, normalizedNextContent, 'utf8')
  }

  private async syncIgnoredPathsIntoWorktree(
    repoRoot: string,
    worktreePath: string,
    patterns: string[]
  ) {
    const mirroredIgnoredPaths = this.resolveIncludedIgnoredPaths(
      await this.listIgnoredPaths(repoRoot),
      patterns
    )
    await this.syncManagedIgnoredPathExcludes(worktreePath, mirroredIgnoredPaths)

    for (const relativePath of mirroredIgnoredPaths) {
      const sourcePath = path.join(repoRoot, relativePath)
      if (!existsSync(sourcePath)) {
        continue
      }
      const targetPath = path.join(worktreePath, relativePath)
      if (existsSync(targetPath)) {
        continue
      }
      const sourceStats = lstatSync(sourcePath)
      mkdirSync(path.dirname(targetPath), { recursive: true })
      try {
        symlinkSync(sourcePath, targetPath, sourceStats.isDirectory() ? 'dir' : 'file')
      } catch (error) {
        rmSync(targetPath, { recursive: true, force: true })
        try {
          symlinkSync(sourcePath, targetPath, sourceStats.isDirectory() ? 'dir' : 'file')
        } catch (retryError) {
          throw new Error(
            `Failed to mirror ignored path "${relativePath}" into worktree: ${sanitizeError(retryError || error)}`
          )
        }
      }
    }
  }

  private async captureTaskPatch(task: KanbanTask) {
    const worktreePath = task.worktreePath?.trim()
    if (!worktreePath || !existsSync(worktreePath)) {
      this.deleteTaskPatchFiles(task.id)
      return
    }
    const headCommit = await this.getGitStdout(
      worktreePath,
      ['rev-parse', '--verify', 'HEAD'],
      worktreePath
    )
    const trackedPatch = await this.getGitStdout(
      worktreePath,
      ['diff', '--binary', 'HEAD', '--'],
      worktreePath
    ).catch(() => '')
    const patchChunks =
      trackedPatch.trim().length > 0
        ? [trackedPatch.endsWith('\n') ? trackedPatch : `${trackedPatch}\n`]
        : []

    for (const relativePath of await this.listUntrackedPaths(worktreePath)) {
      const result = await this.runGitRaw(
        worktreePath,
        ['diff', '--binary', '--no-index', '--', '/dev/null', relativePath],
        worktreePath
      )
      if (!result.ok && result.exitCode !== 1) {
        throw new Error(
          result.stderr || result.stdout || `Failed to capture patch for ${relativePath}`
        )
      }
      if (result.stdout.trim().length > 0) {
        patchChunks.push(result.stdout.endsWith('\n') ? result.stdout : `${result.stdout}\n`)
      }
    }

    this.deleteTaskPatchFiles(task.id)
    if (patchChunks.length === 0) {
      return
    }

    mkdirSync(this.patchesRootPath, { recursive: true })
    const patchPath = path.join(
      this.patchesRootPath,
      `${slugify(task.id)}.${headCommit}${TASK_PATCH_FILE_SUFFIX}`
    )
    writeFileSync(patchPath, patchChunks.join(''), 'utf8')
  }

  readWorktreeInclude(repoRoot: string) {
    const filePath = path.join(repoRoot, TaskWorktreeService.WORKTREE_INCLUDE_NAME)
    if (!existsSync(filePath)) {
      return {
        filePath,
        detected: false,
        source: 'none' as const,
        entries: [] as string[],
        updatedAt: Date.now(),
      }
    }
    const entries = readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'))
    return {
      filePath,
      detected: true,
      source: 'worktreeinclude' as const,
      entries,
      updatedAt: Date.now(),
    }
  }

  createWorktreeIncludeFromGitignore(repoRoot: string) {
    const gitignorePath = path.join(repoRoot, '.gitignore')
    const filePath = path.join(repoRoot, TaskWorktreeService.WORKTREE_INCLUDE_NAME)
    const entries = existsSync(gitignorePath)
      ? readFileSync(gitignorePath, 'utf8')
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('!'))
      : []
    writeFileSync(filePath, `${entries.join('\n')}${entries.length ? '\n' : ''}`, 'utf8')
    return {
      filePath,
      detected: true,
      source: 'generated_from_gitignore' as const,
      entries,
      updatedAt: Date.now(),
    }
  }

  async ensure(task: KanbanTask, worktreeIncludeEntries: string[] = []) {
    const repoRoot = await this.resolveRepoRoot(task.workspaceDir)
    const baseRef = task.baseRef?.trim() || (await this.currentBranch(repoRoot)) || 'HEAD'
    const branch = task.taskBranch?.trim() || `kanban/${slugify(task.title)}-${task.id.slice(0, 6)}`
    const root = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-orxa-kanban`)
    mkdirSync(root, { recursive: true })
    const worktreePath =
      task.worktreePath?.trim() || path.join(root, branch.replace(/[\\/]/g, '__'))

    if (!existsSync(worktreePath)) {
      const storedPatch = this.findTaskPatch(task.id)
      const preferredRef = storedPatch?.commit || baseRef
      try {
        const branchExists = await this.runGitRaw(
          repoRoot,
          ['rev-parse', '--verify', `${branch}^{commit}`],
          repoRoot
        )
        if (branchExists.ok) {
          if (storedPatch) {
            await this.getGitStdout(repoRoot, ['branch', '-f', branch, preferredRef], repoRoot)
          }
          await this.getGitStdout(repoRoot, ['worktree', 'add', worktreePath, branch], repoRoot)
        } else {
          await this.getGitStdout(
            repoRoot,
            ['worktree', 'add', '-b', branch, worktreePath, preferredRef],
            repoRoot
          )
        }
      } catch (error) {
        if (!storedPatch) {
          throw error
        }
        const branchExists = await this.runGitRaw(
          repoRoot,
          ['rev-parse', '--verify', `${branch}^{commit}`],
          repoRoot
        )
        if (branchExists.ok) {
          await this.getGitStdout(repoRoot, ['branch', '-f', branch, baseRef], repoRoot)
          await this.getGitStdout(repoRoot, ['worktree', 'add', worktreePath, branch], repoRoot)
        } else {
          await this.getGitStdout(
            repoRoot,
            ['worktree', 'add', '-b', branch, worktreePath, baseRef],
            repoRoot
          )
        }
      }

      if (storedPatch && existsSync(storedPatch.path)) {
        const applyResult = await this.runGitRaw(
          worktreePath,
          ['apply', '--binary', '--whitespace=nowarn', storedPatch.path],
          worktreePath
        )
        if (applyResult.ok) {
          rmSync(storedPatch.path, { force: true })
        }
      }
    }

    await this.syncIgnoredPathsIntoWorktree(repoRoot, worktreePath, worktreeIncludeEntries)
    return { repoRoot, worktreePath, branch, baseRef }
  }

  async createStandalone(workspaceDir: string, label: string, baseRef?: string) {
    const repoRoot = await this.resolveRepoRoot(workspaceDir)
    const resolvedBaseRef = baseRef?.trim() || (await this.currentBranch(repoRoot)) || 'HEAD'
    const branch = `kanban/${slugify(label)}-${randomUUID().slice(0, 6)}`
    const root = path.join(path.dirname(repoRoot), `${path.basename(repoRoot)}-orxa-kanban`)
    mkdirSync(root, { recursive: true })
    const worktreePath = path.join(root, branch.replace(/[\\/]/g, '__'))
    await this.getGitStdout(
      repoRoot,
      ['worktree', 'add', '-b', branch, worktreePath, resolvedBaseRef],
      repoRoot
    )
    const include = this.readWorktreeInclude(repoRoot)
    await this.syncIgnoredPathsIntoWorktree(repoRoot, worktreePath, include.entries)
    return { repoRoot, worktreePath, branch, baseRef: resolvedBaseRef }
  }

  async cleanup(task: KanbanTask, options?: { preservePatch?: boolean }) {
    const worktreePath = task.worktreePath?.trim()
    if (!worktreePath || !existsSync(worktreePath)) {
      if (options?.preservePatch === false) {
        this.deleteTaskPatchFiles(task.id)
      }
      return
    }
    const repoRoot = await this.resolveRepoRoot(task.workspaceDir).catch(() => task.workspaceDir)
    if (options?.preservePatch !== false) {
      await this.captureTaskPatch(task).catch(() => undefined)
    } else {
      this.deleteTaskPatchFiles(task.id)
    }
    await this.commands
      .runCommand('git', ['-C', repoRoot, 'worktree', 'remove', '--force', worktreePath], repoRoot)
      .catch(() => undefined)
    rmSync(worktreePath, { recursive: true, force: true })
  }
}
