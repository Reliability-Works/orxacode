import { ServiceMap } from 'effect'

import type { ServerProviderShape } from './ServerProvider'

export type OpencodeProviderShape = ServerProviderShape

export class OpencodeProvider extends ServiceMap.Service<OpencodeProvider, OpencodeProviderShape>()(
  'orxacode/provider/Services/OpencodeProvider'
) {}
