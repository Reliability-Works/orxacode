import { useCallback, useEffect, useRef } from 'react'
import type { ProjectBootstrap } from '@shared/ipc'

type RuntimeSnapshot = Awaited<ReturnType<typeof import('./useWorkspaceState-shared').loadOpencodeRuntimeSnapshot>>

export function useWorkspaceQueuedRefresh({
  activeProjectDir,
  refreshProject,
  refreshMessages,
  setStatusLine,
}: {
  activeProjectDir?: string
  refreshProject: (directory: string, skipMessageLoad?: boolean) => Promise<ProjectBootstrap>
  refreshMessages: () => Promise<RuntimeSnapshot | undefined>
  setStatusLine: (status: string) => void
}) {
  const refreshTimer = useRef<number | undefined>(undefined)
  const messageRefreshTimer = useRef<number | undefined>(undefined)
  const eventRefreshInFlight = useRef(false)
  const messageRefreshInFlight = useRef(false)

  const queueRefresh = useCallback(
    (reason: string, delayMs = 180, scope: 'messages' | 'project' | 'both' = 'both') => {
      if (!activeProjectDir) {
        return
      }

      if (scope === 'messages') {
        if (messageRefreshTimer.current) {
          window.clearTimeout(messageRefreshTimer.current)
        }
        messageRefreshTimer.current = window.setTimeout(() => {
          if (messageRefreshInFlight.current) {
            return
          }
          messageRefreshInFlight.current = true
          void refreshMessages()
            .then(() => setStatusLine(reason))
            .catch(() => undefined)
            .finally(() => {
              messageRefreshInFlight.current = false
            })
        }, delayMs)
        return
      }

      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current)
      }
      refreshTimer.current = window.setTimeout(() => {
        if (eventRefreshInFlight.current) {
          return
        }
        eventRefreshInFlight.current = true
        void refreshProject(activeProjectDir, true)
          .then(() => {
            if (scope === 'both') {
              void refreshMessages()
            }
            setStatusLine(reason)
          })
          .catch(() => undefined)
          .finally(() => {
            eventRefreshInFlight.current = false
          })
      }, delayMs)
    },
    [activeProjectDir, refreshMessages, refreshProject, setStatusLine]
  )

  useEffect(() => {
    return () => {
      if (refreshTimer.current) {
        window.clearTimeout(refreshTimer.current)
      }
      if (messageRefreshTimer.current) {
        window.clearTimeout(messageRefreshTimer.current)
      }
    }
  }, [])

  return { queueRefresh }
}
