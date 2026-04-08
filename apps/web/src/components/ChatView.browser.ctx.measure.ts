// Row measurement helpers for ChatView browser tests.
// Extracted from ChatView.browser.ctx.ts to satisfy max-lines.

import { expect, vi } from 'vitest'
import type { MessageId } from '@orxa-code/contracts'
import {
  nextFrame,
  waitForElement,
  waitForImagesToLoad,
  waitForLayout,
} from './ChatView.browser.ctx.dom'

export interface UserRowMeasurement {
  measuredRowHeightPx: number
  timelineWidthMeasuredPx: number
  renderedInVirtualizedRegion: boolean
}

async function waitForUserRow(
  host: HTMLElement,
  rowSelector: string,
  scrollContainer: HTMLElement
): Promise<HTMLElement> {
  let row: HTMLElement | null = null
  await vi.waitFor(
    async () => {
      scrollContainer.scrollTop = 0
      scrollContainer.dispatchEvent(new Event('scroll'))
      await waitForLayout()
      row = host.querySelector<HTMLElement>(rowSelector)
      expect(row, 'Unable to locate targeted user message row.').toBeTruthy()
    },
    { timeout: 8_000, interval: 16 }
  )
  if (!row) throw new Error('Unable to locate targeted user message row.')
  return row
}

async function measureRowDimensions(
  host: HTMLElement,
  rowSelector: string,
  timelineRoot: HTMLElement,
  scrollContainer: HTMLElement
): Promise<UserRowMeasurement> {
  let timelineWidthMeasuredPx = 0
  let measuredRowHeightPx = 0
  let renderedInVirtualizedRegion = false
  await vi.waitFor(
    async () => {
      scrollContainer.scrollTop = 0
      scrollContainer.dispatchEvent(new Event('scroll'))
      await nextFrame()
      const measuredRow = host.querySelector<HTMLElement>(rowSelector)
      expect(measuredRow, 'Unable to measure targeted user row height.').toBeTruthy()
      timelineWidthMeasuredPx = timelineRoot.getBoundingClientRect().width
      measuredRowHeightPx = measuredRow!.getBoundingClientRect().height
      renderedInVirtualizedRegion = measuredRow!.closest('[data-index]') instanceof HTMLElement
      expect(timelineWidthMeasuredPx, 'Unable to measure timeline width.').toBeGreaterThan(0)
      expect(measuredRowHeightPx, 'Unable to measure targeted user row height.').toBeGreaterThan(0)
    },
    { timeout: 4_000, interval: 16 }
  )
  return { measuredRowHeightPx, timelineWidthMeasuredPx, renderedInVirtualizedRegion }
}

export async function measureUserRow(options: {
  host: HTMLElement
  targetMessageId: MessageId
}): Promise<UserRowMeasurement> {
  const { host, targetMessageId } = options
  const rowSelector = `[data-message-id="${targetMessageId}"][data-message-role="user"]`
  const scrollContainer = await waitForElement(
    () => host.querySelector<HTMLDivElement>('div.overflow-y-auto.overscroll-y-contain'),
    'Unable to find ChatView message scroll container.'
  )
  const row = await waitForUserRow(host, rowSelector, scrollContainer)
  await waitForImagesToLoad(row)
  scrollContainer.scrollTop = 0
  scrollContainer.dispatchEvent(new Event('scroll'))
  await nextFrame()
  const timelineRoot =
    row.closest<HTMLElement>('[data-timeline-root="true"]') ??
    host.querySelector<HTMLElement>('[data-timeline-root="true"]')
  if (!(timelineRoot instanceof HTMLElement))
    throw new Error('Unable to locate timeline root container.')
  return measureRowDimensions(host, rowSelector, timelineRoot, scrollContainer)
}
