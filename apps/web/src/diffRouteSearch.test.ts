import { describe, expect, it } from 'vitest'

import { parseDiffRouteSearch, stripDiffSearchParams } from './diffRouteSearch'

describe('parseDiffRouteSearch', () => {
  it('parses split-pane search state when split view is open', () => {
    const parsed = parseDiffRouteSearch({
      split: '1',
      secondaryThreadId: 'thread-2',
      focusedPane: 'secondary',
      maximizedPane: 'primary',
    })

    expect(parsed).toEqual({
      split: '1',
      secondaryThreadId: 'thread-2',
      focusedPane: 'secondary',
      maximizedPane: 'primary',
    })
  })

  it('drops split-pane routing state when split view is closed', () => {
    const parsed = parseDiffRouteSearch({
      split: '0',
      secondaryThreadId: 'thread-2',
      focusedPane: 'secondary',
      maximizedPane: 'primary',
    })

    expect(parsed).toEqual({})
  })
})

describe('stripDiffSearchParams', () => {
  it('sets split-pane keys to undefined while preserving unrelated params', () => {
    // Explicit undefined (not deleted keys) is required so the route's
    // retainSearchParams middleware treats them as cleared.
    expect(
      stripDiffSearchParams({
        split: '1',
        secondaryThreadId: 'thread-2',
        focusedPane: 'secondary',
        maximizedPane: 'primary',
        tab: 'files',
      })
    ).toEqual({
      split: undefined,
      secondaryThreadId: undefined,
      focusedPane: undefined,
      maximizedPane: undefined,
      tab: 'files',
    })
  })
})
