import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { OpencodeService } from './opencode-service'

vi.mock('electron', () => ({
  app: {
    getName: () => 'Orxa Code Test',
    getPath: () => '/tmp/orxa-opencode-service-test',
  },
}))

it('renders nested git repositories via their inner diff instead of as +0/-0 directories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'orxa-opencode-nested-'))
  const nestedDir = path.join(root, 'nested-app')
  await mkdir(path.join(nestedDir, '.git'), { recursive: true })
  await writeFile(path.join(nestedDir, 'package.json'), '{"name":"nested-app"}\n', 'utf8')

  const service = Object.create(OpencodeService.prototype) as unknown as {
    renderUntrackedDiff: (repoRoot: string, relativePath: string) => Promise<string>
    gitDiff: (directory: string) => Promise<string>
  }
  service.gitDiff = vi.fn(async (directory: string) => {
    expect(directory).toBe(nestedDir)
    return [
      '## Unstaged',
      '',
      'diff --git a/package.json b/package.json',
      '--- a/package.json',
      '+++ b/package.json',
      '@@ -1 +1,2 @@',
      '-{"name":"nested-app"}',
      '+{"name":"nested-app","private":true}',
    ].join('\n')
  })

  try {
    const rendered = await service.renderUntrackedDiff(root, 'nested-app/')
    expect(rendered).toContain('diff --git a/package.json b/package.json')
    expect(rendered).not.toContain('Binary files /dev/null and b/nested-app/ differ')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it('includes untracked file line counts in commit summary', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    gitCommitSummary: (
      directory: string,
      includeUnstaged: boolean
    ) => Promise<{
      filesChanged: number
      insertions: number
      deletions: number
    }>
    resolveGitRepoRoot: ReturnType<typeof vi.fn>
    currentBranch: ReturnType<typeof vi.fn>
    gitDiff: ReturnType<typeof vi.fn>
    runCommandWithOutput: ReturnType<typeof vi.fn>
  }

  service.resolveGitRepoRoot = vi.fn(async () => '/repo')
  service.currentBranch = vi.fn(async () => 'feature/new-file')
  service.gitDiff = vi.fn(async () =>
    [
      '## Untracked',
      '',
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,3 @@',
      '+const a = 1;',
      '+const b = 2;',
      '+const c = 3;',
    ].join('\n')
  )
  service.runCommandWithOutput = vi.fn(async () => '')

  const summary = await service.gitCommitSummary('/repo', true)

  expect(summary.filesChanged).toBe(1)
  expect(summary.insertions).toBe(3)
  expect(summary.deletions).toBe(0)
})

it('dedupes concurrent git status requests for the same workspace', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    gitStatus: (directory: string) => Promise<string>
    gitStatusInFlight: Map<string, Promise<string>>
    resolveGitRepoRoot: ReturnType<typeof vi.fn>
    runCommandWithOutput: ReturnType<typeof vi.fn>
  }

  service.gitStatusInFlight = new Map()
  service.resolveGitRepoRoot = vi.fn(async () => '/repo')
  service.runCommandWithOutput = vi.fn(async () => {
    await new Promise(resolve => setTimeout(resolve, 5))
    return ' M src/App.tsx\n'
  })

  const [first, second] = await Promise.all([service.gitStatus('/repo'), service.gitStatus('/repo')])

  expect(first).toBe(' M src/App.tsx')
  expect(second).toBe(' M src/App.tsx')
  expect(service.runCommandWithOutput).toHaveBeenCalledTimes(1)
})

