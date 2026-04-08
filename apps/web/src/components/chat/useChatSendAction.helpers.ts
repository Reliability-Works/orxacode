/**
 * Pure helpers shared by useChatSendAction splits.
 */

import type { ProviderKind, ServerProvider } from '@orxa-code/contracts'
import { applyClaudePromptEffortPrefix } from '@orxa-code/shared/model'
import { getProviderModelCapabilities } from '../../providerModels'
import type { ClaudeCodeEffort } from '@orxa-code/contracts'

export function formatOutgoingPrompt(params: {
  provider: ProviderKind
  model: string | null
  models: ReadonlyArray<ServerProvider['models'][number]>
  effort: string | null
  text: string
}): string {
  const caps = getProviderModelCapabilities(params.models, params.model, params.provider)
  if (params.effort && caps.promptInjectedEffortLevels.includes(params.effort)) {
    return applyClaudePromptEffortPrefix(params.text, params.effort as ClaudeCodeEffort | null)
  }
  return params.text
}
