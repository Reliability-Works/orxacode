import { ServiceMap } from 'effect'

import type { ServerProviderShape } from './ServerProvider'

export type ClaudeProviderShape = ServerProviderShape

export class ClaudeProvider extends ServiceMap.Service<ClaudeProvider, ClaudeProviderShape>()(
  'orxacode/provider/Services/ClaudeProvider'
) {}
