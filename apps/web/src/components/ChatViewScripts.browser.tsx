// Project scripts scenarios for ChatView browser tests.
// Extracted from ChatView.browser.tsx to satisfy max-lines.

import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import { WS_METHODS } from '@orxa-code/contracts'

import { useComposerDraftStore } from '../composerDraftStore'
import {
  NOW_ISO,
  PROJECT_ID,
  THREAD_ID,
  findButtonByText,
  mountChatView,
  waitForElement,
  wsRequests,
} from './ChatView.browser.ctx'
import {
  createDraftOnlySnapshot,
  setDraftThreadWithoutWorktree,
  withProjectScripts,
} from './ChatView.browser.helpers'
import { DEFAULT_VIEWPORT, suiteHooks } from './ChatView.browser.shared'

async function runProjectScriptLocalDraftTest(): Promise<void> {
  setDraftThreadWithoutWorktree()
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: withProjectScripts(createDraftOnlySnapshot(), [
      {
        id: 'lint',
        name: 'Lint',
        command: 'bun run lint',
        icon: 'lint',
        runOnWorktreeCreate: false,
      },
    ]),
  })
  try {
    const runButton = await waitForElement(
      () =>
        Array.from(document.querySelectorAll('button')).find(
          b => b.title === 'Run Lint'
        ) as HTMLButtonElement | null,
      'Unable to find Run Lint button.'
    )
    runButton.click()
    await vi.waitFor(
      () => {
        expect(wsRequests.find(r => r._tag === WS_METHODS.terminalOpen)).toMatchObject({
          _tag: WS_METHODS.terminalOpen,
          threadId: THREAD_ID,
          cwd: '/repo/project',
          env: { ORXA_PROJECT_ROOT: '/repo/project' },
        })
      },
      { timeout: 8_000, interval: 16 }
    )
    await vi.waitFor(
      () => {
        expect(wsRequests.find(r => r._tag === WS_METHODS.terminalWrite)).toMatchObject({
          _tag: WS_METHODS.terminalWrite,
          threadId: THREAD_ID,
          data: 'bun run lint\r',
        })
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

async function runProjectScriptWorktreeDraftTest(): Promise<void> {
  useComposerDraftStore.setState({
    draftThreadsByThreadId: {
      [THREAD_ID]: {
        projectId: PROJECT_ID,
        createdAt: NOW_ISO,
        runtimeMode: 'full-access',
        interactionMode: 'default',
        branch: 'feature/draft',
        worktreePath: '/repo/worktrees/feature-draft',
        envMode: 'worktree',
      },
    },
    projectDraftThreadIdByProjectId: { [PROJECT_ID]: THREAD_ID },
  })
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: withProjectScripts(createDraftOnlySnapshot(), [
      {
        id: 'test',
        name: 'Test',
        command: 'bun run test',
        icon: 'test',
        runOnWorktreeCreate: false,
      },
    ]),
  })
  try {
    const runButton = await waitForElement(
      () =>
        Array.from(document.querySelectorAll('button')).find(
          b => b.title === 'Run Test'
        ) as HTMLButtonElement | null,
      'Unable to find Run Test button.'
    )
    runButton.click()
    await vi.waitFor(
      () => {
        expect(wsRequests.find(r => r._tag === WS_METHODS.terminalOpen)).toMatchObject({
          _tag: WS_METHODS.terminalOpen,
          threadId: THREAD_ID,
          cwd: '/repo/worktrees/feature-draft',
          env: {
            ORXA_PROJECT_ROOT: '/repo/project',
            ORXA_WORKTREE_PATH: '/repo/worktrees/feature-draft',
          },
        })
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

const prPayload = {
  number: 1359,
  title: 'Add thread archiving and settings navigation',
  url: 'https://github.com/Reliability-Works/orxacode/pull/1359',
  baseBranch: 'main',
  headBranch: 'archive-settings-overhaul',
  state: 'open',
}

async function mountPrWorktreeSetup() {
  setDraftThreadWithoutWorktree()
  return mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: withProjectScripts(createDraftOnlySnapshot(), [
      {
        id: 'setup',
        name: 'Setup',
        command: 'bun install',
        icon: 'configure',
        runOnWorktreeCreate: true,
      },
    ]),
    resolveRpc: body => {
      if (body._tag === WS_METHODS.gitResolvePullRequest) return { pullRequest: prPayload }
      if (body._tag === WS_METHODS.gitPreparePullRequestThread)
        return {
          pullRequest: prPayload,
          branch: 'archive-settings-overhaul',
          worktreePath: '/repo/worktrees/pr-1359',
        }
      return undefined
    },
  })
}

async function triggerPrWorktreeCheckout(): Promise<void> {
  const branchButton = await waitForElement(
    () => findButtonByText('main'),
    'Unable to find branch selector button.'
  )
  branchButton.click()
  const branchInput = await waitForElement(
    () => document.querySelector<HTMLInputElement>('input[placeholder="Search branches..."]'),
    'Unable to find branch search input.'
  )
  branchInput.focus()
  await page.getByPlaceholder('Search branches...').fill('1359')
  const checkoutItem = await waitForElement(
    () =>
      Array.from(document.querySelectorAll('span')).find(
        el => el.textContent?.trim() === 'Checkout Pull Request'
      ) as HTMLSpanElement | null,
    'Unable to find checkout pull request option.'
  )
  checkoutItem.click()
  const worktreeButton = await waitForElement(
    () => findButtonByText('Worktree'),
    'Unable to find Worktree button.'
  )
  worktreeButton.click()
}

async function assertPrWorktreeSetupRan(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(wsRequests.find(r => r._tag === WS_METHODS.gitPreparePullRequestThread)).toMatchObject(
        {
          _tag: WS_METHODS.gitPreparePullRequestThread,
          cwd: '/repo/project',
          reference: '1359',
          mode: 'worktree',
        }
      )
    },
    { timeout: 8_000, interval: 16 }
  )
  await vi.waitFor(
    () => {
      expect(
        wsRequests.find(
          r => r._tag === WS_METHODS.terminalOpen && r.cwd === '/repo/worktrees/pr-1359'
        )
      ).toMatchObject({
        _tag: WS_METHODS.terminalOpen,
        threadId: expect.any(String),
        cwd: '/repo/worktrees/pr-1359',
        env: {
          ORXA_PROJECT_ROOT: '/repo/project',
          ORXA_WORKTREE_PATH: '/repo/worktrees/pr-1359',
        },
      })
    },
    { timeout: 8_000, interval: 16 }
  )
  await vi.waitFor(
    () => {
      expect(
        wsRequests.find(r => r._tag === WS_METHODS.terminalWrite && r.data === 'bun install\r')
      ).toMatchObject({
        _tag: WS_METHODS.terminalWrite,
        threadId: expect.any(String),
        data: 'bun install\r',
      })
    },
    { timeout: 8_000, interval: 16 }
  )
}

async function runPrWorktreeSetupScriptTest(): Promise<void> {
  const mounted = await mountPrWorktreeSetup()
  try {
    await triggerPrWorktreeCheckout()
    await assertPrWorktreeSetupRan()
  } finally {
    await mounted.cleanup()
  }
}

describe('ChatView project scripts', () => {
  suiteHooks()

  it(
    'runs project scripts from local draft threads at the project cwd',
    runProjectScriptLocalDraftTest
  )
  it(
    'runs project scripts from worktree draft threads at the worktree cwd',
    runProjectScriptWorktreeDraftTest
  )
  it(
    'runs setup scripts after preparing a pull request worktree thread',
    runPrWorktreeSetupScriptTest
  )
})
