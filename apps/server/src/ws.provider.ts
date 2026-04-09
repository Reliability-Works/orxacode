import type {
  ProviderGetComposerCapabilitiesInput,
  ProviderListCommandsInput,
  ProviderListPluginsInput,
} from '@orxa-code/contracts'
import { WS_METHODS } from '@orxa-code/contracts'

import type { ProviderDiscoveryService } from './provider/Services/ProviderDiscoveryService'

export interface ProviderMethodDependencies {
  readonly providerDiscoveryService: typeof ProviderDiscoveryService.Service
}

export const createProviderMethods = ({
  providerDiscoveryService,
}: ProviderMethodDependencies) => ({
  [WS_METHODS.providerGetComposerCapabilities]: (input: ProviderGetComposerCapabilitiesInput) =>
    providerDiscoveryService.getComposerCapabilities(input),
  [WS_METHODS.providerListCommands]: (input: ProviderListCommandsInput) =>
    providerDiscoveryService.listCommands(input),
  [WS_METHODS.providerListPlugins]: (input: ProviderListPluginsInput) =>
    providerDiscoveryService.listPlugins(input),
})
