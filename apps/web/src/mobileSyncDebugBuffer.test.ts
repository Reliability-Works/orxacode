// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildMobileSyncDebugLogText,
  filterMobileSyncDebugEntries,
  getMobileSyncDebugEntries,
  installMobileSyncDebugBuffer,
  resetMobileSyncDebugBufferForTests,
} from './mobileSyncDebugBuffer'

describe('mobileSyncDebugBuffer', () => {
  afterEach(() => {
    resetMobileSyncDebugBufferForTests()
  })

  it('captures mobile-sync console entries into the in-app buffer', () => {
    installMobileSyncDebugBuffer()

    console.info('[mobile-sync] reconcile start', { connectionId: 7, environmentId: 'env-1' })
    console.warn('[mobile-sync] store potential bootstrap reset', {
      previousBootstrapComplete: true,
      nextBootstrapComplete: false,
    })

    expect(getMobileSyncDebugEntries()).toHaveLength(2)
    expect(buildMobileSyncDebugLogText()).toContain('[mobile-sync] reconcile start')
    expect(buildMobileSyncDebugLogText()).toContain('"connectionId":7')
    expect(buildMobileSyncDebugLogText()).toContain('"environmentId":"env-1"')
    expect(buildMobileSyncDebugLogText()).toContain('[mobile-sync] store potential bootstrap reset')
  })

  it('preserves structured payloads while still marking true cycles', () => {
    installMobileSyncDebugBuffer()

    const payload: { connectionId: number; nested: { ready: boolean }; self?: unknown } = {
      connectionId: 9,
      nested: { ready: true },
    }
    payload.self = payload

    console.info('[mobile-sync] cycle test', payload)

    expect(buildMobileSyncDebugLogText()).toContain('"connectionId":9')
    expect(buildMobileSyncDebugLogText()).toContain('"ready":true')
    expect(buildMobileSyncDebugLogText()).toContain('"self":"[Circular]"')
  })

  it('filters entries into useful log groups', () => {
    installMobileSyncDebugBuffer()

    console.info('[mobile-sync] pair auto bootstrap start', { pathname: '/pair' })
    console.info('[mobile-sync] transport', { event: 'create-connection-done' })
    console.info('[mobile-sync] sync ready', { projects: 3, threads: 5 })
    console.error('[mobile-sync] reconcile error', { error: new Error('boom') })

    const entries = getMobileSyncDebugEntries()

    expect(filterMobileSyncDebugEntries(entries, 'pair')).toHaveLength(1)
    expect(filterMobileSyncDebugEntries(entries, 'socket')).toHaveLength(1)
    expect(filterMobileSyncDebugEntries(entries, 'data')).toHaveLength(2)
    expect(filterMobileSyncDebugEntries(entries, 'errors')).toHaveLength(1)
    expect(buildMobileSyncDebugLogText('key')).toContain('[mobile-sync] sync ready')
    expect(buildMobileSyncDebugLogText('errors')).toContain('[mobile-sync] reconcile error')
  })
})
