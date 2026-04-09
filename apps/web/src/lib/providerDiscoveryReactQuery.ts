import type {
  ProviderComposerCapabilities,
  ProviderKind,
  ProviderListCommandsResult,
  ProviderListPluginsResult,
} from '@orxa-code/contracts'
import { queryOptions } from '@tanstack/react-query'

import { getWsRpcClient } from '../wsRpcClient'

const PROVIDER_DISCOVERY_STALE_TIME_MS = 5 * 60 * 1000

export const providerDiscoveryQueryKeys = {
  all: ['providerDiscovery'] as const,
  composerCapabilities: (provider: ProviderKind) =>
    ['providerDiscovery', 'composerCapabilities', provider] as const,
  commands: (provider: ProviderKind) => ['providerDiscovery', 'commands', provider] as const,
  plugins: (provider: ProviderKind) => ['providerDiscovery', 'plugins', provider] as const,
}

export function providerComposerCapabilitiesQueryOptions(provider: ProviderKind) {
  return queryOptions<ProviderComposerCapabilities>({
    queryKey: providerDiscoveryQueryKeys.composerCapabilities(provider),
    queryFn: () => getWsRpcClient().provider.getComposerCapabilities({ provider }),
    staleTime: PROVIDER_DISCOVERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })
}

export function providerNativeCommandsQueryOptions(provider: ProviderKind) {
  return queryOptions<ProviderListCommandsResult>({
    queryKey: providerDiscoveryQueryKeys.commands(provider),
    queryFn: () => getWsRpcClient().provider.listCommands({ provider }),
    staleTime: PROVIDER_DISCOVERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })
}

export function providerPluginsQueryOptions(provider: ProviderKind) {
  return queryOptions<ProviderListPluginsResult>({
    queryKey: providerDiscoveryQueryKeys.plugins(provider),
    queryFn: () => getWsRpcClient().provider.listPlugins({ provider }),
    staleTime: PROVIDER_DISCOVERY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })
}
