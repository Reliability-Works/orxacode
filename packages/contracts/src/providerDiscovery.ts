import { Schema } from 'effect'

import { IsoDateTime, TrimmedNonEmptyString } from './baseSchemas'
import { ProviderKind } from './orchestration.models'

export const ProviderComposerCapabilities = Schema.Struct({
  provider: ProviderKind,
  supportsSkillMentions: Schema.Boolean,
  supportsSkillDiscovery: Schema.Boolean,
  supportsNativeSlashCommandDiscovery: Schema.Boolean,
  supportsPluginDiscovery: Schema.Boolean,
})
export type ProviderComposerCapabilities = typeof ProviderComposerCapabilities.Type

export const ProviderGetComposerCapabilitiesInput = Schema.Struct({
  provider: ProviderKind,
})
export type ProviderGetComposerCapabilitiesInput = typeof ProviderGetComposerCapabilitiesInput.Type

export const ProviderNativeCommandDescriptor = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
})
export type ProviderNativeCommandDescriptor = typeof ProviderNativeCommandDescriptor.Type

export const ProviderListCommandsInput = Schema.Struct({
  provider: ProviderKind,
})
export type ProviderListCommandsInput = typeof ProviderListCommandsInput.Type

export const ProviderListCommandsResult = Schema.Struct({
  commands: Schema.Array(ProviderNativeCommandDescriptor),
  updatedAt: IsoDateTime,
})
export type ProviderListCommandsResult = typeof ProviderListCommandsResult.Type

export const ProviderPluginDescriptor = Schema.Struct({
  id: TrimmedNonEmptyString,
  provider: ProviderKind,
  marketplaceName: TrimmedNonEmptyString,
  marketplacePath: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  displayName: Schema.optional(TrimmedNonEmptyString),
  shortDescription: Schema.optional(TrimmedNonEmptyString),
  longDescription: Schema.optional(TrimmedNonEmptyString),
  developerName: Schema.optional(TrimmedNonEmptyString),
  category: Schema.optional(TrimmedNonEmptyString),
  homepage: Schema.optional(TrimmedNonEmptyString),
  sourcePath: TrimmedNonEmptyString,
  installed: Schema.Boolean,
  enabled: Schema.Boolean,
  defaultPrompt: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  tags: Schema.Array(TrimmedNonEmptyString).pipe(Schema.withDecodingDefault(() => [])),
})
export type ProviderPluginDescriptor = typeof ProviderPluginDescriptor.Type

export const ProviderDiscoveryWarning = Schema.Struct({
  path: TrimmedNonEmptyString,
  message: TrimmedNonEmptyString,
})
export type ProviderDiscoveryWarning = typeof ProviderDiscoveryWarning.Type

export const ProviderListPluginsInput = Schema.Struct({
  provider: ProviderKind,
})
export type ProviderListPluginsInput = typeof ProviderListPluginsInput.Type

export const ProviderListPluginsResult = Schema.Struct({
  plugins: Schema.Array(ProviderPluginDescriptor),
  warnings: Schema.Array(ProviderDiscoveryWarning),
  updatedAt: IsoDateTime,
})
export type ProviderListPluginsResult = typeof ProviderListPluginsResult.Type
