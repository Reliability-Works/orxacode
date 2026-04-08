// Sidebar + sticky + keyboard + plan-mode scenarios for ChatView browser tests.
// Extracted from ChatView.browser.tsx to satisfy max-lines.

import { type MessageId } from '@orxa-code/contracts'
import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CLIENT_SETTINGS } from '@orxa-code/contracts/settings'

import { useComposerDraftStore } from '../composerDraftStore'
import {
  THREAD_ID,
  clickNewThreadAndGetId,
  expectComposerActionsContained,
  findButtonByText,
  findComposerProviderModelPicker,
  mountChatView,
  promoteDraftThreadViaDomainEvent,
  triggerChatNewShortcutUntilPath,
  waitForButtonByText,
  waitForButtonContainingText,
  waitForComposerEditor,
  waitForElement,
  waitForLayout,
  waitForNewThreadShortcutLabel,
  waitForServerConfigToApply,
  waitForURL,
} from './ChatView.browser.ctx'
import {
  createSnapshotForTargetUser,
  createSnapshotWithLongProposedPlan,
  createSnapshotWithPendingUserInput,
  createSnapshotWithPlanFollowUpPrompt,
} from './ChatView.browser.helpers'
import {
  COMPACT_FOOTER_VIEWPORT,
  DEFAULT_VIEWPORT,
  UUID_ROUTE_RE,
  WIDE_FOOTER_VIEWPORT,
  suiteHooks,
} from './ChatView.browser.shared'

// ---------------------------------------------------------------------------
// Sidebar and thread management
// ---------------------------------------------------------------------------

async function runArchiveHoverTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-archive-hover-test' as MessageId,
      targetText: 'archive hover target',
    }),
  })
  try {
    const threadRow = page.getByTestId(`thread-row-${THREAD_ID}`)
    await expect.element(threadRow).toBeInTheDocument()
    const archiveButton = await waitForElement(
      () =>
        document.querySelector<HTMLButtonElement>(`[data-testid="thread-archive-${THREAD_ID}"]`),
      'Unable to find archive button.'
    )
    const archiveAction = archiveButton.parentElement
    expect(
      archiveAction,
      'Archive button should render inside a visibility wrapper.'
    ).not.toBeNull()
    expect(getComputedStyle(archiveAction!).opacity).toBe('0')
    await threadRow.hover()
    await vi.waitFor(
      () => {
        expect(getComputedStyle(archiveAction!).opacity).toBe('1')
      },
      { timeout: 4_000, interval: 16 }
    )
    await page.getByTestId('composer-editor').hover()
    await vi.waitFor(
      () => {
        expect(getComputedStyle(archiveAction!).opacity).toBe('0')
      },
      { timeout: 4_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

async function runArchiveConfirmTest(): Promise<void> {
  localStorage.setItem(
    'orxa:client-settings:v1',
    JSON.stringify({ ...DEFAULT_CLIENT_SETTINGS, confirmThreadArchive: true })
  )
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-archive-confirm-test' as MessageId,
      targetText: 'archive confirm target',
    }),
  })
  try {
    const threadRow = page.getByTestId(`thread-row-${THREAD_ID}`)
    await expect.element(threadRow).toBeInTheDocument()
    await threadRow.hover()
    const archiveButton = page.getByTestId(`thread-archive-${THREAD_ID}`)
    await expect.element(archiveButton).toBeInTheDocument()
    await archiveButton.click()
    const confirmButton = page.getByTestId(`thread-archive-confirm-${THREAD_ID}`)
    await expect.element(confirmButton).toBeInTheDocument()
    await expect.element(confirmButton).toBeVisible()
  } finally {
    localStorage.removeItem('orxa:client-settings:v1')
    await mounted.cleanup()
  }
}

async function runNewThreadSelectionTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-new-thread-test' as MessageId,
      targetText: 'new thread selection test',
    }),
  })
  try {
    const newThreadId = await clickNewThreadAndGetId({ mounted, routeRe: UUID_ROUTE_RE })
    await waitForComposerEditor()
    await promoteDraftThreadViaDomainEvent(newThreadId)
    await waitForURL(
      mounted.router,
      path => path === `/${newThreadId}`,
      'New thread should remain selected after server thread promotion clears the draft.'
    )
    await expect
      .element(page.getByText('Send a message to start the conversation.'))
      .toBeInTheDocument()
    await expect.element(page.getByTestId('composer-editor')).toBeInTheDocument()
  } finally {
    await mounted.cleanup()
  }
}

describe('ChatView sidebar and thread management', () => {
  suiteHooks()
  it('hides the archive action when the pointer leaves a thread row', runArchiveHoverTest)
  it('shows the confirm archive action after clicking the archive button', runArchiveConfirmTest)
  it(
    'keeps the new thread selected after clicking the new-thread button',
    runNewThreadSelectionTest
  )
})

// ---------------------------------------------------------------------------
// Sticky composer settings
// ---------------------------------------------------------------------------

