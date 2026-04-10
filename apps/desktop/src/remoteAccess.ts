import * as OS from 'node:os'

import type { DesktopRemoteAccessEndpoint, DesktopRemoteAccessSnapshot } from '@orxa-code/contracts'

interface ResolveRemoteAccessSnapshotInput {
  cacheKey?: string
  port: number
  token: string
  networkInterfaces?: typeof OS.networkInterfaces
}

function isPrivateIpv4(address: string): boolean {
  if (address.startsWith('10.')) return true
  if (address.startsWith('192.168.')) return true
  if (!address.startsWith('172.')) return false
  const parts = address.split('.')
  const secondOctet = Number(parts[1] ?? '')
  return Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31
}

function endpointPriority(address: string): number {
  if (isPrivateIpv4(address)) return 0
  if (address.startsWith('100.')) return 1
  return 2
}

function buildEndpoint(
  address: string,
  port: number,
  token: string,
  cacheKey: string
): DesktopRemoteAccessEndpoint {
  return {
    id: address,
    label: isPrivateIpv4(address) ? 'Local network' : 'Network address',
    address,
    url: `http://${address}:${port}/?token=${encodeURIComponent(token)}&mobile=1&v=${encodeURIComponent(cacheKey)}`,
  }
}

export function resolveRemoteAccessSnapshot(
  input: ResolveRemoteAccessSnapshotInput
): DesktopRemoteAccessSnapshot {
  const networkInterfaces = input.networkInterfaces ?? OS.networkInterfaces
  const cacheKey = input.cacheKey ?? Date.now().toString(36)
  const addresses = new Set<string>()

  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') continue
      if (!entry.address || entry.address.startsWith('169.254.')) continue
      addresses.add(entry.address)
    }
  }

  const endpoints = Array.from(addresses)
    .sort((left, right) => {
      const priorityDelta = endpointPriority(left) - endpointPriority(right)
      return priorityDelta !== 0 ? priorityDelta : left.localeCompare(right)
    })
    .map(address => buildEndpoint(address, input.port, input.token, cacheKey))

  return {
    enabled: endpoints.length > 0,
    port: input.port,
    endpoints,
  }
}
