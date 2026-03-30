import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readPersistedValue, removePersistedValue, writePersistedValue } from './persistence'

describe('persistence helpers', () => {
  beforeEach(() => {
    window.localStorage.clear()
    // @ts-expect-error test setup
    delete window.orxa
  })

  it('migrates a legacy localStorage value into the persistence bridge', () => {
    const get = vi.fn(() => null)
    const set = vi.fn(() => true)
    const remove = vi.fn(() => true)
    window.localStorage.setItem('persist:key', 'legacy')
    window.orxa = {
      persistence: { get, set, remove },
    } as unknown as typeof window.orxa

    expect(readPersistedValue('persist:key')).toBe('legacy')
    expect(set).toHaveBeenCalledWith('persist:key', 'legacy')
    expect(window.localStorage.getItem('persist:key')).toBeNull()
  })

  it('writes and removes through the persistence bridge when available', () => {
    const get = vi.fn(() => null)
    const set = vi.fn(() => true)
    const remove = vi.fn(() => true)
    window.orxa = {
      persistence: { get, set, remove },
    } as unknown as typeof window.orxa

    writePersistedValue('persist:key', 'next')
    removePersistedValue('persist:key')

    expect(set).toHaveBeenCalledWith('persist:key', 'next')
    expect(remove).toHaveBeenCalledWith('persist:key')
  })

  it('silently ignores non-string values instead of crashing', () => {
    const get = vi.fn(() => null)
    const set = vi.fn(() => true)
    const remove = vi.fn(() => true)
    window.orxa = {
      persistence: { get, set, remove },
    } as unknown as typeof window.orxa

    // JSON.stringify(undefined) returns undefined (not a string)
    writePersistedValue('persist:key', undefined as unknown as string)
    expect(set).not.toHaveBeenCalled()

    // null would also be non-string
    writePersistedValue('persist:key', null as unknown as string)
    expect(set).not.toHaveBeenCalled()

    // A valid string should still work
    writePersistedValue('persist:key', 'valid')
    expect(set).toHaveBeenCalledWith('persist:key', 'valid')
  })
})