it('passes requested base branch to gh when creating pull requests', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    gitCommit: (
      directory: string,
      request: {
        includeUnstaged: boolean
        message?: string
        guidancePrompt?: string
        baseBranch?: string
        nextStep: 'commit' | 'commit_and_push' | 'commit_and_create_pr'
      }
    ) => Promise<{ prUrl?: string }>
    resolveGitRepoRoot: ReturnType<typeof vi.fn>
    currentBranch: ReturnType<typeof vi.fn>
    resolveCommandPath: ReturnType<typeof vi.fn>
    runCommand: ReturnType<typeof vi.fn>
    runCommandWithOutput: ReturnType<typeof vi.fn>
  }

  service.resolveGitRepoRoot = vi.fn(async () => '/repo')
  service.currentBranch = vi.fn(async () => 'feature/commit-flow')
  service.resolveCommandPath = vi.fn(async () => 'gh')
  service.runCommand = vi.fn(async () => undefined)
  service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
    const full = args.join(' ')
    if (full.includes('diff --cached --name-only')) return 'src/app.ts\n'
    if (full.includes('rev-parse HEAD')) return 'abc1234\n'
    if (full.includes('pr create')) return 'https://github.com/anomalyco/opencode/pull/42\n'
    return ''
  })

  const result = await service.gitCommit('/repo', {
    includeUnstaged: false,
    message: 'feat: improve commit modal',
    nextStep: 'commit_and_create_pr',
    baseBranch: 'main',
  })

  expect(result.prUrl).toBe('https://github.com/anomalyco/opencode/pull/42')
  expect(service.runCommandWithOutput).toHaveBeenCalledWith(
    'gh',
    ['pr', 'create', '--fill', '--head', 'feature/commit-flow', '--base', 'main'],
    '/repo'
  )
})

it('omits bare origin namespace entries from branch list', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    gitBranches: (directory: string) => Promise<{
      current: string
      branches: string[]
    }>
    resolveGitRepoRoot: ReturnType<typeof vi.fn>
    currentBranch: ReturnType<typeof vi.fn>
    runCommandWithOutput: ReturnType<typeof vi.fn>
  }

  service.resolveGitRepoRoot = vi.fn(async () => '/repo')
  service.currentBranch = vi.fn(async () => 'feat/driving-4-us')
  service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
    const full = args.join(' ')
    if (full.includes('refs/heads')) return ['feat/driving-4-us', 'main'].join('\n')
    if (full.includes('refs/remotes/origin')) {
      return ['origin', 'origin/HEAD', 'origin/main', 'origin/feat/first-response-nextjs'].join(
        '\n'
      )
    }
    return ''
  })

  const result = await service.gitBranches('/repo')
  expect(result.current).toBe('feat/driving-4-us')
  expect(result.branches).toEqual(['feat/driving-4-us', 'feat/first-response-nextjs', 'main'])
  expect(result.branches).not.toContain('origin')
})

it('checks out an existing local branch without trying to create it', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    gitCheckoutBranch: (
      directory: string,
      branch: string
    ) => Promise<{
      current: string
      branches: string[]
    }>
    resolveGitRepoRoot: ReturnType<typeof vi.fn>
    runCommand: ReturnType<typeof vi.fn>
    gitBranches: ReturnType<typeof vi.fn>
  }

  service.resolveGitRepoRoot = vi.fn(async () => '/repo')
  service.runCommand = vi.fn(async (_command: string, args: string[]) => {
    const full = args.join(' ')
    if (full.includes('show-ref --verify --quiet refs/heads/staging')) return undefined
    if (full.includes('checkout staging')) return undefined
    if (full.includes('checkout -b staging')) {
      throw new Error('should not create branch when local branch exists')
    }
    return undefined
  })
  service.gitBranches = vi.fn(async () => ({
    current: 'staging',
    branches: ['main', 'staging'],
  }))

  const result = await service.gitCheckoutBranch('/repo', 'staging')
  expect(result.current).toBe('staging')
  expect(service.runCommand).toHaveBeenCalledWith('git', ['-C', '/repo', 'checkout', 'staging'], '/repo')
})

it('falls back to checkout when branch creation reports that the branch already exists', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    gitCheckoutBranch: (
      directory: string,
      branch: string
    ) => Promise<{
      current: string
      branches: string[]
    }>
    resolveGitRepoRoot: ReturnType<typeof vi.fn>
    runCommand: ReturnType<typeof vi.fn>
    gitBranches: ReturnType<typeof vi.fn>
  }

  service.resolveGitRepoRoot = vi.fn(async () => '/repo')
  service.runCommand = vi.fn(async (_command: string, args: string[]) => {
    const full = args.join(' ')
    if (full.includes('show-ref --verify --quiet refs/heads/staging')) {
      throw new Error('missing local ref')
    }
    if (full.includes('show-ref --verify --quiet refs/remotes/origin/staging')) {
      throw new Error('missing remote ref')
    }
    if (full.includes('checkout -b staging')) {
      throw new Error("fatal: a branch named 'staging' already exists")
    }
    if (full.includes('checkout staging')) return undefined
    return undefined
  })
  service.gitBranches = vi.fn(async () => ({
    current: 'staging',
    branches: ['main', 'staging'],
  }))

  const result = await service.gitCheckoutBranch('/repo', 'staging')
  expect(result.current).toBe('staging')
  expect(service.runCommand).toHaveBeenCalledWith('git', ['-C', '/repo', 'checkout', 'staging'], '/repo')
})

