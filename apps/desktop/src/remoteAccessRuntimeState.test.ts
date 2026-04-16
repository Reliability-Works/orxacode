import { describe, expect, it } from 'vitest'

import { resolveRemoteAccessRuntimeState } from './remoteAccessRuntimeState'

function createStore(value: { enabled: boolean; environmentId?: string; bootstrapToken?: string }) {
  let persistedBootstrapToken = value.bootstrapToken
  return {
    get: () => value,
    set: () => value,
    getBootstrapToken: () => persistedBootstrapToken,
    setBootstrapToken: (token: string | undefined) => {
      persistedBootstrapToken = token
    },
  }
}

describe('resolveRemoteAccessRuntimeState', () => {
  it('reuses the existing bootstrap token while remote access stays enabled', () => {
    expect(
      resolveRemoteAccessRuntimeState({
        store: createStore({ enabled: true, environmentId: 'environment-1' }),
        previousBootstrapToken: 'bootstrap-token',
      })
    ).toEqual({
      environmentId: 'environment-1',
      bootstrapToken: 'bootstrap-token',
    })
  })

  it('generates a bootstrap token when remote access is enabled without one', () => {
    const store = createStore({ enabled: true, environmentId: 'environment-1' })
    const state = resolveRemoteAccessRuntimeState({
      store,
    })

    expect(state.environmentId).toBe('environment-1')
    expect(state.bootstrapToken).toBeTypeOf('string')
    expect(state.bootstrapToken).not.toHaveLength(0)
    expect(store.getBootstrapToken()).toBe(state.bootstrapToken)
  })

  it('clears the bootstrap token when remote access is disabled', () => {
    const store = createStore({
      enabled: false,
      environmentId: 'environment-1',
      bootstrapToken: 'persisted-bootstrap-token',
    })
    expect(
      resolveRemoteAccessRuntimeState({
        store,
        previousBootstrapToken: 'bootstrap-token',
      })
    ).toEqual({
      environmentId: 'environment-1',
      bootstrapToken: undefined,
    })
    expect(store.getBootstrapToken()).toBeUndefined()
  })
})
