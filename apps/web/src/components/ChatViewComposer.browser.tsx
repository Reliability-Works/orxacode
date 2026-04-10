// Composer behavior + display scenarios for ChatView browser tests.
// Extracted from ChatView.browser.tsx to satisfy max-lines.

import { ORCHESTRATION_WS_METHODS, type MessageId } from '@orxa-code/contracts'
import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'

import { useComposerDraftStore } from '../composerDraftStore'
import {
  INLINE_TERMINAL_CONTEXT_PLACEHOLDER,
  removeInlineTerminalContextPlaceholder,
} from '../lib/terminalContext'
import {
  THREAD_ID,
  mountChatView,
  waitForComposerEditor,
  waitForComposerMenuItem,
  waitForElement,
  waitForInteractionModeButton,
  waitForLayout,
  waitForSendButton,
  wsRequests,
} from './ChatView.browser.ctx'
import { createSnapshotForTargetUser, createTerminalContext } from './ChatView.browser.helpers'
import { DEFAULT_VIEWPORT, suiteHooks } from './ChatView.browser.shared'

async function runPlanModeHotkeyTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-target-hotkey' as MessageId,
      targetText: 'hotkey target',
    }),
  })
  try {
    const initialModeButton = await waitForInteractionModeButton('Chat')
    expect(initialModeButton.title).toContain('enter plan mode')
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    )
    await waitForLayout()
    expect((await waitForInteractionModeButton('Chat')).title).toContain('enter plan mode')
    const composerEditor = await waitForComposerEditor()
    composerEditor.focus()
    composerEditor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    )
    await vi.waitFor(
      async () => {
        expect((await waitForInteractionModeButton('Plan')).title).toContain(
          'return to normal chat mode'
        )
      },
      { timeout: 8_000, interval: 16 }
    )
    composerEditor.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    )
    await vi.waitFor(
      async () => {
        expect((await waitForInteractionModeButton('Chat')).title).toContain('enter plan mode')
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

async function runTerminalPillRemovalTest(): Promise<void> {
  const removedLabel = 'Terminal 1 lines 1-2'
  const addedLabel = 'Terminal 2 lines 9-10'
  useComposerDraftStore.getState().addTerminalContext(
    THREAD_ID,
    createTerminalContext({
      id: 'ctx-removed',
      terminalLabel: 'Terminal 1',
      lineStart: 1,
      lineEnd: 2,
      text: 'bun i\nno changes',
    })
  )
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-terminal-pill-backspace' as MessageId,
      targetText: 'terminal pill backspace target',
    }),
  })
  try {
    await vi.waitFor(
      () => {
        expect(document.body.textContent).toContain(removedLabel)
      },
      { timeout: 8_000, interval: 16 }
    )
    const store = useComposerDraftStore.getState()
    const currentPrompt = store.draftsByThreadId[THREAD_ID]?.prompt ?? ''
    const nextPrompt = removeInlineTerminalContextPlaceholder(currentPrompt, 0)
    store.setPrompt(THREAD_ID, nextPrompt.prompt)
    store.removeTerminalContext(THREAD_ID, 'ctx-removed')
    await vi.waitFor(
      () => {
        expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]).toBeUndefined()
        expect(document.body.textContent).not.toContain(removedLabel)
      },
      { timeout: 8_000, interval: 16 }
    )
    useComposerDraftStore.getState().addTerminalContext(
      THREAD_ID,
      createTerminalContext({
        id: 'ctx-added',
        terminalLabel: 'Terminal 2',
        lineStart: 9,
        lineEnd: 10,
        text: 'git status\nOn branch main',
      })
    )
    await vi.waitFor(
      () => {
        const draft = useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]
        expect(draft?.terminalContexts.map(c => c.id)).toEqual(['ctx-added'])
        expect(document.body.textContent).toContain(addedLabel)
        expect(document.body.textContent).not.toContain(removedLabel)
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

async function mountAndWaitForExpiredPill(input: {
  expiredLabel: string
  targetMessageId: string
  targetText: string
}) {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: input.targetMessageId as MessageId,
      targetText: input.targetText,
    }),
  })
  await vi.waitFor(
    () => {
      expect(document.body.textContent).toContain(input.expiredLabel)
    },
    { timeout: 8_000, interval: 16 }
  )
  return mounted
}

function addExpiredTerminalContextDraft(id: string): void {
  useComposerDraftStore.getState().addTerminalContext(
    THREAD_ID,
    createTerminalContext({
      id,
      terminalLabel: 'Terminal 1',
      lineStart: 4,
      lineEnd: 4,
      text: '',
    })
  )
}

async function runExpiredPillDisablesSendTest(): Promise<void> {
  const expiredLabel = 'Terminal 1 line 4'
  addExpiredTerminalContextDraft('ctx-expired-only')
  const mounted = await mountAndWaitForExpiredPill({
    expiredLabel,
    targetMessageId: 'msg-user-expired-pill-disabled',
    targetText: 'expired pill disabled target',
  })
  try {
    const sendButton = await waitForSendButton()
    expect(sendButton.disabled).toBe(true)
  } finally {
    await mounted.cleanup()
  }
}

