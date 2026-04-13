// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MobileSyncDebugDock } from './MobileSyncDebugOverlay'
import { installMobileSyncDebugBuffer, resetMobileSyncDebugBufferForTests } from '../mobileSyncDebugBuffer'

describe('MobileSyncDebugDock', () => {
  beforeEach(() => {
    installMobileSyncDebugBuffer()
    Object.defineProperty(window, 'desktopBridge', {
      configurable: true,
      value: undefined,
    })
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: true,
        media: '',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  afterEach(() => {
    resetMobileSyncDebugBufferForTests()
    vi.restoreAllMocks()
  })

  it('filters visible log entries by the selected tab', () => {
    console.info('[mobile-sync] pair auto bootstrap start', { pathname: '/pair' })
    console.info('[mobile-sync] transport', { event: 'create-connection-done' })
    console.error('[mobile-sync] reconcile error', { message: 'boom' })

    render(<MobileSyncDebugDock />)

    fireEvent.click(screen.getByRole('button', { name: /sync logs/i }))

    expect(screen.getByText(/3 shown \/ 3 captured/i)).toBeTruthy()
    expect(screen.getByText(/pair auto bootstrap start/i)).toBeTruthy()
    expect(screen.getByText(/create-connection-done/i)).toBeTruthy()
    expect(screen.getByText(/reconcile error/i)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Pair' }))

    expect(screen.getByText(/1 shown \/ 3 captured/i)).toBeTruthy()
    expect(screen.getByText(/pair auto bootstrap start/i)).toBeTruthy()
    expect(screen.queryByText(/create-connection-done/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Errors' }))

    expect(screen.getByText(/1 shown \/ 3 captured/i)).toBeTruthy()
    expect(screen.getByText(/reconcile error/i)).toBeTruthy()
    expect(screen.queryByText(/pair auto bootstrap start/i)).toBeNull()
  })
})
