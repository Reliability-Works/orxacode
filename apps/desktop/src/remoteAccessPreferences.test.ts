import * as FS from 'node:fs'
import * as OS from 'node:os'
import * as Path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createDesktopRemoteAccessPreferencesStore,
  sanitizeRemoteAccessEnabled,
} from './remoteAccessPreferences'

const tempDirs: string[] = []

function createStore() {
  const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), 'orxa-remote-access-preferences-'))
  tempDirs.push(dir)
  return createDesktopRemoteAccessPreferencesStore(Path.join(dir, 'remote-access-preferences.json'))
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    FS.rmSync(dir, { recursive: true, force: true })
  }
})

describe('sanitizeRemoteAccessEnabled', () => {
  it('only accepts explicit true values', () => {
    expect(sanitizeRemoteAccessEnabled(true)).toBe(true)
    expect(sanitizeRemoteAccessEnabled(false)).toBe(false)
    expect(sanitizeRemoteAccessEnabled('true')).toBe(false)
    expect(sanitizeRemoteAccessEnabled(undefined)).toBe(false)
  })
})

describe('createDesktopRemoteAccessPreferencesStore', () => {
  it('defaults to remote access disabled', () => {
    const store = createStore()

    const value = store.get()
    expect(value.enabled).toBe(false)
    expect(value.environmentId).toBeTypeOf('string')
    expect(value.environmentId).not.toHaveLength(0)
  })

  it('persists the enabled state', () => {
    const store = createStore()

    const enabled = store.set({ enabled: true })
    expect(enabled.enabled).toBe(true)
    expect(enabled.environmentId).toBeTypeOf('string')
    const afterEnable = store.get()
    expect(afterEnable.enabled).toBe(true)
    expect(afterEnable.environmentId).toBe(enabled.environmentId)
    const disabled = store.set({ enabled: false })
    expect(disabled.enabled).toBe(false)
    expect(disabled.environmentId).toBe(enabled.environmentId)
    const afterDisable = store.get()
    expect(afterDisable.enabled).toBe(false)
    expect(afterDisable.environmentId).toBe(enabled.environmentId)
  })
})
