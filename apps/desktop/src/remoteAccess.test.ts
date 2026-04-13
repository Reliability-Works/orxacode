import * as OS from 'node:os'

import { describe, expect, it } from 'vitest'

import { resolveRemoteAccessSnapshot } from './remoteAccess'

const LAN_NETWORK_INTERFACES = (() => ({
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '', mac: '', cidr: null }],
  en0: [
    {
      address: '192.168.1.24',
      family: 'IPv4',
      internal: false,
      netmask: '',
      mac: '',
      cidr: null,
    },
    {
      address: 'fe80::1',
      family: 'IPv6',
      internal: false,
      netmask: '',
      mac: '',
      cidr: null,
      scopeid: 0,
    },
  ],
  bridge0: [
    {
      address: '169.254.10.3',
      family: 'IPv4',
      internal: false,
      netmask: '',
      mac: '',
      cidr: null,
    },
  ],
  utun4: [
    {
      address: '100.80.4.7',
      family: 'IPv4',
      internal: false,
      netmask: '',
      mac: '',
      cidr: null,
    },
  ],
  en7: [
    { address: '10.0.0.15', family: 'IPv4', internal: false, netmask: '', mac: '', cidr: null },
  ],
})) as typeof OS.networkInterfaces

const LOOPBACK_ONLY_NETWORK_INTERFACES = (() => ({
  lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true, netmask: '', mac: '', cidr: null }],
})) as typeof OS.networkInterfaces

describe('resolveRemoteAccessSnapshot', () => {
  it('returns sorted LAN endpoints and skips internal or link-local interfaces', () => {
    const snapshot = resolveRemoteAccessSnapshot({
      cacheKey: 'fresh-view',
      enabled: true,
      environmentId: 'environment-1',
      bootstrapToken: 'bootstrap-token',
      port: 3773,
      networkInterfaces: LAN_NETWORK_INTERFACES,
    })

    expect(snapshot.enabled).toBe(true)
    expect(snapshot.status).toBe('available')
    expect(snapshot.environment?.environmentId).toBe('environment-1')
    expect(snapshot.endpoints.map(endpoint => endpoint.address)).toEqual([
      '10.0.0.15',
      '192.168.1.24',
      '100.80.4.7',
    ])
    expect(snapshot.endpoints[2]?.label).toBe('Tailnet / VPN')
    expect(snapshot.endpoints[0]?.url).toBe(
      'http://10.0.0.15:3773/pair?v=fresh-view#token=bootstrap-token'
    )
    expect(snapshot.endpoints[0]?.sessionUrl).toBe(
      'http://10.0.0.15:3773/'
    )
  })

  it('reports unavailable when remote access is enabled without external IPv4 interfaces', () => {
    const snapshot = resolveRemoteAccessSnapshot({
      enabled: true,
      environmentId: 'environment-1',
      bootstrapToken: 'bootstrap-token',
      port: 3773,
      networkInterfaces: LOOPBACK_ONLY_NETWORK_INTERFACES,
    })

    expect(snapshot.enabled).toBe(true)
    expect(snapshot.status).toBe('unavailable')
    expect(snapshot.endpoints).toEqual([])
  })

  it('reports disabled when remote access is turned off', () => {
    const snapshot = resolveRemoteAccessSnapshot({
      enabled: false,
      environmentId: 'environment-1',
      bootstrapToken: 'bootstrap-token',
      port: 3773,
      networkInterfaces: LAN_NETWORK_INTERFACES,
    })

    expect(snapshot.enabled).toBe(false)
    expect(snapshot.status).toBe('disabled')
    expect(snapshot.environment?.environmentId).toBe('environment-1')
    expect(snapshot.endpoints).toEqual([])
  })
})
