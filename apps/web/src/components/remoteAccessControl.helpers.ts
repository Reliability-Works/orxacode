import type { DesktopRemoteAccessEndpoint, DesktopRemoteAccessSnapshot } from '@orxa-code/contracts'

export function isTailnetAddress(address: string): boolean {
  if (!address.startsWith('100.')) {
    return false
  }

  const parts = address.split('.')
  const secondOctet = Number(parts[1] ?? '')
  return Number.isInteger(secondOctet) && secondOctet >= 64 && secondOctet <= 127
}

export function isTailscaleServeAddress(address: string): boolean {
  return address.endsWith('.ts.net')
}

export function isStableRemoteAccessEndpoint(
  endpoint: DesktopRemoteAccessEndpoint | null
): boolean {
  if (!endpoint) {
    return false
  }

  return endpoint.transport === 'wss' || isTailscaleServeAddress(endpoint.address)
}

export function resolvePreferredRemoteAccessEndpoint(
  snapshot: DesktopRemoteAccessSnapshot
): DesktopRemoteAccessEndpoint | null {
  return (
    snapshot.endpoints.find(endpoint => isStableRemoteAccessEndpoint(endpoint)) ??
    snapshot.endpoints.find(endpoint => isTailnetAddress(endpoint.address)) ??
    snapshot.endpoints[0] ??
    null
  )
}

export function resolveSecondaryRemoteAccessEndpoints(
  snapshot: DesktopRemoteAccessSnapshot
): DesktopRemoteAccessEndpoint[] {
  const preferred = resolvePreferredRemoteAccessEndpoint(snapshot)
  if (!preferred) {
    return []
  }

  return snapshot.endpoints.filter(endpoint => endpoint.id !== preferred.id)
}

export function resolveManualPairingValues(endpoint: DesktopRemoteAccessEndpoint | null): {
  readonly host: string
  readonly pairingCode: string
} | null {
  if (!endpoint?.bootstrapUrl) {
    return null
  }

  const baseUrl = endpoint.sessionUrl ?? endpoint.url
  if (!baseUrl) {
    return null
  }

  let pairingUrl: URL
  let hostUrl: URL
  try {
    pairingUrl = new URL(endpoint.bootstrapUrl)
    hostUrl = new URL(baseUrl)
  } catch {
    return null
  }

  const pairingCode = pairingUrl.hash.startsWith('#token=')
    ? decodeURIComponent(pairingUrl.hash.slice('#token='.length))
    : ''

  if (!pairingCode) {
    return null
  }

  hostUrl.pathname = '/'
  hostUrl.search = ''
  hostUrl.hash = ''

  return {
    host: hostUrl.toString(),
    pairingCode,
  }
}

export function buildTailscaleServeCommand(port: number): string {
  return `tailscale serve --bg 127.0.0.1:${port}`
}

export function buildTailscaleServeStatusCommand(): string {
  return 'tailscale serve status'
}

export function buildTailscaleServeDisableCommand(): string {
  return 'tailscale serve --https=443 off'
}
