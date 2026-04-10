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

    expect(store.get()).toEqual({ enabled: false })
  })

  it('persists the enabled state', () => {
    const store = createStore()

    expect(store.set({ enabled: true })).toEqual({ enabled: true })
    expect(store.get()).toEqual({ enabled: true })
    expect(store.set({ enabled: false })).toEqual({ enabled: false })
    expect(store.get()).toEqual({ enabled: false })
  })
})