function seedStickyCodexDraft(): void {
  useComposerDraftStore.setState({
    stickyModelSelectionByProvider: {
      codex: {
        provider: 'codex',
        model: 'gpt-5.3-codex',
        options: { reasoningEffort: 'medium', fastMode: true },
      },
    },
    stickyActiveProvider: 'codex',
  })
}

async function runStickyCodexTest(): Promise<void> {
  seedStickyCodexDraft()
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-sticky-codex-traits-test' as MessageId,
      targetText: 'sticky codex traits test',
    }),
  })
  try {
    const newThreadId = await clickNewThreadAndGetId({ mounted, routeRe: UUID_ROUTE_RE })
    expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toMatchObject({
      modelSelectionByProvider: {
        codex: { provider: 'codex', model: 'gpt-5.3-codex', options: { fastMode: true } },
      },
      activeProvider: 'codex',
    })
  } finally {
    await mounted.cleanup()
  }
}

async function runStickyClaudeTest(): Promise<void> {
  useComposerDraftStore.setState({
    stickyModelSelectionByProvider: {
      claudeAgent: {
        provider: 'claudeAgent',
        model: 'claude-opus-4-6',
        options: { effort: 'max', fastMode: true },
      },
    },
    stickyActiveProvider: 'claudeAgent',
  })
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-sticky-claude-model-test' as MessageId,
      targetText: 'sticky claude model test',
    }),
  })
  try {
    const newThreadId = await clickNewThreadAndGetId({ mounted, routeRe: UUID_ROUTE_RE })
    expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toMatchObject({
      modelSelectionByProvider: {
        claudeAgent: {
          provider: 'claudeAgent',
          model: 'claude-opus-4-6',
          options: { effort: 'max', fastMode: true },
        },
      },
      activeProvider: 'claudeAgent',
    })
  } finally {
    await mounted.cleanup()
  }
}

async function runStickyDefaultsTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-default-codex-traits-test' as MessageId,
      targetText: 'default codex traits test',
    }),
  })
  try {
    const newThreadId = await clickNewThreadAndGetId({ mounted, routeRe: UUID_ROUTE_RE })
    expect(useComposerDraftStore.getState().draftsByThreadId[newThreadId]).toBeUndefined()
  } finally {
    await mounted.cleanup()
  }
}

async function runDraftPrecedenceTest(): Promise<void> {
  seedStickyCodexDraft()
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-draft-codex-traits-precedence-test' as MessageId,
      targetText: 'draft codex traits precedence test',
    }),
  })
  try {
    const newThreadButton = page.getByTestId('new-thread-button')
    await expect.element(newThreadButton).toBeInTheDocument()
    const threadId = await clickNewThreadAndGetId({ mounted, routeRe: UUID_ROUTE_RE })
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
      modelSelectionByProvider: {
        codex: { provider: 'codex', model: 'gpt-5.3-codex', options: { fastMode: true } },
      },
      activeProvider: 'codex',
    })
    useComposerDraftStore.getState().setModelSelection(threadId, {
      provider: 'codex',
      model: 'gpt-5.4',
      options: { reasoningEffort: 'low', fastMode: true },
    })
    await newThreadButton.click()
    await waitForURL(
      mounted.router,
      path => path === `/${threadId}`,
      'New-thread should reuse the existing project draft thread.'
    )
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toMatchObject({
      modelSelectionByProvider: {
        codex: {
          provider: 'codex',
          model: 'gpt-5.4',
          options: { reasoningEffort: 'low', fastMode: true },
        },
      },
      activeProvider: 'codex',
    })
  } finally {
    await mounted.cleanup()
  }
}

describe('ChatView sticky composer settings', () => {
  suiteHooks()
  it('snapshots sticky codex settings into a new draft thread', runStickyCodexTest)
  it('hydrates the provider alongside a sticky claude model', runStickyClaudeTest)
  it('falls back to defaults when no sticky composer settings exist', runStickyDefaultsTest)
  it('prefers draft state over sticky composer settings and defaults', runDraftPrecedenceTest)
})

// ---------------------------------------------------------------------------
// Keyboard shortcuts and navigation
// ---------------------------------------------------------------------------

const keybindingConfig = {
  command: 'chat.new' as const,
  shortcut: {
    key: 'o',
    metaKey: false,
    ctrlKey: false,
    shiftKey: true,
    altKey: false,
    modKey: true,
  },
  whenAst: { type: 'not' as const, node: { type: 'identifier' as const, name: 'terminalFocus' } },
}

async function runChatNewShortcutTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-chat-shortcut-test' as MessageId,
      targetText: 'chat shortcut test',
    }),
    configureFixture: f => {
      f.serverConfig = { ...f.serverConfig, keybindings: [keybindingConfig] }
    },
  })
  try {
    await waitForNewThreadShortcutLabel()
    await waitForServerConfigToApply()
    const composerEditor = await waitForComposerEditor()
    composerEditor.focus()
    await waitForLayout()
    await triggerChatNewShortcutUntilPath(
      mounted.router,
      path => UUID_ROUTE_RE.test(path),
      'Route should have changed to a new draft thread UUID from the shortcut.'
    )
  } finally {
    await mounted.cleanup()
  }
}

async function runFreshDraftAfterPromotionTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-promoted-draft-shortcut-test' as MessageId,
      targetText: 'promoted draft shortcut test',
    }),
    configureFixture: f => {
      f.serverConfig = { ...f.serverConfig, keybindings: [keybindingConfig] }
    },
  })
  try {
    await waitForNewThreadShortcutLabel()
    await waitForServerConfigToApply()
    const promotedThreadId = await clickNewThreadAndGetId({ mounted, routeRe: UUID_ROUTE_RE })
    await promoteDraftThreadViaDomainEvent(promotedThreadId)
    const freshPath = await triggerChatNewShortcutUntilPath(
      mounted.router,
      path => UUID_ROUTE_RE.test(path) && path !== `/${promotedThreadId}`,
      'Shortcut should create a fresh draft instead of reusing the promoted thread.'
    )
    expect(freshPath).not.toBe(`/${promotedThreadId}`)
  } finally {
    await mounted.cleanup()
  }
}

describe('ChatView keyboard shortcuts and navigation', () => {
  suiteHooks()
  it('creates a new thread from the global chat.new shortcut', runChatNewShortcutTest)
  it(
    'creates a fresh draft after the previous draft thread is promoted',
    runFreshDraftAfterPromotionTest
  )
})

// ---------------------------------------------------------------------------
// Plan mode
// ---------------------------------------------------------------------------

async function runLongPlanLazyTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotWithLongProposedPlan(),
  })
  try {
    await waitForElement(
      () => findButtonByText('Expand plan'),
      'Unable to find Expand plan button.'
    )
    expect(document.body.textContent).not.toContain('deep hidden detail only after expand')
    const expandButton = await waitForElement(
      () => findButtonByText('Expand plan'),
      'Unable to find Expand plan button.'
    )
    expandButton.click()
    await vi.waitFor(
      () => {
        expect(document.body.textContent).toContain('deep hidden detail only after expand')
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

async function runPendingQuestionResizeTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: WIDE_FOOTER_VIEWPORT,
    snapshot: createSnapshotWithPendingUserInput(),
  })
  try {
    const firstOption = await waitForButtonContainingText('Tight')
    firstOption.click()
    await waitForButtonByText('Previous')
    await waitForButtonByText('Submit answers')
    await mounted.setContainerSize(COMPACT_FOOTER_VIEWPORT)
    await expectComposerActionsContained()
  } finally {
    await mounted.cleanup()
  }
}

async function runPlanFollowUpResizeTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: WIDE_FOOTER_VIEWPORT,
    snapshot: createSnapshotWithPlanFollowUpPrompt(),
  })
  try {
    const footer = await waitForElement(
      () => document.querySelector<HTMLElement>('[data-chat-composer-footer="true"]'),
      'Unable to find composer footer.'
    )
    const initialModelPicker = await waitForElement(
      findComposerProviderModelPicker,
      'Unable to find provider model picker.'
    )
    const initialModelPickerOffset =
      initialModelPicker.getBoundingClientRect().left - footer.getBoundingClientRect().left
    await waitForButtonByText('Implement')
    await waitForElement(
      () =>
        document.querySelector<HTMLButtonElement>('button[aria-label="Implementation actions"]'),
      'Unable to find implementation actions trigger.'
    )
    await mounted.setContainerSize({ width: 440, height: WIDE_FOOTER_VIEWPORT.height })
    await expectComposerActionsContained()
    const implementButton = await waitForButtonByText('Implement')
    const implementActionsButton = await waitForElement(
      () =>
        document.querySelector<HTMLButtonElement>('button[aria-label="Implementation actions"]'),
      'Unable to find implementation actions trigger.'
    )
    await vi.waitFor(
      () => {
        const implementRect = implementButton.getBoundingClientRect()
        const implementActionsRect = implementActionsButton.getBoundingClientRect()
        const compactModelPicker = findComposerProviderModelPicker()
        expect(compactModelPicker).toBeTruthy()
        const compactModelPickerOffset =
          compactModelPicker!.getBoundingClientRect().left - footer.getBoundingClientRect().left
        expect(Math.abs(implementRect.right - implementActionsRect.left)).toBeLessThanOrEqual(1)
        expect(Math.abs(implementRect.top - implementActionsRect.top)).toBeLessThanOrEqual(1)
        expect(Math.abs(compactModelPickerOffset - initialModelPickerOffset)).toBeLessThanOrEqual(1)
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

describe('ChatView plan mode', () => {
  suiteHooks()
  it('keeps long proposed plans lightweight until the user expands them', runLongPlanLazyTest)
  it(
    'keeps pending-question footer actions inside the composer after a real resize',
    runPendingQuestionResizeTest
  )
  it(
    'keeps plan follow-up footer actions fused and aligned after a real resize',
    runPlanFollowUpResizeTest
  )
})
