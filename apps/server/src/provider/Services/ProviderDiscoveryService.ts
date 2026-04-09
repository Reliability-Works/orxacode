import type {
  ProviderComposerCapabilities,
  ProviderGetComposerCapabilitiesInput,
  ProviderListCommandsInput,
  ProviderListCommandsResult,
  ProviderListPluginsInput,
  ProviderListPluginsResult,
} from '@orxa-code/contracts'
import { ServiceMap } from 'effect'
import type { Effect } from 'effect'

export interface ProviderDiscoveryServiceShape {
  readonly getComposerCapabilities: (
    input: ProviderGetComposerCapabilitiesInput
  ) => Effect.Effect<ProviderComposerCapabilities, never>
  readonly listCommands: (
    input: ProviderListCommandsInput
  ) => Effect.Effect<ProviderListCommandsResult, never>
  readonly listPlugins: (
    input: ProviderListPluginsInput
  ) => Effect.Effect<ProviderListPluginsResult, never>
}

export class ProviderDiscoveryService extends ServiceMap.Service<
  ProviderDiscoveryService,
  ProviderDiscoveryServiceShape
>()('orxacode/provider/Services/ProviderDiscoveryService') {}
