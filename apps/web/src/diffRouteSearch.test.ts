import { describe, expect, it } from 'vitest'

import { parseDiffRouteSearch, stripDiffSearchParams } from './diffRouteSearch'

describe('parseDiffRouteSearch', () => {
  it('parses valid diff search values', () => {
    const parsed = parseDiffRouteSearch({
      diff: '1',
      diffTurnId: 'turn-1',
      diffFilePath: 'src/app.ts',
    })

    expect(parsed).toEqual({
      diff: '1',
      diffTurnId: 'turn-1',
      diffFilePath: 'src/app.ts',
    })
  })

  it('treats numeric and boolean diff toggles as open', () => {
    expect(
      parseDiffRouteSearch({
        diff: 1,
        diffTurnId: 'turn-1',
      })
    ).toEqual({
      diff: '1',
      diffTurnId: 'turn-1',
    })

    expect(
      parseDiffRouteSearch({
        diff: true,
        diffTurnId: 'turn-1',
      })
    ).toEqual({
      diff: '1',
      diffTurnId: 'turn-1',
    })
  })

  it('drops turn and file values when diff is closed', () => {
    const parsed = parseDiffRouteSearch({
      diff: '0',
      diffTurnId: 'turn-1',
      diffFilePath: 'src/app.ts',
    })

    expect(parsed).toEqual({})
  })

  it('drops file value when turn is not selected', () => {
    const parsed = parseDiffRouteSearch({
      diff: '1',
      diffFilePath: 'src/app.ts',
    })

    expect(parsed).toEqual({
      diff: '1',
    })
  })

  it('normalizes whitespace-only values', () => {
    const parsed = parseDiffRouteSearch({
      diff: '1',
      diffTurnId: '  ',
      diffFilePath: '  ',
    })

    expect(parsed).toEqual({
      diff: '1',
    })
  })
})

describe('parseDiffRouteSearch split view', () => {
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
  it('removes diff and split-pane search keys while preserving unrelated params', () => {
    expect(
      stripDiffSearchParams({
        diff: '1',
        diffTurnId: 'turn-1',
        diffFilePath: 'src/app.ts',
        split: '1',
        secondaryThreadId: 'thread-2',
        focusedPane: 'secondary',
        maximizedPane: 'primary',
        tab: 'files',
      })
    ).toEqual({
      tab: 'files',
    })
  })
})
