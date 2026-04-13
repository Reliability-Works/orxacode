import { describe, expect, it } from 'vitest'

import { resolveRootRuntimeBootStrategy } from './rootRuntimeBootStrategy'

describe('root runtime boot strategy', () => {
  it('always uses the primary environment for desktop-managed sessions', () => {
    expect(
      resolveRootRuntimeBootStrategy({
        authStatus: 'requires-auth',
        hasDesktopManagedPrimary: true,
        hasPairingToken: false,
      })
    ).toBe('primary')
  })

  it('uses the primary environment in plain browser mode when auth is already available', () => {
    expect(
      resolveRootRuntimeBootStrategy({
        authStatus: 'authenticated',
        hasDesktopManagedPrimary: false,
        hasPairingToken: false,
      })
    ).toBe('primary')
  })

  it('redirects to pairing when there is no desktop primary and no auth session', () => {
    expect(
      resolveRootRuntimeBootStrategy({
        authStatus: 'requires-auth',
        hasDesktopManagedPrimary: false,
        hasPairingToken: false,
      })
    ).toBe('pair')
  })

  it('always prefers the pairing flow when a pairing token is present', () => {
    expect(
      resolveRootRuntimeBootStrategy({
        authStatus: 'authenticated',
        hasDesktopManagedPrimary: true,
        hasPairingToken: true,
      })
    ).toBe('pair')
  })
})
