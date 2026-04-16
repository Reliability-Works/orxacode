import { describe, expect, it } from 'vitest'
import type { DesktopRemoteAccessSnapshot } from '@orxa-code/contracts'

import {
  buildTailscaleServeCommand,
  buildTailscaleServeDisableCommand,
  buildTailscaleServeStatusCommand,
  isStableRemoteAccessEndpoint,
  isTailnetAddress,
  isTailscaleServeAddress,
  resolveManualPairingValues,
  resolvePreferredRemoteAccessEndpoint,
  resolveSecondaryRemoteAccessEndpoints,
} from './remoteAccessControl.helpers'

function buildEndpoint(address: string) {
  return {
    id: address,
    label: address.startsWith('100.') ? 'Tailnet / VPN' : 'Local network',
    address,
    url: `http://${address}:3773/pair`,
    bootstrapUrl: `http://${address}:3773/pair`,
    pairUrl: `http://${address}:3773/pair`,
    sessionUrl: `http://${address}:3773/`,
    authMode: 'bootstrap' as const,
    transport: 'ws' as const,
  }
}

function buildStableEndpoint() {
  return {
    id: 'tailscale-serve:remote-host.example.ts.net',
    label: 'Tailscale Serve',
    address: 'remote-host.example.ts.net',
    url: 'https://remote-host.example.ts.net/pair',
    bootstrapUrl: 'https://remote-host.example.ts.net/pair',
    pairUrl: 'https://remote-host.example.ts.net/pair',
    sessionUrl: 'https://remote-host.example.ts.net/',
    authMode: 'bootstrap' as const,
    transport: 'wss' as const,
    environmentId: 'env-1',
  }
}

function buildSnapshot(addresses: string[]): DesktopRemoteAccessSnapshot {
  return {
    enabled: true,
    status: 'available',
    environment: {
      environmentId: 'env-1',
      label: 'Orxa Code (Desktop)',
      kind: 'local-desktop',
    },
    bootstrapUrl: addresses[0] ? `http://${addresses[0]}:3773/pair` : null,
    port: 3773,
    endpoints: addresses.map(buildEndpoint),
  }
}

describe('remoteAccessControl helpers', () => {
  it('detects tailnet addresses', () => {
    expect(isTailnetAddress('100.80.4.7')).toBe(true)
    expect(isTailnetAddress('192.168.1.24')).toBe(false)
  })

  it('detects tailscale serve hostnames', () => {
    expect(isTailscaleServeAddress('remote-host.example.ts.net')).toBe(true)
    expect(isTailscaleServeAddress('100.80.4.7')).toBe(false)
  })

  it('detects stable remote endpoints', () => {
    expect(
      isStableRemoteAccessEndpoint({
        id: 'stable',
        label: 'Tailscale Serve',
        address: 'remote-host.example.ts.net',
        url: 'https://remote-host.example.ts.net/pair',
        transport: 'wss',
      })
    ).toBe(true)
    expect(
      isStableRemoteAccessEndpoint({
        id: 'tailnet',
        label: 'Tailnet / VPN',
        address: '100.80.4.7',
        url: 'http://100.80.4.7:3773/pair',
        transport: 'ws',
      })
    ).toBe(false)
  })

  it('prefers the tailnet endpoint over local network addresses', () => {
    const snapshot = buildSnapshot(['192.168.1.24', '10.0.0.15', '100.80.4.7'])

    expect(resolvePreferredRemoteAccessEndpoint(snapshot)?.address).toBe('100.80.4.7')
    expect(
      resolveSecondaryRemoteAccessEndpoints(snapshot).map(endpoint => endpoint.address)
    ).toEqual(['192.168.1.24', '10.0.0.15'])
  })

  it('prefers the tailscale serve hostname over raw interface addresses', () => {
    const snapshot = {
      ...buildSnapshot(['192.168.1.24', '100.80.4.7']),
      endpoints: [
        buildStableEndpoint(),
        ...buildSnapshot(['192.168.1.24', '100.80.4.7']).endpoints,
      ],
    }

    expect(resolvePreferredRemoteAccessEndpoint(snapshot)?.address).toBe(
      'remote-host.example.ts.net'
    )
    expect(
      resolveSecondaryRemoteAccessEndpoints(snapshot).map(endpoint => endpoint.address)
    ).toEqual(['192.168.1.24', '100.80.4.7'])
  })

  it('builds the exact tailscale serve commands for the pinned port workflow', () => {
    expect(buildTailscaleServeCommand(3773)).toBe('tailscale serve --bg 127.0.0.1:3773')
    expect(buildTailscaleServeStatusCommand()).toBe('tailscale serve status')
    expect(buildTailscaleServeDisableCommand()).toBe('tailscale serve --https=443 off')
  })

  it('derives manual pairing values from the preferred endpoint', () => {
    const values = resolveManualPairingValues({
      ...buildStableEndpoint(),
      url: 'https://remote-host.example.ts.net/pair?v=abc#token=PAIR123',
      bootstrapUrl: 'https://remote-host.example.ts.net/pair?v=abc#token=PAIR123',
      pairUrl: 'https://remote-host.example.ts.net/pair?v=abc#token=PAIR123',
    })

    expect(values).toEqual({
      host: 'https://remote-host.example.ts.net/',
      pairingCode: 'PAIR123',
    })
  })
})
