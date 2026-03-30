import { afterEach, describe, expect, it, vi } from 'vitest'
import { compact, money, timeAgo, trimProviderPrefix } from './format'

describe('format helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('formats relative times', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-23T12:00:00.000Z'))

    expect(timeAgo(Date.now() - 5_000)).toBe('just now')
    expect(timeAgo(Date.now() - 12 * 60_000)).toBe('12m ago')
    expect(timeAgo(Date.now() - 4 * 60 * 60_000)).toBe('4h ago')
    expect(timeAgo(Date.now() - 3 * 24 * 60 * 60_000)).toBe('3d ago')
  })

  it('formats compact and currency values', () => {
    expect(compact(1250)).toMatch(/1(\.|,)3?K/i)
    expect(money(0)).toBe('$0')
    expect(money(0.2456)).toMatch(/\$0\.2456/)
    expect(money(1245.8)).toMatch(/\$1,245\.80|\$1,245.8/)
  })

  it('trims provider prefixes from model IDs', () => {
    expect(trimProviderPrefix('openai/gpt-5')).toBe('gpt-5')
    expect(trimProviderPrefix('gpt-5')).toBe('gpt-5')
  })
})
