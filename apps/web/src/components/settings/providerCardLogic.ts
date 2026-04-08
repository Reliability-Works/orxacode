import type { ServerProvider } from '@orxa-code/contracts'
import { APP_BASE_NAME } from '../../branding'

export const PROVIDER_STATUS_STYLES = {
  disabled: { dot: 'bg-amber-400' },
  error: { dot: 'bg-destructive' },
  ready: { dot: 'bg-success' },
  warning: { dot: 'bg-warning' },
} as const

export function getProviderSummary(provider: ServerProvider | undefined): {
  headline: string
  detail: string | null
} {
  if (!provider) {
    return {
      headline: 'Checking provider status',
      detail: 'Waiting for the server to report installation and authentication details.',
    }
  }
  if (!provider.enabled) {
    return {
      headline: 'Disabled',
      detail:
        provider.message ??
        `This provider is installed but disabled for new sessions in ${APP_BASE_NAME}.`,
    }
  }
  if (!provider.installed) {
    return { headline: 'Not found', detail: provider.message ?? 'CLI not detected on PATH.' }
  }
  if (provider.auth.status === 'authenticated') {
    const authLabel = provider.auth.label ?? provider.auth.type
    return {
      headline: authLabel ? `Authenticated · ${authLabel}` : 'Authenticated',
      detail: provider.message ?? null,
    }
  }
  if (provider.auth.status === 'unauthenticated') {
    return { headline: 'Not authenticated', detail: provider.message ?? null }
  }
  if (provider.status === 'warning') {
    return {
      headline: 'Needs attention',
      detail:
        provider.message ?? 'The provider is installed, but the server could not fully verify it.',
    }
  }
  if (provider.status === 'error') {
    return {
      headline: 'Unavailable',
      detail: provider.message ?? 'The provider failed its startup checks.',
    }
  }
  return {
    headline: 'Available',
    detail: provider.message ?? 'Installed and ready, but authentication could not be verified.',
  }
}

export function getProviderVersionLabel(version: string | null | undefined): string | null {
  if (!version) return null
  return version.startsWith('v') ? version : `v${version}`
}
