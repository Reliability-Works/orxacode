// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'

import { REMOTE_ACCESS_TOKEN_STORAGE_KEY, resolveRemoteAccessToken } from './protocol'

afterEach(() => {
  window.history.replaceState({}, '', '/')
  window.sessionStorage.clear()
})

describe('resolveRemoteAccessToken', () => {
  it('reads the token from the current location search and persists it for reconnects', () => {
    window.history.replaceState({}, '', '/?token=local-phone-token&mobile=1')

    expect(resolveRemoteAccessToken()).toBe('local-phone-token')
    expect(window.sessionStorage.getItem(REMOTE_ACCESS_TOKEN_STORAGE_KEY)).toBe('local-phone-token')
  })

  it('falls back to the persisted token when the current route no longer includes it', () => {
    window.sessionStorage.setItem(REMOTE_ACCESS_TOKEN_STORAGE_KEY, 'stored-token')

    expect(resolveRemoteAccessToken()).toBe('stored-token')
  })
})
