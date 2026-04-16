import {
  DEFAULT_MODEL_BY_PROVIDER,
  MessageId,
  ProjectId,
  ThreadId,
  type ProviderKind,
} from '@orxa-code/contracts'
import { describe, expect, it } from 'vitest'

import type { Project, Thread } from '../../types'
import {
  buildHandoffContext,
  buildWorktreeHandoffContext,
  getHandoffTargetProviders,
  resolveHandoffTargetProviderArgument,
  resolveTargetModelSelection,
} from './ThreadHandoffMenu.helpers'

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe('thread-source'),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe('project-1'),
    title: 'Refactor project settings',
    modelSelection: {
      provider: 'codex',
      model: 'gpt-5.4',
    },
    runtimeMode: 'full-access',
    interactionMode: 'default',
    session: null,
    messages: [
      {
        id: MessageId.makeUnsafe('message-1'),
        role: 'user',
        text: 'Inspect the current provider setup before changing anything.',
        createdAt: '2026-04-09T00:00:00.000Z',
        streaming: false,
      },
      {
        id: MessageId.makeUnsafe('message-2'),
        role: 'assistant',
        text: 'I found the existing composer/provider wiring and can adapt the handoff flow cleanly.',
        createdAt: '2026-04-09T00:01:00.000Z',
        streaming: false,
      },
    ],
    proposedPlans: [],
    error: null,
    createdAt: '2026-04-09T00:00:00.000Z',
    archivedAt: null,
    updatedAt: '2026-04-09T00:01:00.000Z',
    latestTurn: null,
    branch: 'feature/provider-handoff',
    worktreePath: '/tmp/orxacode-worktree',
    parentBranch: null,
    gitRoot: null,
    handoff: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  }
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.makeUnsafe('project-1'),
    name: 'Orxa Code',
    cwd: '/tmp/orxacode',
    defaultModelSelection: null,
    scripts: [],
    ...overrides,
  }
}

describe('getHandoffTargetProviders', () => {
  it.each([
    ['codex', ['claudeAgent', 'opencode']],
    ['claudeAgent', ['codex', 'opencode']],
    ['opencode', ['codex', 'claudeAgent']],
  ] satisfies ReadonlyArray<[ProviderKind, ReadonlyArray<ProviderKind>]>)(
    'excludes the current provider for %s threads',
    (currentProvider, expected) => {
      expect(getHandoffTargetProviders(currentProvider)).toEqual(expected)
    }
  )
})

describe('buildHandoffContext', () => {
  it('includes source metadata and recent transcript lines', () => {
    const context = buildHandoffContext(makeThread())

    expect(context).toContain('Source thread: Refactor project settings')
    expect(context).toContain('Source provider: codex')
    expect(context).toContain('Source model: gpt-5.4')
    expect(context).toContain('Branch: feature/provider-handoff')
    expect(context).toContain('Worktree: /tmp/orxacode-worktree')
    expect(context).toContain('User: Inspect the current provider setup before changing anything.')
    expect(context).toContain(
      'Assistant: I found the existing composer/provider wiring and can adapt the handoff flow cleanly.'
    )
  })

  it('falls back cleanly when the source thread has no messages yet', () => {
    const context = buildHandoffContext(
      makeThread({
        messages: [],
      })
    )

    expect(context).toContain('Recent transcript:')
    expect(context).toContain('No messages yet.')
  })
})

describe('buildWorktreeHandoffContext', () => {
  it('builds imported context for worktree pull request threads', () => {
    const context = buildWorktreeHandoffContext(makeThread())

    expect(context).toContain('Continue this conversation in the pull request thread.')
    expect(context).toContain('Source provider: codex')
    expect(context).toContain('Branch: feature/provider-handoff')
  })
})

describe('resolveHandoffTargetProviderArgument', () => {
  it('maps common provider aliases and excludes the current provider', () => {
    expect(resolveHandoffTargetProviderArgument('codex', 'claude')).toBe('claudeAgent')
    expect(resolveHandoffTargetProviderArgument('codex', 'opencode')).toBe('opencode')
    expect(resolveHandoffTargetProviderArgument('codex', 'codex')).toBeNull()
  })
})

describe('resolveTargetModelSelection', () => {
  it('reuses the project default when it matches the target provider', () => {
    expect(
      resolveTargetModelSelection(
        'opencode',
        makeProject({
          defaultModelSelection: {
            provider: 'opencode',
            model: 'openai/gpt-5.4',
          },
        })
      )
    ).toEqual({
      provider: 'opencode',
      model: 'openai/gpt-5.4',
    })
  })

  it('falls back to provider defaults when the project default targets another provider', () => {
    expect(
      resolveTargetModelSelection(
        'claudeAgent',
        makeProject({
          defaultModelSelection: {
            provider: 'codex',
            model: 'gpt-5.4',
          },
        })
      )
    ).toEqual({
      provider: 'claudeAgent',
      model: DEFAULT_MODEL_BY_PROVIDER.claudeAgent,
    })
  })
})
