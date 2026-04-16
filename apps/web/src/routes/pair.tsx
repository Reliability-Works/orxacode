import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

import { connectRemoteEnvironment, getEnvironmentRuntimeDebugState } from '../environments/runtime'
import {
  peekPairingTokenFromUrl,
  resolveInitialPrimaryAuthGateState,
  tryResolveInitialPrimaryEnvironmentDescriptor,
  takePairingTokenFromUrl,
} from '../environments/primary'
import { Button } from '../components/ui/button'

export const Route = createFileRoute('/pair')({
  beforeLoad: async () => {
    const [, authGateState] = await Promise.all([
      tryResolveInitialPrimaryEnvironmentDescriptor(),
      resolveInitialPrimaryAuthGateState(),
    ])

    if (authGateState.status === 'authenticated' && !peekPairingTokenFromUrl()) {
      throw redirect({ to: '/', replace: true })
    }

    return {
      authGateState,
    }
  },
  component: PairRouteView,
})

function PairRouteView() {
  const navigate = useNavigate()
  const [host, setHost] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [state, setState] = useState<'idle' | 'pairing' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useAutoPairingBootstrap(navigate, setState, setErrorMessage)

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Orxa Code
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Connect to your Mac</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Scan the QR code from Orxa Code on your Mac, or enter the Mac address and pairing code
          manually.
        </p>

        <div className="mt-6 space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium">Mac address</span>
            <input
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-foreground/40"
              placeholder="https://192.168.1.20:3773"
              value={host}
              onChange={event => setHost(event.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium">Pairing code</span>
            <input
              className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm uppercase outline-none transition focus:border-foreground/40"
              placeholder="Paste the exact token from Orxa"
              value={pairingCode}
              onChange={event => setPairingCode(event.target.value)}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
        </div>

        {state === 'error' ? (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {errorMessage ?? 'Failed to pair this device.'}
          </div>
        ) : null}

        <div className="mt-6 flex gap-3">
          <Button
            className="flex-1"
            onClick={() => {
              void submitManualPairing({ host, pairingCode, navigate, setState, setErrorMessage })
            }}
            disabled={state === 'pairing'}
          >
            {state === 'pairing' ? 'Connecting…' : 'Connect'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function useAutoPairingBootstrap(
  navigate: ReturnType<typeof useNavigate>,
  setState: Dispatch<SetStateAction<'idle' | 'pairing' | 'error'>>,
  setErrorMessage: Dispatch<SetStateAction<string | null>>
) {
  useEffect(() => {
    const token = takePairingTokenFromUrl()
    if (!token) {
      return
    }

    console.info('[mobile-sync] pair auto bootstrap start', {
      revision: 'mobile-reopen-probe-1',
      hasToken: true,
      pathname: window.location.pathname,
      runtime: getEnvironmentRuntimeDebugState(),
    })
    setState('pairing')
    setErrorMessage(null)
    void connectRemoteEnvironment(
      {
        pairingUrl: `${window.location.origin}/pair#token=${encodeURIComponent(token)}`,
      },
      'pair-auto-bootstrap'
    )
      .then(connection => {
        console.info('[mobile-sync] pair auto bootstrap runtime initialized', {
          revision: 'mobile-reopen-probe-1',
          connectionId: connection.connectionId,
          environmentId: connection.environmentId,
          runtime: getEnvironmentRuntimeDebugState(),
        })
        return navigate({ to: '/', replace: true })
      })
      .catch(error => {
        console.error('[mobile-sync] pair auto bootstrap error', {
          revision: 'mobile-reopen-probe-1',
          error,
          runtime: getEnvironmentRuntimeDebugState(),
        })
        setState('error')
        setErrorMessage(error instanceof Error ? error.message : 'Failed to pair this device.')
      })
  }, [navigate, setErrorMessage, setState])
}

async function submitManualPairing(input: {
  host: string
  pairingCode: string
  navigate: ReturnType<typeof useNavigate>
  setState: Dispatch<SetStateAction<'idle' | 'pairing' | 'error'>>
  setErrorMessage: Dispatch<SetStateAction<string | null>>
}) {
  input.setState('pairing')
  input.setErrorMessage(null)
  try {
    console.info('[mobile-sync] pair manual submit start', {
      revision: 'mobile-reopen-probe-1',
      host: input.host,
      pairingCodeLength: input.pairingCode.length,
      runtime: getEnvironmentRuntimeDebugState(),
    })
    const connection = await connectRemoteEnvironment(
      {
        host: input.host,
        pairingCode: input.pairingCode,
      },
      'pair-manual-submit'
    )
    console.info('[mobile-sync] pair manual submit runtime initialized', {
      revision: 'mobile-reopen-probe-1',
      connectionId: connection.connectionId,
      environmentId: connection.environmentId,
      runtime: getEnvironmentRuntimeDebugState(),
    })
    await input.navigate({ to: '/', replace: true })
  } catch (error) {
    console.error('[mobile-sync] pair manual submit error', {
      revision: 'mobile-reopen-probe-1',
      error,
      runtime: getEnvironmentRuntimeDebugState(),
    })
    input.setState('error')
    input.setErrorMessage(error instanceof Error ? error.message : 'Failed to pair this device.')
  }
}
