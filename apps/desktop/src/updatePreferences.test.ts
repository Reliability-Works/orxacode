import * as FS from 'node:fs'
import * as OS from 'node:os'
import * as Path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createDesktopUpdatePreferencesStore,
  isPrereleaseVersion,
  sanitizeReleaseChannel,
} from './updatePreferences'

const tempDirs: string[] = []

function createStore() {
  const dir = FS.mkdtempSync(Path.join(OS.tmpdir(), 'orxa-update-preferences-'))
  tempDirs.push(dir)
  return createDesktopUpdatePreferencesStore(Path.join(dir, 'update-preferences.json'))
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (!dir) continue
    FS.rmSync(dir, { recursive: true, force: true })
  }
})

describe('sanitizeReleaseChannel', () => {
  it('normalizes invalid values to stable', () => {
    expect(sanitizeReleaseChannel('stable')).toBe('stable')
    expect(sanitizeReleaseChannel('prerelease')).toBe('prerelease')
    expect(sanitizeReleaseChannel('beta')).toBe('stable')
  })
})

describe('isPrereleaseVersion', () => {
  it('detects semver prerelease suffixes', () => {
    expect(isPrereleaseVersion('1.0.0')).toBe(false)
    expect(isPrereleaseVersion('1.0.0-beta.1')).toBe(true)
  })
})

describe('createDesktopUpdatePreferencesStore', () => {
  it('defaults to the stable channel', () => {
    const store = createStore()

    expect(store.get()).toEqual({ releaseChannel: 'stable' })
  })

  it('persists an explicit release channel selection', () => {
    const store = createStore()

    expect(store.set({ releaseChannel: 'prerelease' })).toEqual({
      releaseChannel: 'prerelease',
    })
    expect(store.get()).toEqual({ releaseChannel: 'prerelease' })
  })

  it('auto-selects prerelease once for a newly installed beta build', () => {
    const store = createStore()

    expect(store.syncInstalledVersion('0.1.0-beta.55')).toEqual({
      releaseChannel: 'prerelease',
    })
    expect(store.get()).toEqual({ releaseChannel: 'prerelease' })
    expect(store.set({ releaseChannel: 'stable' })).toEqual({ releaseChannel: 'stable' })
    expect(store.syncInstalledVersion('0.1.0-beta.55')).toEqual({ releaseChannel: 'stable' })
  })
})
