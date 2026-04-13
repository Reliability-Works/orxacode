import { useEffect } from 'react'
import type { ReactNode } from 'react'

import { reconnectActiveEnvironment } from '../environments/runtime'
import {
  getWsConnectionStatus,
  getWsConnectionUiState,
  setBrowserOnlineStatus,
  useWsConnectionStatus,
} from '../rpc/wsConnectionState'
import { Button } from './ui/button'

function reconnectLabel(uiState: ReturnType<typeof getWsConnectionUiState>): string {
  switch (uiState) {
    case 'offline':
      return 'Offline'
    case 'reconnecting':
      return 'Reconnecting'
    case 'error':
      return 'Reconnect'
    default:
      return 'Reconnect'
  }
}

export function WebSocketConnectionCoordinator() {
  useEffect(() => {
    const handleOnline = () => {
      setBrowserOnlineStatus(true)
      void reconnectActiveEnvironment().catch(() => undefined)
    }
    const handleOffline = () => {
      setBrowserOnlineStatus(false)
    }
    const handleFocus = () => {
      const status = getWsConnectionStatus()
      const uiState = getWsConnectionUiState(status)
      if (status.online && (uiState === 'reconnecting' || uiState === 'error')) {
        void reconnectActiveEnvironment().catch(() => undefined)
      }
    }

    setBrowserOnlineStatus(navigator.onLine !== false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('focus', handleFocus)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('focus', handleFocus)
    }
  }, [])

  return null
}

export function WebSocketConnectionSurface({ children }: { children: ReactNode }) {
  const status = useWsConnectionStatus()
  const uiState = getWsConnectionUiState(status)
  const shouldShowBanner =
    uiState === 'offline' || uiState === 'reconnecting' || uiState === 'error'

  return (
    <div className="relative flex h-svh min-h-0 flex-col">
      {shouldShowBanner ? (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-foreground">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">
                {uiState === 'offline'
                  ? 'Connection paused while offline.'
                  : uiState === 'reconnecting'
                    ? 'Reconnecting to your Orxa environment…'
                    : 'WebSocket connection lost.'}
              </p>
              {status.lastError ? (
                <p className="truncate text-muted-foreground">{status.lastError}</p>
              ) : null}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void reconnectActiveEnvironment().catch(() => undefined)
              }}
              disabled={uiState === 'offline'}
            >
              {reconnectLabel(uiState)}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
