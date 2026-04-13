import type { DesktopPrimaryEnvironmentBootstrap } from '@orxa-code/contracts'

export interface PrimaryEnvironmentTarget {
  readonly source: 'configured' | 'desktop-managed' | 'window-origin'
  readonly target: {
    readonly httpBaseUrl: string
    readonly wsBaseUrl: string
  }
}

let resolvedDesktopBootstrap: DesktopPrimaryEnvironmentBootstrap | null = null
let desktopBootstrapPromise: Promise<DesktopPrimaryEnvironmentBootstrap | null> | null = null

async function getDesktopLocalEnvironmentBootstrap(): Promise<DesktopPrimaryEnvironmentBootstrap | null> {
  if (!window.desktopBridge?.getLocalEnvironmentBootstrap) {
    return null
  }
  return window.desktopBridge.getLocalEnvironmentBootstrap()
}

function normalizeBaseUrl(rawValue: string): string {
  return new URL(rawValue, window.location.origin).toString()
}

function swapBaseUrlProtocol(
  rawValue: string,
  nextProtocol: 'http:' | 'https:' | 'ws:' | 'wss:'
): string {
  const url = new URL(normalizeBaseUrl(rawValue))
  url.protocol = nextProtocol
  url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.toString()
}

function resolveConfiguredPrimaryTarget(): PrimaryEnvironmentTarget | null {
  const configuredHttpBaseUrl = import.meta.env.VITE_HTTP_URL?.trim() || undefined
  const configuredWsBaseUrl = import.meta.env.VITE_WS_URL?.trim() || undefined

  if (!configuredHttpBaseUrl && !configuredWsBaseUrl) {
    return null
  }

  const httpBaseUrl =
    configuredHttpBaseUrl ??
    (configuredWsBaseUrl?.startsWith('wss:')
      ? swapBaseUrlProtocol(configuredWsBaseUrl, 'https:')
      : swapBaseUrlProtocol(configuredWsBaseUrl!, 'http:'))
  const wsBaseUrl =
    configuredWsBaseUrl ??
    (configuredHttpBaseUrl?.startsWith('https:')
      ? swapBaseUrlProtocol(configuredHttpBaseUrl, 'wss:')
      : swapBaseUrlProtocol(configuredHttpBaseUrl!, 'ws:'))

  return {
    source: 'configured',
    target: {
      httpBaseUrl: normalizeBaseUrl(httpBaseUrl),
      wsBaseUrl: normalizeBaseUrl(wsBaseUrl),
    },
  }
}

function resolveWindowOriginPrimaryTarget(): PrimaryEnvironmentTarget {
  const httpBaseUrl = normalizeBaseUrl(window.location.origin)
  const wsBaseUrl = swapBaseUrlProtocol(
    httpBaseUrl,
    httpBaseUrl.startsWith('https:') ? 'wss:' : 'ws:'
  )

  return {
    source: 'window-origin',
    target: {
      httpBaseUrl,
      wsBaseUrl,
    },
  }
}

function resolveDesktopPrimaryTarget(): PrimaryEnvironmentTarget | null {
  const desktopBootstrap = resolvedDesktopBootstrap
  if (!desktopBootstrap) {
    return null
  }

  return {
    source: 'desktop-managed',
    target: {
      httpBaseUrl: normalizeBaseUrl(desktopBootstrap.target.httpBaseUrl),
      wsBaseUrl: normalizeBaseUrl(desktopBootstrap.target.wsBaseUrl),
    },
  }
}

export async function resolvePrimaryEnvironmentBootstrap(): Promise<DesktopPrimaryEnvironmentBootstrap | null> {
  if (resolvedDesktopBootstrap) {
    return resolvedDesktopBootstrap
  }
  if (desktopBootstrapPromise) {
    return desktopBootstrapPromise
  }

  const nextPromise = getDesktopLocalEnvironmentBootstrap().then(bootstrap => {
    resolvedDesktopBootstrap = bootstrap
    return bootstrap
  })
  desktopBootstrapPromise = nextPromise.finally(() => {
    if (desktopBootstrapPromise === nextPromise) {
      desktopBootstrapPromise = null
    }
  })
  return desktopBootstrapPromise
}

export function readPrimaryEnvironmentBootstrap(): DesktopPrimaryEnvironmentBootstrap | null {
  return resolvedDesktopBootstrap
}

export function readPrimaryEnvironmentTarget(): PrimaryEnvironmentTarget {
  return (
    resolveDesktopPrimaryTarget() ??
    resolveConfiguredPrimaryTarget() ??
    resolveWindowOriginPrimaryTarget()
  )
}

export async function resolvePrimaryEnvironmentTarget(): Promise<PrimaryEnvironmentTarget> {
  await resolvePrimaryEnvironmentBootstrap()
  return readPrimaryEnvironmentTarget()
}

export function resolvePrimaryEnvironmentHttpUrl(
  pathname: string,
  searchParams?: Record<string, string>
): string {
  const url = new URL(readPrimaryEnvironmentTarget().target.httpBaseUrl)
  url.pathname = pathname
  url.search = searchParams ? new URLSearchParams(searchParams).toString() : ''
  url.hash = ''
  return url.toString()
}

export function resetPrimaryEnvironmentTargetForTests(): void {
  resolvedDesktopBootstrap = null
  desktopBootstrapPromise = null
}