it('retries PR creation without --fill when git range defaults cannot be computed', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    gitCommit: (
      directory: string,
      request: {
        includeUnstaged: boolean
        message?: string
        guidancePrompt?: string
        baseBranch?: string
        nextStep: 'commit' | 'commit_and_push' | 'commit_and_create_pr'
      }
    ) => Promise<{ prUrl?: string }>
    resolveGitRepoRoot: ReturnType<typeof vi.fn>
    currentBranch: ReturnType<typeof vi.fn>
    resolveCommandPath: ReturnType<typeof vi.fn>
    runCommand: ReturnType<typeof vi.fn>
    runCommandWithOutput: ReturnType<typeof vi.fn>
  }

  service.resolveGitRepoRoot = vi.fn(async () => '/repo')
  service.currentBranch = vi.fn(async () => 'feature/commit-flow')
  service.resolveCommandPath = vi.fn(async () => 'gh')
  service.runCommand = vi.fn(async () => undefined)
  service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
    const full = args.join(' ')
    if (full.includes('diff --cached --name-only')) return 'src/app.ts\n'
    if (full.includes('rev-parse HEAD')) return 'abc1234\n'
    if (full.startsWith('pr create --fill')) {
      throw new Error(
        "gh pr create --fill --head feature/commit-flow --base main exited with code 1: could not compute title or body defaults: failed to run git: fatal: ambiguous argument 'main...feature/commit-flow': unknown revision or path not in the working tree."
      )
    }
    if (full.startsWith('pr create --title')) {
      return 'https://github.com/anomalyco/opencode/pull/43\n'
    }
    return ''
  })

  const result = await service.gitCommit('/repo', {
    includeUnstaged: false,
    message: 'feat: improve commit modal\n\n- handle fallback for PR creation',
    nextStep: 'commit_and_create_pr',
    baseBranch: 'main',
  })

  expect(result.prUrl).toBe('https://github.com/anomalyco/opencode/pull/43')
  expect(service.runCommandWithOutput).toHaveBeenCalledWith(
    'gh',
    [
      'pr',
      'create',
      '--title',
      'feat: improve commit modal',
      '--body',
      '- handle fallback for PR creation',
      '--head',
      'feature/commit-flow',
      '--base',
      'main',
    ],
    '/repo'
  )
})

it('surfaces real gh failures instead of misreporting missing CLI', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    gitCommit: (
      directory: string,
      request: {
        includeUnstaged: boolean
        message?: string
        guidancePrompt?: string
        baseBranch?: string
        nextStep: 'commit' | 'commit_and_push' | 'commit_and_create_pr'
      }
    ) => Promise<{ prUrl?: string }>
    resolveGitRepoRoot: ReturnType<typeof vi.fn>
    currentBranch: ReturnType<typeof vi.fn>
    resolveCommandPath: ReturnType<typeof vi.fn>
    runCommand: ReturnType<typeof vi.fn>
    runCommandWithOutput: ReturnType<typeof vi.fn>
  }

  service.resolveGitRepoRoot = vi.fn(async () => '/repo')
  service.currentBranch = vi.fn(async () => 'feature/commit-flow')
  service.resolveCommandPath = vi.fn(async () => 'gh')
  service.runCommand = vi.fn(async () => undefined)
  service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
    const full = args.join(' ')
    if (full.includes('diff --cached --name-only')) return 'src/app.ts\n'
    if (full.includes('rev-parse HEAD')) return 'abc1234\n'
    if (full.startsWith('pr create --fill')) {
      throw new Error(
        'gh pr create --fill --head feature/commit-flow --base main exited with code 1: pull request create failed: GraphQL: No commits between base and head'
      )
    }
    return ''
  })

  await expect(
    service.gitCommit('/repo', {
      includeUnstaged: false,
      message: 'feat: improve commit modal',
      nextStep: 'commit_and_create_pr',
      baseBranch: 'main',
    })
  ).rejects.toThrow(
    'Unable to create PR: gh pr create --fill --head feature/commit-flow --base main exited with code 1: pull request create failed: GraphQL: No commits between base and head'
  )
})

