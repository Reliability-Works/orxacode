// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatViewEmptyState } from './ChatViewEmptyState'

describe('ChatViewEmptyState', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  })

  it('renders without a sidebar provider', () => {
    render(<ChatViewEmptyState />)

    expect(screen.getByText('Select a thread or create a new one to get started.')).toBeDefined()
    expect(screen.queryByText('No active thread')).toBeNull()
  })
})
