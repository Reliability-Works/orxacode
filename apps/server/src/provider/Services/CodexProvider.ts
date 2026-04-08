import { ServiceMap } from 'effect'

import type { ServerProviderShape } from './ServerProvider'

export type CodexProviderShape = ServerProviderShape

export class CodexProvider extends ServiceMap.Service<CodexProvider, CodexProviderShape>()(
  'orxacode/provider/Services/CodexProvider'
) {}
