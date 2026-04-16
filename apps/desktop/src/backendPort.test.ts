import { describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_DESKTOP_BACKEND_PORT,
  ensureDesktopBackendPortAvailable,
  resolveDesktopBackendPort,
} from './backendPort'

describe('resolveDesktopBackendPort', () => {
  it('defaults to the stable desktop backend port', () => {
    expect(resolveDesktopBackendPort({})).toBe(DEFAULT_DESKTOP_BACKEND_PORT)
  })

  it('accepts a valid ORXA_DESKTOP_BACKEND_PORT override', () => {
    expect(resolveDesktopBackendPort({ ORXA_DESKTOP_BACKEND_PORT: '4123' })).toBe(4123)
  })

  it('rejects invalid ORXA_DESKTOP_BACKEND_PORT values', () => {
    expect(() => resolveDesktopBackendPort({ ORXA_DESKTOP_BACKEND_PORT: 'abc' })).toThrow(
      'Invalid ORXA_DESKTOP_BACKEND_PORT'
    )
  })
})

describe('ensureDesktopBackendPortAvailable', () => {
  it('returns when the configured port is available', async () => {
    const checkAvailability = vi.fn(async () => true)

    await expect(
      ensureDesktopBackendPortAvailable(3773, checkAvailability)
    ).resolves.toBeUndefined()
    expect(checkAvailability).toHaveBeenCalledWith(3773)
  })

  it('throws when the configured port is already in use', async () => {
    const checkAvailability = vi.fn(async () => false)

    await expect(ensureDesktopBackendPortAvailable(3773, checkAvailability)).rejects.toThrow(
      'Desktop backend port 3773 is already in use on loopback.'
    )
  })
})
