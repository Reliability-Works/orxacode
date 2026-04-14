import { describe, expect, it } from 'vitest'

import { resolveRemoteAccessRuntimeState } from './remoteAccessRuntimeState'

function createStore(value: { enabled: boolean; environmentId?: string }) {
  return {
    get: () => value,
    set: () => value,
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
    const state = resolveRemoteAccessRuntimeState({
      store: createStore({ enabled: true, environmentId: 'environment-1' }),
    })

    expect(state.environmentId).toBe('environment-1')
    expect(state.bootstrapToken).toBeTypeOf('string')
    expect(state.bootstrapToken).not.toHaveLength(0)
  })

  it('clears the bootstrap token when remote access is disabled', () => {
    expect(
      resolveRemoteAccessRuntimeState({
        store: createStore({ enabled: false, environmentId: 'environment-1' }),
        previousBootstrapToken: 'bootstrap-token',
      })
    ).toEqual({
      environmentId: 'environment-1',
      bootstrapToken: undefined,
    })
  })
})
