// Shared test fixtures, viewports, and hook helpers for ChatView browser test files.
// Extracted from ChatView.browser.tsx to keep each scenario file below max-lines.

import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest'
import { type MessageId } from '@orxa-code/contracts'
import { estimateTimelineMessageHeight } from './timelineHeight'
import {
  type ViewportSpec,
  mountChatView,
  resetTestState,
  setCustomResolver,
  setViewport,
  sharedAfterAll,
  sharedBeforeAll,
  sharedBeforeEach,
} from './ChatView.browser.ctx'

export const UUID_ROUTE_RE = /^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export const DEFAULT_VIEWPORT: ViewportSpec = {
  name: 'desktop',
  width: 960,
  height: 1_100,
  textTolerancePx: 44,
  attachmentTolerancePx: 56,
}
export const WIDE_FOOTER_VIEWPORT: ViewportSpec = {
  name: 'wide-footer',
  width: 1_400,
  height: 1_100,
  textTolerancePx: 44,
  attachmentTolerancePx: 56,
}
export const COMPACT_FOOTER_VIEWPORT: ViewportSpec = {
  name: 'compact-footer',
  width: 430,
  height: 932,
  textTolerancePx: 56,
  attachmentTolerancePx: 56,
}
export const MOBILE_VIEWPORT: ViewportSpec = {
  name: 'mobile',
  width: 430,
  height: 932,
  textTolerancePx: 56,
  attachmentTolerancePx: 56,
}
export const NARROW_VIEWPORT: ViewportSpec = {
  name: 'narrow',
  width: 320,
  height: 700,
  textTolerancePx: 84,
  attachmentTolerancePx: 56,
}
export const TEXT_VIEWPORT_MATRIX = [
  DEFAULT_VIEWPORT,
  {
    name: 'tablet',
    width: 720,
    height: 1_024,
    textTolerancePx: 44,
    attachmentTolerancePx: 56,
  } satisfies ViewportSpec,
  MOBILE_VIEWPORT,
  NARROW_VIEWPORT,
] as const satisfies readonly ViewportSpec[]
export const ATTACHMENT_VIEWPORT_MATRIX = [
  DEFAULT_VIEWPORT,
  MOBILE_VIEWPORT,
  NARROW_VIEWPORT,
] as const satisfies readonly ViewportSpec[]

export function suiteHooks(viewportOverride?: ViewportSpec): void {
  beforeAll(async () => {
    await sharedBeforeAll()
  })
  afterAll(async () => {
    await sharedAfterAll()
  })
  beforeEach(async () => {
    await sharedBeforeEach()
    await setViewport(viewportOverride ?? DEFAULT_VIEWPORT)
    resetTestState()
  })
  afterEach(() => {
    setCustomResolver(null)
    document.body.innerHTML = ''
  })
}

export async function assertRowEstimate(
  mounted: Awaited<ReturnType<typeof mountChatView>>,
  targetMessageId: MessageId,
  message: Parameters<typeof estimateTimelineMessageHeight>[0],
  tolerancePx: number
): Promise<void> {
  try {
    const { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion } =
      await mounted.measureUserRow(targetMessageId)
    expect(renderedInVirtualizedRegion).toBe(true)
    const est = estimateTimelineMessageHeight(message, { timelineWidthPx: timelineWidthMeasuredPx })
    expect(Math.abs(measuredRowHeightPx - est)).toBeLessThanOrEqual(tolerancePx)
  } finally {
    await mounted.cleanup()
  }
}
