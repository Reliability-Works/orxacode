import type { ProviderKind, SkillListResult } from '@orxa-code/contracts'
import { queryOptions } from '@tanstack/react-query'

import { getWsRpcClient } from '../wsRpcClient'

const SKILLS_STALE_TIME_MS = 5 * 60 * 1000

export const skillsQueryKeys = {
  all: ['skills'] as const,
  list: (provider?: ProviderKind) => ['skills', 'list', provider ?? 'all'] as const,
}

export function skillsListQueryOptions(provider?: ProviderKind) {
  return queryOptions<SkillListResult>({
    queryKey: skillsQueryKeys.list(provider),
    queryFn: () => getWsRpcClient().skills.list(provider !== undefined ? { provider } : {}),
    staleTime: SKILLS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })
}