it('falls back to compare URL when gh is unavailable for create-pr flow', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    gitCommit: (
      directory: string,
      request: {
        includeUnstaged: boolean
        message?: string
        guidancePrompt?: string
        baseBranch?: string
        nextStep: 'commit' | 'commit_and_push' | 'commit_and_create_pr'
      }
    ) => Promise<{ prUrl?: string }>
    resolveGitRepoRoot: ReturnType<typeof vi.fn>
    currentBranch: ReturnType<typeof vi.fn>
    resolveCommandPath: ReturnType<typeof vi.fn>
    runCommand: ReturnType<typeof vi.fn>
    runCommandWithOutput: ReturnType<typeof vi.fn>
  }

  service.resolveGitRepoRoot = vi.fn(async () => '/repo')
  service.currentBranch = vi.fn(async () => 'feature/commit-flow')
  service.resolveCommandPath = vi.fn(async () => undefined)
  service.runCommand = vi.fn(async () => undefined)
  service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
    const full = args.join(' ')
    if (full.includes('diff --cached --name-only')) return 'src/app.ts\n'
    if (full.includes('rev-parse HEAD')) return 'abc1234\n'
    if (full.includes('remote get-url origin')) return 'git@github.com:anomalyco/opencode.git\n'
    if (full.includes('symbolic-ref --quiet --short refs/remotes/origin/HEAD')) {
      return 'origin/main\n'
    }
    return ''
  })

  const result = await service.gitCommit('/repo', {
    includeUnstaged: false,
    message: 'feat: improve commit modal',
    nextStep: 'commit_and_create_pr',
  })

  expect(result.prUrl).toBe(
    'https://github.com/anomalyco/opencode/compare/main...feature%2Fcommit-flow?expand=1'
  )
  expect(service.runCommand).toHaveBeenCalledWith(
    'git',
    expect.arrayContaining(['-C', '/repo', 'commit']),
    '/repo'
  )
  expect(service.runCommand).toHaveBeenCalledWith('git', ['-C', '/repo', 'push'], '/repo')
  const prCreateInvoked = service.runCommandWithOutput.mock.calls.some(
    (_call: unknown[]) =>
      Array.isArray(_call[1]) &&
      (_call[1] as string[])[0] === 'pr' &&
      (_call[1] as string[])[1] === 'create'
  )
  expect(prCreateInvoked).toBe(false)
})

it('throws when guided auto-generation fails instead of using generic fallback', async () => {
  const service = Object.create(OpencodeService.prototype) as {
    gitCommit: (
      directory: string,
      request: {
        includeUnstaged: boolean
        message?: string
        guidancePrompt?: string
        baseBranch?: string
        nextStep: 'commit' | 'commit_and_push' | 'commit_and_create_pr'
      }
    ) => Promise<{ prUrl?: string }>
    resolveGitRepoRoot: ReturnType<typeof vi.fn>
    currentBranch: ReturnType<typeof vi.fn>
    collectGitStats: ReturnType<typeof vi.fn>
    runCommandWithOutput: ReturnType<typeof vi.fn>
    generateCommitMessageWithAgent: ReturnType<typeof vi.fn>
    runCommand: ReturnType<typeof vi.fn>
  }

  service.resolveGitRepoRoot = vi.fn(async () => '/repo')
  service.currentBranch = vi.fn(async () => 'feature/commit-flow')
  service.collectGitStats = vi.fn(async () => ({ filesChanged: 3, insertions: 10, deletions: 2 }))
  service.runCommandWithOutput = vi.fn(async (_command: string, args: string[]) => {
    const full = args.join(' ')
    if (full.includes('diff --cached --name-only')) return 'src/app.ts\n'
    if (full.includes('status --short') || full.includes('diff --compact-summary')) {
      return 'M src/app.ts\n'
    }
    return ''
  })
  service.generateCommitMessageWithAgent = vi.fn(async () => undefined)
  service.runCommand = vi.fn(async () => undefined)

  await expect(
    service.gitCommit('/repo', {
      includeUnstaged: false,
      nextStep: 'commit',
      guidancePrompt: 'Use a strict conventional commit with grouped bullets.',
    })
  ).rejects.toThrow(
    'Unable to auto-generate commit message. Enter a commit message manually and try again.'
  )

  expect(service.runCommand).not.toHaveBeenCalledWith(
    'git',
    expect.arrayContaining(['-C', '/repo', 'commit']),
    '/repo'
  )
})
