// ChatView browser tests: timeline estimator parity, empty state, editor opening.
// Additional suites live in sibling .browser.tsx files (ChatViewScripts,
// ChatViewComposer, ChatViewThreads).

import { type MessageId, WS_METHODS } from '@orxa-code/contracts'
import { page } from 'vitest/browser'
import { describe, expect, it, vi } from 'vitest'

import { estimateTimelineMessageHeight } from './timelineHeight'
import {
  measureUserRowAtViewport,
  mountChatView,
  testSingleEditorOpen,
  waitForElement,
  waitForServerConfigToApply,
  wsRequests,
} from './ChatView.browser.ctx'
import {
  createDraftOnlySnapshot,
  createSnapshotForTargetUser,
  setDraftThreadWithoutWorktree,
} from './ChatView.browser.helpers'
import {
  ATTACHMENT_VIEWPORT_MATRIX,
  DEFAULT_VIEWPORT,
  TEXT_VIEWPORT_MATRIX,
  assertRowEstimate,
  suiteHooks,
} from './ChatView.browser.shared'
import type { UserRowMeasurement, ViewportSpec } from './ChatView.browser.ctx'

// ---------------------------------------------------------------------------
// Suite: timeline estimator parity
// ---------------------------------------------------------------------------

async function runLongUserMessageEstimateTest(viewport: ViewportSpec): Promise<void> {
  const userText = 'x'.repeat(3_200)
  const targetMessageId = `msg-user-target-long-${viewport.name}` as MessageId
  const mounted = await mountChatView({
    viewport,
    snapshot: createSnapshotForTargetUser({ targetMessageId, targetText: userText }),
  })
  await assertRowEstimate(
    mounted,
    targetMessageId,
    { role: 'user', text: userText, attachments: [] },
    viewport.textTolerancePx
  )
}

async function measureResizeMatrix(
  mounted: Awaited<ReturnType<typeof mountChatView>>,
  targetMessageId: MessageId,
  userText: string
): Promise<Array<UserRowMeasurement & { viewport: ViewportSpec; estimatedHeightPx: number }>> {
  const measurements: Array<
    UserRowMeasurement & { viewport: ViewportSpec; estimatedHeightPx: number }
  > = []
  for (const viewport of TEXT_VIEWPORT_MATRIX) {
    await mounted.setViewport(viewport)
    const m = await mounted.measureUserRow(targetMessageId)
    const est = estimateTimelineMessageHeight(
      { role: 'user', text: userText, attachments: [] },
      { timelineWidthPx: m.timelineWidthMeasuredPx }
    )
    expect(m.renderedInVirtualizedRegion).toBe(true)
    expect(Math.abs(m.measuredRowHeightPx - est)).toBeLessThanOrEqual(viewport.textTolerancePx)
    measurements.push({ ...m, viewport, estimatedHeightPx: est })
  }
  return measurements
}

async function runResizeParityTest(): Promise<void> {
  const userText = 'x'.repeat(3_200)
  const targetMessageId = 'msg-user-target-resize' as MessageId
  const mounted = await mountChatView({
    viewport: TEXT_VIEWPORT_MATRIX[0],
    snapshot: createSnapshotForTargetUser({ targetMessageId, targetText: userText }),
  })
  try {
    const measurements = await measureResizeMatrix(mounted, targetMessageId, userText)
    expect(
      new Set(measurements.map(m => Math.round(m.timelineWidthMeasuredPx))).size
    ).toBeGreaterThanOrEqual(3)
    const sorted = measurements.toSorted(
      (l, r) => l.timelineWidthMeasuredPx - r.timelineWidthMeasuredPx
    )
    const narrowest = sorted[0]!
    const widest = sorted.at(-1)!
    expect(narrowest.timelineWidthMeasuredPx).toBeLessThan(widest.timelineWidthMeasuredPx)
    expect(narrowest.measuredRowHeightPx).toBeGreaterThan(widest.measuredRowHeightPx)
    expect(narrowest.estimatedHeightPx).toBeGreaterThan(widest.estimatedHeightPx)
  } finally {
    await mounted.cleanup()
  }
}

async function runDesktopMobileWrapDeltaTest(): Promise<void> {
  const userText = 'x'.repeat(2_400)
  const targetMessageId = 'msg-user-target-wrap' as MessageId
  const snapshot = createSnapshotForTargetUser({ targetMessageId, targetText: userText })
  const desktopM = await measureUserRowAtViewport({
    viewport: TEXT_VIEWPORT_MATRIX[0],
    snapshot,
    targetMessageId,
  })
  const mobileM = await measureUserRowAtViewport({
    viewport: TEXT_VIEWPORT_MATRIX[2],
    snapshot,
    targetMessageId,
  })
  const estDesktop = estimateTimelineMessageHeight(
    { role: 'user', text: userText, attachments: [] },
    { timelineWidthPx: desktopM.timelineWidthMeasuredPx }
  )
  const estMobile = estimateTimelineMessageHeight(
    { role: 'user', text: userText, attachments: [] },
    { timelineWidthPx: mobileM.timelineWidthMeasuredPx }
  )
  const measuredDeltaPx = mobileM.measuredRowHeightPx - desktopM.measuredRowHeightPx
  const estimatedDeltaPx = estMobile - estDesktop
  expect(measuredDeltaPx).toBeGreaterThan(0)
  expect(estimatedDeltaPx).toBeGreaterThan(0)
  const ratio = estimatedDeltaPx / measuredDeltaPx
  expect(ratio).toBeGreaterThan(0.65)
  expect(ratio).toBeLessThan(1.35)
}