async function runFreshThreadSendDispatchesTurnStartTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-send-dispatch-target' as MessageId,
      targetText: 'send dispatch target',
    }),
  })
  try {
    await waitForComposerEditor()
    await page.getByTestId('composer-editor').fill('ship this change')
    const sendButton = await waitForSendButton()
    expect(sendButton.disabled).toBe(false)
    sendButton.click()
    await vi.waitFor(
      () => {
        expect(
          wsRequests.find(
            r =>
              r._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              r.type === 'thread.turn.start' &&
              r.threadId === THREAD_ID
          )
        ).toMatchObject({
          _tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
          type: 'thread.turn.start',
          threadId: THREAD_ID,
        })
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

async function runQueuedMessageTrayRestoreTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-queued-tray-target' as MessageId,
      targetText: 'queued tray target',
      sessionStatus: 'running',
    }),
  })
  try {
    await waitForComposerEditor()
    await page.getByTestId('composer-editor').fill('queued follow up from tray')
    const form = await waitForElement(
      () => document.querySelector<HTMLFormElement>('[data-chat-composer-form="true"]'),
      'Unable to find composer form.'
    )
    form.requestSubmit()
    await vi.waitFor(
      () => {
        expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.prompt ?? '').toBe('')
        expect(document.querySelector('[data-testid="composer-queued-messages"]')).not.toBeNull()
        expect(document.body.textContent).toContain('queued follow up from tray')
      },
      { timeout: 8_000, interval: 16 }
    )
    page.getByText('Restore').click()
    await vi.waitFor(
      () => {
        expect(document.querySelector('[data-testid="composer-queued-messages"]')).toBeNull()
        expect(useComposerDraftStore.getState().draftsByThreadId[THREAD_ID]?.prompt).toBe(
          'queued follow up from tray'
        )
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

async function runQueuedMessageInterruptsRunningTurnTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-queued-interrupt-target' as MessageId,
      targetText: 'queued interrupt target',
      sessionStatus: 'running',
    }),
  })
  try {
    await waitForComposerEditor()
    await page.getByTestId('composer-editor').fill('interrupt and steer this next')
    const form = await waitForElement(
      () => document.querySelector<HTMLFormElement>('[data-chat-composer-form="true"]'),
      'Unable to find composer form.'
    )
    form.requestSubmit()
    await vi.waitFor(
      () => {
        expect(
          wsRequests.find(
            request =>
              request._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
              request.type === 'thread.turn.interrupt' &&
              request.threadId === THREAD_ID
          )
        ).toMatchObject({
          _tag: ORCHESTRATION_WS_METHODS.dispatchCommand,
          type: 'thread.turn.interrupt',
          threadId: THREAD_ID,
        })
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

describe('ChatView composer behavior', () => {
  suiteHooks()
  it('toggles plan mode with Shift+Tab only while the composer is focused', runPlanModeHotkeyTest)
  it(
    'keeps removed terminal context pills removed when a new one is added',
    runTerminalPillRemovalTest
  )
  it(
    'disables send when the composer only contains an expired terminal pill',
    runExpiredPillDisablesSendTest
  )
  it(
    'dispatches a turn start when sending from an idle thread',
    runFreshThreadSendDispatchesTurnStartTest
  )
  it(
    'moves queued messages into a tray above the composer and restores them on demand',
    runQueuedMessageTrayRestoreTest
  )
  it(
    'interrupts the running turn when the first queued message is added',
    runQueuedMessageInterruptsRunningTurnTest
  )
})

async function runExpiredPillWarningTest(): Promise<void> {
  const expiredLabel = 'Terminal 1 line 4'
  addExpiredTerminalContextDraft('ctx-expired-send-warning')
  useComposerDraftStore
    .getState()
    .setPrompt(THREAD_ID, `yoo${INLINE_TERMINAL_CONTEXT_PLACEHOLDER}waddup`)
  const mounted = await mountAndWaitForExpiredPill({
    expiredLabel,
    targetMessageId: 'msg-user-expired-pill-warning',
    targetText: 'expired pill warning target',
  })
  try {
    const sendButton = await waitForSendButton()
    expect(sendButton.disabled).toBe(false)
    sendButton.click()
    await vi.waitFor(
      () => {
        expect(document.body.textContent).toContain('Expired terminal context omitted from message')
        expect(document.body.textContent).not.toContain(expiredLabel)
        expect(document.body.textContent).toContain('yoowaddup')
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

async function runStopButtonCursorTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-stop-button-cursor' as MessageId,
      targetText: 'stop button cursor target',
      sessionStatus: 'running',
    }),
  })
  try {
    const stopButton = await waitForElement(
      () => document.querySelector<HTMLButtonElement>('button[aria-label="Stop generation"]'),
      'Unable to find stop generation button.'
    )
    expect(getComputedStyle(stopButton).cursor).toBe('pointer')
  } finally {
    await mounted.cleanup()
  }
}

async function runSlashCommandMenuVisibleTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createSnapshotForTargetUser({
      targetMessageId: 'msg-user-command-menu-target' as MessageId,
      targetText: 'command menu thread',
    }),
  })
  try {
    await waitForComposerEditor()
    await page.getByTestId('composer-editor').fill('/')
    const menuItem = await waitForComposerMenuItem('slash:model')
    const composerForm = await waitForElement(
      () => document.querySelector<HTMLElement>('[data-chat-composer-form="true"]'),
      'Unable to find composer form.'
    )
    await vi.waitFor(
      () => {
        const menuRect = menuItem.getBoundingClientRect()
        const composerRect = composerForm.getBoundingClientRect()
        const hitTarget = document.elementFromPoint(
          menuRect.left + menuRect.width / 2,
          menuRect.top + menuRect.height / 2
        )
        expect(menuRect.width).toBeGreaterThan(0)
        expect(menuRect.height).toBeGreaterThan(0)
        expect(menuRect.bottom).toBeLessThanOrEqual(composerRect.bottom)
        expect(hitTarget instanceof Element && menuItem.contains(hitTarget)).toBe(true)
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}

describe('ChatView composer display', () => {
  suiteHooks()
  it('warns when sending text while omitting expired terminal pills', runExpiredPillWarningTest)
  it('shows a pointer cursor for the running stop button', runStopButtonCursorTest)
  it('keeps the slash-command menu visible above the composer', runSlashCommandMenuVisibleTest)
})
