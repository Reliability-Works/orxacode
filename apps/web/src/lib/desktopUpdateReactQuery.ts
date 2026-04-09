import { queryOptions, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { DesktopUpdatePreferences, DesktopUpdateState } from '@orxa-code/contracts'

export const desktopUpdateQueryKeys = {
  all: ['desktop', 'update'] as const,
  preferences: () => ['desktop', 'update', 'preferences'] as const,
  state: () => ['desktop', 'update', 'state'] as const,
}

export const setDesktopUpdateStateQueryData = (
  queryClient: QueryClient,
  state: DesktopUpdateState | null
) => queryClient.setQueryData(desktopUpdateQueryKeys.state(), state)

export const setDesktopUpdatePreferencesQueryData = (
  queryClient: QueryClient,
  preferences: DesktopUpdatePreferences | null
) => queryClient.setQueryData(desktopUpdateQueryKeys.preferences(), preferences)

export function desktopUpdateStateQueryOptions() {
  return queryOptions({
    queryKey: desktopUpdateQueryKeys.state(),
    queryFn: async () => {
      const bridge = window.desktopBridge
      if (!bridge || typeof bridge.getUpdateState !== 'function') return null
      return bridge.getUpdateState()
    },
    staleTime: Infinity,
    refetchOnMount: 'always',
  })
}

export function desktopUpdatePreferencesQueryOptions() {
  return queryOptions({
    queryKey: desktopUpdateQueryKeys.preferences(),
    queryFn: async () => {
      const bridge = window.desktopBridge
      if (!bridge || typeof bridge.getUpdatePreferences !== 'function') return null
      return bridge.getUpdatePreferences()
    },
    staleTime: Infinity,
    refetchOnMount: 'always',
  })
}

export function useDesktopUpdateState() {
  const queryClient = useQueryClient()
  const query = useQuery(desktopUpdateStateQueryOptions())

  useEffect(() => {
    const bridge = window.desktopBridge
    if (!bridge || typeof bridge.onUpdateState !== 'function') return

    return bridge.onUpdateState(nextState => {
      setDesktopUpdateStateQueryData(queryClient, nextState)
    })
  }, [queryClient])

  return query
}

export function useDesktopUpdatePreferences() {
  return useQuery(desktopUpdatePreferencesQueryOptions())
}
