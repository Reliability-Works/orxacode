import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { usePersistedState } from './usePersistedState'

describe('usePersistedState', () => {
  it('loads existing localStorage value and updates it', () => {
    window.localStorage.setItem('persist:key', JSON.stringify({ count: 3 }))

    const { result } = renderHook(() => usePersistedState('persist:key', { count: 0 }))

    expect(result.current[0]).toEqual({ count: 3 })

    act(() => {
      result.current[1](previous => ({ count: previous.count + 2 }))
    })

    expect(result.current[0]).toEqual({ count: 5 })
    expect(window.localStorage.getItem('persist:key')).toBe(JSON.stringify({ count: 5 }))
  })

  it('falls back to default when storage entry is invalid', () => {
    window.localStorage.setItem('persist:bad', '{not-json')

    const { result } = renderHook(() => usePersistedState('persist:bad', 9))

    expect(result.current[0]).toBe(9)
  })

  it('uses custom serializer/deserializer', () => {
    window.localStorage.setItem('persist:custom', '42')

    const { result } = renderHook(() =>
      usePersistedState('persist:custom', 0, {
        serialize: value => `${value}`,
        deserialize: value => Number(value),
      })
    )

    expect(result.current[0]).toBe(42)

    act(() => {
      result.current[1](7)
    })

    expect(window.localStorage.getItem('persist:custom')).toBe('7')
  })

  it('rehydrates when the storage key changes', () => {
    window.localStorage.setItem('persist:key:a', JSON.stringify({ count: 3 }))
    window.localStorage.setItem('persist:key:b', JSON.stringify({ count: 9 }))

    const { result, rerender } = renderHook(
      ({ storageKey }) => usePersistedState(storageKey, { count: 0 }),
      { initialProps: { storageKey: 'persist:key:a' } }
    )

    expect(result.current[0]).toEqual({ count: 3 })

    rerender({ storageKey: 'persist:key:b' })

    expect(result.current[0]).toEqual({ count: 9 })
    expect(window.localStorage.getItem('persist:key:b')).toBe(JSON.stringify({ count: 9 }))
  })

  it('does not copy the previous key state into a new key', () => {
    window.localStorage.setItem('persist:key:source', JSON.stringify({ count: 4 }))

    const { result, rerender } = renderHook(
      ({ storageKey }) => usePersistedState(storageKey, { count: 0 }),
      { initialProps: { storageKey: 'persist:key:source' } }
    )

    act(() => {
      result.current[1]({ count: 6 })
    })

    expect(window.localStorage.getItem('persist:key:source')).toBe(JSON.stringify({ count: 6 }))

    rerender({ storageKey: 'persist:key:target' })

    expect(result.current[0]).toEqual({ count: 0 })
    expect(window.localStorage.getItem('persist:key:target')).toBe(JSON.stringify({ count: 0 }))
  })

  it('persists hidden model preferences across remount', () => {
    const key = 'orxa:appPreferences:v1'
    const initial = {
      showOperationsPane: true, autoOpenTerminalOnCreate: true, confirmDangerousActions: true,
      permissionMode: 'ask-write' as const, commitGuidancePrompt: '', codeFont: 'IBM Plex Mono',
      hiddenModels: [] as string[],
    }

    const first = renderHook(() => usePersistedState(key, initial))
    act(() => {
      first.result.current[1](previous => ({
        ...previous,
        hiddenModels: [...previous.hiddenModels, 'cloudflare/@cf/meta/llama-3.1-8b-instruct'],
      }))
    })
    expect(first.result.current[0].hiddenModels).toEqual(['cloudflare/@cf/meta/llama-3.1-8b-instruct'])
    first.unmount()

    const second = renderHook(() => usePersistedState(key, initial))
    expect(second.result.current[0].hiddenModels).toEqual(['cloudflare/@cf/meta/llama-3.1-8b-instruct'])
  })

  it('falls back to default when storage getItem throws', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    const { result } = renderHook(() => usePersistedState('persist:throws:get', 42))
    expect(result.current[0]).toBe(42)

    getItemSpy.mockRestore()
  })

  it('keeps state updates when storage setItem throws', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })

    const { result } = renderHook(() => usePersistedState('persist:throws:set', { count: 1 }))
    act(() => {
      result.current[1]({ count: 2 })
    })

    expect(result.current[0]).toEqual({ count: 2 })
    setItemSpy.mockRestore()
  })
})
