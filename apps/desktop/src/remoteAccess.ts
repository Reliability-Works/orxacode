import * as OS from 'node:os'

import type {
  DesktopRemoteAccessEndpoint,
  DesktopRemoteAccessSnapshot,
  ExecutionEnvironmentDescriptor,
} from '@orxa-code/contracts'

interface ResolveRemoteAccessSnapshotInput {
  cacheKey?: string
  enabled: boolean
  environmentId: string
  bootstrapToken: string | null
  port: number
  tailscaleServeHostname?: string | null
  networkInterfaces?: typeof OS.networkInterfaces
}

function isTailnetIpv4(address: string): boolean {
  if (!address.startsWith('100.')) return false
  const parts = address.split('.')
  const secondOctet = Number(parts[1] ?? '')
  return Number.isInteger(secondOctet) && secondOctet >= 64 && secondOctet <= 127
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
  if (isTailnetIpv4(address)) return 1
  return 2
}

function buildEndpoint(
  address: string,
  port: number,
  environmentId: string,
  bootstrapToken: string,
  cacheKey: string
): DesktopRemoteAccessEndpoint {
  const sessionUrl = `http://${address}:${port}/`
  const pairUrl = `http://${address}:${port}/pair?v=${encodeURIComponent(cacheKey)}#token=${encodeURIComponent(bootstrapToken)}`
  return {
    id: address,
    environmentId,
    label: isPrivateIpv4(address)
      ? 'Local network'
      : isTailnetIpv4(address)
        ? 'Tailnet / VPN'
        : 'Network address',
    address,
    transport: 'ws',
    url: pairUrl,
    pairUrl,
    bootstrapUrl: pairUrl,
    sessionUrl,
    authMode: 'bootstrap',
  }
}

function buildTailscaleServeEndpoint(
  hostname: string,
  environmentId: string,
  bootstrapToken: string,
  cacheKey: string
): DesktopRemoteAccessEndpoint {
  const sessionUrl = `https://${hostname}/`
  const pairUrl = `https://${hostname}/pair?v=${encodeURIComponent(cacheKey)}#token=${encodeURIComponent(bootstrapToken)}`
  return {
    id: `tailscale-serve:${hostname}`,
    environmentId,
    label: 'Tailscale Serve',
    address: hostname,
    transport: 'wss',
    url: pairUrl,
    pairUrl,
    bootstrapUrl: pairUrl,
    sessionUrl,
    authMode: 'bootstrap',
  }
}

export function resolveRemoteAccessSnapshot(
  input: ResolveRemoteAccessSnapshotInput
): DesktopRemoteAccessSnapshot {
  const environment: ExecutionEnvironmentDescriptor = {
    environmentId: input.environmentId,
    label: 'Orxa Code (Desktop)',
    kind: 'local-desktop',
  }
  if (!input.enabled) {
    return {
      enabled: false,
      status: 'disabled',
      environment,
      bootstrapUrl: null,
      port: input.port,
      endpoints: [],
    }
  }

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

  const networkEndpoints = Array.from(addresses)
    .sort((left, right) => {
      const priorityDelta = endpointPriority(left) - endpointPriority(right)
      return priorityDelta !== 0 ? priorityDelta : left.localeCompare(right)
    })
    .map(address =>
      buildEndpoint(address, input.port, input.environmentId, input.bootstrapToken ?? '', cacheKey)
    )

  const tailscaleServeEndpoint =
    input.tailscaleServeHostname && input.bootstrapToken
      ? buildTailscaleServeEndpoint(
          input.tailscaleServeHostname,
          input.environmentId,
          input.bootstrapToken,
          cacheKey
        )
      : null

  const endpoints = tailscaleServeEndpoint
    ? [tailscaleServeEndpoint, ...networkEndpoints]
    : networkEndpoints

  return {
    enabled: true,
    status: endpoints.length > 0 ? 'available' : 'unavailable',
    environment,
    bootstrapUrl: endpoints[0]?.bootstrapUrl ?? null,
    port: input.port,
    endpoints,
  }
}
