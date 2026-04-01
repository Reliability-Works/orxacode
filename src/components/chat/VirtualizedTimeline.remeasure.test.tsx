import { createRef } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { VirtualizedTimeline, type VirtualizedTimelineRow } from './VirtualizedTimeline'

const measureMock = vi.fn()
const getVirtualItemsMock = vi.fn(() => [])
const getTotalSizeMock = vi.fn(() => 0)
const useVirtualizerMock = vi.fn((options?: unknown) => {
  void options
  return {
    getVirtualItems: getVirtualItemsMock,
    getTotalSize: getTotalSizeMock,
    measureElement: vi.fn(),
    measure: measureMock,
  }
})

vi.mock('@tanstack/react-virtual', () => ({
  measureElement: vi.fn(),
  useVirtualizer: (options: unknown) => useVirtualizerMock(options),
}))

type Row = VirtualizedTimelineRow & {
  estimate: number
  label: string
}

describe('VirtualizedTimeline', () => {
  it('remeasures virtualized rows when row estimates change during streaming', () => {
    const scrollRef = createRef<HTMLDivElement>()
    const rows: Row[] = [
      { id: 'row-1', estimate: 80, label: 'first' },
      { id: 'row-2', estimate: 80, label: 'second' },
      { id: 'row-3', estimate: 80, label: 'third' },
      { id: 'row-4', estimate: 80, label: 'fourth' },
      { id: 'row-5', estimate: 80, label: 'fifth' },
      { id: 'row-6', estimate: 80, label: 'sixth' },
      { id: 'row-7', estimate: 80, label: 'seventh' },
      { id: 'row-8', estimate: 80, label: 'eighth' },
      { id: 'row-9', estimate: 80, label: 'ninth' },
    ]

    const { rerender } = render(
      <VirtualizedTimeline
        rows={rows}
        scrollRef={scrollRef}
        estimateSize={row => row.estimate}
        renderRow={row => <div>{row.label}</div>}
      />
    )

    expect(measureMock).toHaveBeenCalledTimes(1)

    rerender(
      <VirtualizedTimeline
        rows={rows.map(row => (row.id === 'row-1' ? { ...row, estimate: 180 } : row))}
        scrollRef={scrollRef}
        estimateSize={row => row.estimate}
        renderRow={row => <div>{row.label}</div>}
      />
    )

    expect(measureMock).toHaveBeenCalledTimes(2)
  })
})
