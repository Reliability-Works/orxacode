/**
 * Hook fetching opencode primary agents via the provider.listAgents WS RPC.
 * Used by the composer TraitsPicker to offer an Agent picker when the active
 * session provider is opencode.
 */
import { useQuery } from '@tanstack/react-query'
import type { OpencodeAgent } from '@orxa-code/contracts'
import { getWsRpcClient } from '../../wsRpcClient'

const OPENCODE_AGENTS_STALE_TIME_MS = 30_000

export interface OpencodePrimaryAgentsResult {
  readonly agents: ReadonlyArray<OpencodeAgent>
  readonly isLoading: boolean
  readonly error: Error | null
}

export function useOpencodePrimaryAgents(enabled: boolean): OpencodePrimaryAgentsResult {
  const query = useQuery({
    queryKey: ['opencode', 'primary-agents'] as const,
    queryFn: async () => {
      const result = await getWsRpcClient().provider.listAgents({ provider: 'opencode' })
      return result.agents
    },
    enabled,
    staleTime: OPENCODE_AGENTS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })
  return {
    agents: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error : null,
  }
}
