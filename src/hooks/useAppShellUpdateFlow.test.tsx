import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppShellUpdateFlow } from './useAppShellUpdateFlow'

describe('useAppShellUpdateFlow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.defineProperty(window, 'orxa', {
      configurable: true,
      value: {
        updates: {
          checkNow: vi.fn(async () => ({ ok: true, status: 'started' })),
          downloadAndInstall: vi.fn(async () => ({ ok: true, status: 'started' })),
        },
      },
    })
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows a temporary up-to-date message after a successful manual check with no update', () => {
    const setStatusLine = vi.fn()
    const { result } = renderHook(() => useAppShellUpdateFlow({ setStatusLine }))

    act(() => {
      result.current.handleUpdaterTelemetry({
        phase: 'check.start',
        manual: true,
        releaseChannel: 'stable',
      })
    })

    expect(result.current.isCheckingForUpdates).toBe(true)

    act(() => {
      result.current.handleUpdaterTelemetry({
        phase: 'check.success',
        manual: true,
        releaseChannel: 'stable',
        durationMs: 145,
      })
    })

    expect(result.current.isCheckingForUpdates).toBe(false)
    expect(result.current.availableUpdateVersion).toBeNull()
    expect(result.current.updateStatusMessage).toEqual({ text: 'Up to date', tone: 'neutral' })
    expect(setStatusLine).toHaveBeenLastCalledWith('Up to date (145ms)')

    act(() => {
      vi.advanceTimersByTime(2800)
    })

    expect(result.current.updateStatusMessage).toBeNull()
  })

  it('persists an update-found message when telemetry reports an available version', () => {
    const setStatusLine = vi.fn()
    const { result } = renderHook(() => useAppShellUpdateFlow({ setStatusLine }))

    act(() => {
      result.current.handleUpdaterTelemetry({
        phase: 'update.available',
        manual: false,
        releaseChannel: 'stable',
        version: '0.1.0-beta.12',
      })
    })

    expect(result.current.availableUpdateVersion).toBe('0.1.0-beta.12')
    expect(result.current.updateStatusMessage).toEqual({ text: 'Update found', tone: 'success' })
    expect(setStatusLine).toHaveBeenLastCalledWith('Update available: 0.1.0-beta.12')
  })
})