async function runAttachmentEstimateTest(viewport: ViewportSpec): Promise<void> {
  const targetMessageId = `msg-user-target-attachments-${viewport.name}` as MessageId
  const userText = 'message with image attachments'
  const mounted = await mountChatView({
    viewport,
    snapshot: createSnapshotForTargetUser({
      targetMessageId,
      targetText: userText,
      targetAttachmentCount: 3,
    }),
  })
  await assertRowEstimate(
    mounted,
    targetMessageId,
    {
      role: 'user',
      text: userText,
      attachments: [{ id: 'attachment-1' }, { id: 'attachment-2' }, { id: 'attachment-3' }],
    },
    viewport.attachmentTolerancePx
  )
}

describe('ChatView timeline estimator parity (full app)', () => {
  suiteHooks()

  it.each(TEXT_VIEWPORT_MATRIX)(
    'keeps long user message estimate close at the $name viewport',
    runLongUserMessageEstimateTest
  )
  it(
    'tracks wrapping parity while resizing an existing ChatView across the viewport matrix',
    runResizeParityTest
  )
  it(
    'tracks additional rendered wrapping when ChatView width narrows between desktop and mobile viewports',
    runDesktopMobileWrapDeltaTest
  )
  it.each(ATTACHMENT_VIEWPORT_MATRIX)(
    'keeps user attachment estimate close at the $name viewport',
    runAttachmentEstimateTest
  )
})

// ---------------------------------------------------------------------------
// Suite: empty state and editor opening
// ---------------------------------------------------------------------------

async function runEmptyStateTest(): Promise<void> {
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createDraftOnlySnapshot(),
  })
  try {
    await expect.element(page.getByText('No threads yet')).toBeInTheDocument()
  } finally {
    await mounted.cleanup()
  }
}

describe('ChatView empty state', () => {
  suiteHooks()
  it('shows an explicit empty state for projects without threads in the sidebar', runEmptyStateTest)
})

describe('ChatView editor opening', () => {
  suiteHooks()

  it('opens the project cwd for draft threads without a worktree path', async () => {
    setDraftThreadWithoutWorktree()
    await testSingleEditorOpen({
      editor: 'vscode',
      snapshotFn: createDraftOnlySnapshot,
      viewportArg: DEFAULT_VIEWPORT,
    })
  })
  it('opens the project cwd with VS Code Insiders when it is the only available editor', async () => {
    setDraftThreadWithoutWorktree()
    await testSingleEditorOpen({
      editor: 'vscode-insiders',
      snapshotFn: createDraftOnlySnapshot,
      viewportArg: DEFAULT_VIEWPORT,
    })
  })
  it('opens the project cwd with Trae when it is the only available editor', async () => {
    setDraftThreadWithoutWorktree()
    await testSingleEditorOpen({
      editor: 'trae',
      snapshotFn: createDraftOnlySnapshot,
      viewportArg: DEFAULT_VIEWPORT,
    })
  })
  it('filters the open picker menu and opens VSCodium from the menu', runFilterVscodiumTest)
  it('falls back to the first installed editor when the stored favorite is unavailable', async () => {
    localStorage.setItem('orxa:last-editor', JSON.stringify('vscodium'))
    setDraftThreadWithoutWorktree()
    await testSingleEditorOpen({
      editor: 'vscode-insiders',
      snapshotFn: createDraftOnlySnapshot,
      viewportArg: DEFAULT_VIEWPORT,
    })
  })
})

async function runFilterVscodiumTest(): Promise<void> {
  setDraftThreadWithoutWorktree()
  const mounted = await mountChatView({
    viewport: DEFAULT_VIEWPORT,
    snapshot: createDraftOnlySnapshot(),
    configureFixture: f => {
      f.serverConfig = { ...f.serverConfig, availableEditors: ['vscode-insiders', 'vscodium'] }
    },
  })
  try {
    await waitForServerConfigToApply()
    const menuButton = await waitForElement(
      () => document.querySelector('button[aria-label="Copy options"]'),
      'Unable to find Open picker button.'
    )
    ;(menuButton as HTMLButtonElement).click()
    await waitForElement(
      () =>
        Array.from(document.querySelectorAll('[data-slot="menu-item"]')).find(item =>
          item.textContent?.includes('VS Code Insiders')
        ) ?? null,
      'Unable to find VS Code Insiders menu item.'
    )
    expect(
      Array.from(document.querySelectorAll('[data-slot="menu-item"]')).some(item =>
        item.textContent?.includes('Zed')
      )
    ).toBe(false)
    const vscodiumItem = await waitForElement(
      () =>
        Array.from(document.querySelectorAll('[data-slot="menu-item"]')).find(item =>
          item.textContent?.includes('VSCodium')
        ) ?? null,
      'Unable to find VSCodium menu item.'
    )
    ;(vscodiumItem as HTMLElement).click()
    await vi.waitFor(
      () => {
        expect(wsRequests.find(r => r._tag === WS_METHODS.shellOpenInEditor)).toMatchObject({
          _tag: WS_METHODS.shellOpenInEditor,
          cwd: '/repo/project',
          editor: 'vscodium',
        })
      },
      { timeout: 8_000, interval: 16 }
    )
  } finally {
    await mounted.cleanup()
  }
}
