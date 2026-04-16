import { type DesktopRemoteAccessSnapshot } from '@orxa-code/contracts'
import { RefreshCwIcon, SmartphoneIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { reconnectActiveEnvironment } from '../environments/runtime'
import { beginExpectedReconnectWindow } from '../rpc/wsConnectionState'
import { useCopyToClipboard } from '~/hooks/useCopyToClipboard'
import { cn } from '~/lib/utils'
import {
  isStableRemoteAccessEndpoint,
  resolveManualPairingValues,
  resolvePreferredRemoteAccessEndpoint,
  resolveSecondaryRemoteAccessEndpoints,
} from './remoteAccessControl.helpers'
import { updateRemoteAccessPreference } from './remoteAccessControl.logic'
import {
  AdvancedRemoteAccessCard,
  DirectFallbackCard,
  RemoteAccessQrCode,
  RemoteAccessReadyCard,
  TailscaleServeCard,
} from './RemoteAccessControl.parts'
import { Button } from './ui/button'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog'
import { Switch } from './ui/switch'

interface RemoteAccessState {
  snapshot: DesktopRemoteAccessSnapshot | null
  isLoading: boolean
  errorMessage: string | null
  setEnabled: (enabled: boolean) => Promise<void>
  refresh: () => Promise<void>
}

function useRemoteAccessSnapshot(open: boolean): RemoteAccessState {
  const [snapshot, setSnapshot] = useState<DesktopRemoteAccessSnapshot | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const bridge = window.desktopBridge
    if (!bridge?.getRemoteAccessSnapshot) {
      setSnapshot(null)
      setErrorMessage('Remote access is only available from the desktop app.')
      return
    }

    setIsLoading(true)
    setErrorMessage(null)
    void bridge
      .getRemoteAccessSnapshot()
      .then(nextSnapshot => {
        setSnapshot(nextSnapshot)
      })
      .catch(error => {
        setSnapshot(null)
        setErrorMessage(error instanceof Error ? error.message : 'Failed to load remote access.')
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  const setEnabled = useCallback(async (enabled: boolean) => {
    setIsLoading(true)
    setErrorMessage(null)
    try {
      beginExpectedReconnectWindow('remote-access-toggle', 15_000)
      const nextSnapshot = await updateRemoteAccessPreference({
        bridge: window.desktopBridge,
        enabled,
        reconnect: () => reconnectActiveEnvironment(),
      })
      setSnapshot(nextSnapshot)
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to update remote access settings.'
      )
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
  }, [open, refresh])

  return { snapshot, isLoading, errorMessage, setEnabled, refresh }
}

function resolveDialogDescription(snapshot: DesktopRemoteAccessSnapshot | null): string {
  if (!snapshot || snapshot.status === 'disabled') {
    return 'Turn this on when you want to expose a direct private-network link or a Tailscale Serve target for this Mac.'
  }

  if (snapshot.status === 'unavailable') {
    return 'Phone access is on, but this Mac does not currently expose a reachable IPv4 address. Join Wi-Fi, Ethernet, or Tailscale and refresh.'
  }

  return 'Prefer Tailscale Serve for a stable private URL. QR and direct network links stay available as fallback paths.'
}

function RemoteAccessToggleCard(props: {
  enabled: boolean
  isLoading: boolean
  onEnabledChange: (enabled: boolean) => Promise<void>
}) {
  return (
    <div className="flex items-center justify-between rounded-2xl border bg-card px-4 py-4">
      <div className="space-y-1 pr-4">
        <div className="text-sm font-semibold text-foreground">Phone access</div>
        <p className="text-sm text-muted-foreground">
          {props.enabled
            ? 'Enabled. Orxa is generating links for this Mac right now.'
            : 'Disabled. No phone links are active until you switch this on.'}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {props.enabled ? 'On' : 'Off'}
        </span>
        <Switch
          checked={props.enabled}
          disabled={props.isLoading}
          onCheckedChange={checked => {
            void props.onEnabledChange(checked)
          }}
          aria-label="Toggle phone access"
        />
      </div>
    </div>
  )
}

function RemoteAccessDisabledState(props: Pick<RemoteAccessState, 'isLoading' | 'setEnabled'>) {
  return (
    <div className="space-y-4">
      <RemoteAccessToggleCard
        enabled={false}
        isLoading={props.isLoading}
        onEnabledChange={props.setEnabled}
      />
      <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
        Phone access is currently disabled. Turn it on when you want to open this workspace from
        your phone. Disabling it invalidates the existing phone links for this Mac.
      </div>
    </div>
  )
}

function RemoteAccessAvailableState(props: {
  snapshot: DesktopRemoteAccessSnapshot
  copiedUrl: string | null
  isCopied: boolean
  onCopy: (value: string) => void
  state: Pick<RemoteAccessState, 'isLoading' | 'setEnabled'>
}) {
  const preferredEndpoint = useMemo(
    () => resolvePreferredRemoteAccessEndpoint(props.snapshot),
    [props.snapshot]
  )
  const secondaryEndpoints = useMemo(
    () => resolveSecondaryRemoteAccessEndpoints(props.snapshot),
    [props.snapshot]
  )
  const manualPairingValues = useMemo(
    () => resolveManualPairingValues(preferredEndpoint),
    [preferredEndpoint]
  )
  const hasStableEndpoint = isStableRemoteAccessEndpoint(preferredEndpoint)
  const showDiagnostics = import.meta.env.DEV

  return (
    <div className="space-y-4">
      <RemoteAccessToggleCard
        enabled={true}
        isLoading={props.state.isLoading}
        onEnabledChange={props.state.setEnabled}
      />
      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border bg-card p-4">
            <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Direct Link QR
            </div>
            <div className="flex flex-col items-center gap-3">
              <RemoteAccessQrCode value={preferredEndpoint?.bootstrapUrl ?? ''} />
              <p className="text-center text-xs text-muted-foreground">
                {preferredEndpoint
                  ? `Uses ${preferredEndpoint.label.toLowerCase()} as the pairing route.`
                  : 'No direct endpoint is available yet.'}
              </p>
            </div>
          </div>
        </div>
        <RemoteAccessAvailableCards
          hasStableEndpoint={hasStableEndpoint}
          snapshot={props.snapshot}
          preferredEndpoint={preferredEndpoint}
          secondaryEndpoints={secondaryEndpoints}
          manualPairingValues={manualPairingValues}
          copiedUrl={props.copiedUrl}
          isCopied={props.isCopied}
          onCopy={props.onCopy}
          showDiagnostics={showDiagnostics}
        />
      </div>
    </div>
  )
}

type RemoteAccessDetailProps = {
  snapshot: DesktopRemoteAccessSnapshot
  preferredEndpoint: ReturnType<typeof resolvePreferredRemoteAccessEndpoint>
  secondaryEndpoints: ReturnType<typeof resolveSecondaryRemoteAccessEndpoints>
  manualPairingValues: ReturnType<typeof resolveManualPairingValues>
  copiedUrl: string | null
  isCopied: boolean
  onCopy: (value: string) => void
  showDiagnostics: boolean
}

function RemoteAccessAvailableCards(
  props: RemoteAccessDetailProps & {
    hasStableEndpoint: boolean
  }
) {
  const { hasStableEndpoint, ...detailProps } = props
  const primaryCards =
    hasStableEndpoint && props.preferredEndpoint ? (
      <RemoteAccessReadyCard
        endpoint={props.preferredEndpoint}
        copiedUrl={props.copiedUrl}
        isCopied={props.isCopied}
        onCopy={props.onCopy}
      />
    ) : (
      <>
        <div>
          <TailscaleServeCard
            port={props.snapshot.port}
            copiedUrl={props.copiedUrl}
            isCopied={props.isCopied}
            onCopy={props.onCopy}
          />
        </div>
        <DirectFallbackCard
          endpoint={props.preferredEndpoint}
          copiedUrl={props.copiedUrl}
          isCopied={props.isCopied}
          onCopy={props.onCopy}
        />
      </>
    )

  return (
    <div className="space-y-3">
      {primaryCards}
      <RemoteAccessDetails {...detailProps} />
    </div>
  )
}

function RemoteAccessDetails(props: RemoteAccessDetailProps) {
  return (
    <>
      <AdvancedRemoteAccessCard
        copiedUrl={props.copiedUrl}
        isCopied={props.isCopied}
        manualPairingValues={props.manualPairingValues}
        onCopy={props.onCopy}
        preferredEndpoint={props.preferredEndpoint}
        secondaryEndpoints={props.secondaryEndpoints}
        showDiagnostics={props.showDiagnostics}
        snapshot={props.snapshot}
      />

      <div className="rounded-2xl border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground">
        Remote access stays private to networks that can already reach this Mac. When Tailscale
        Serve is active, the QR and primary copy flow should use the stable `ts.net` host.
      </div>
    </>
  )
}

function RemoteAccessUnavailableState(
  props: Pick<RemoteAccessState, 'isLoading' | 'setEnabled' | 'refresh'>
) {
  return (
    <div className="space-y-4">
      <RemoteAccessToggleCard
        enabled={true}
        isLoading={props.isLoading}
        onEnabledChange={props.setEnabled}
      />
      <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
        Phone access is enabled, but this Mac does not currently expose a reachable IPv4 address.
        Connect to Wi-Fi, Ethernet, or Tailscale, then refresh.
      </div>
      <Button variant="outline" onClick={() => void props.refresh()} disabled={props.isLoading}>
        {props.isLoading ? (
          <RefreshCwIcon className="size-4 animate-spin" />
        ) : (
          <RefreshCwIcon className="size-4" />
        )}
        Refresh addresses
      </Button>
    </div>
  )
}

function RemoteAccessBody(props: {
  state: RemoteAccessState
  copiedUrl: string | null
  isCopied: boolean
  onCopy: (value: string) => void
}) {
  const snapshot = props.state.snapshot

  if (props.state.isLoading && !snapshot) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border bg-card">
        <RefreshCwIcon className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (props.state.errorMessage) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {props.state.errorMessage}
      </div>
    )
  }

  if (!snapshot || snapshot.status === 'disabled') {
    return (
      <RemoteAccessDisabledState
        isLoading={props.state.isLoading}
        setEnabled={props.state.setEnabled}
      />
    )
  }

  if (snapshot.status === 'available') {
    return (
      <RemoteAccessAvailableState
        snapshot={snapshot}
        copiedUrl={props.copiedUrl}
        isCopied={props.isCopied}
        onCopy={props.onCopy}
        state={props.state}
      />
    )
  }

  return (
    <RemoteAccessUnavailableState
      isLoading={props.state.isLoading}
      setEnabled={props.state.setEnabled}
      refresh={props.state.refresh}
    />
  )
}

export function RemoteAccessControl({
  buttonClassName,
  iconClassName,
}: {
  buttonClassName?: string
  iconClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const state = useRemoteAccessSnapshot(open)
  const { copyToClipboard, isCopied } = useCopyToClipboard<string>({
    onCopy: url => setCopiedUrl(url),
    onError: () => setCopiedUrl(null),
  })

  useEffect(() => {
    if (!isCopied) {
      setCopiedUrl(null)
    }
  }, [isCopied])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="icon"
            variant="ghost"
            className={cn(
              'pointer-events-auto shrink-0 text-muted-foreground/70 hover:bg-accent hover:text-foreground',
              buttonClassName ?? 'size-7'
            )}
            aria-label="Open remote access"
            title="Open on phone"
          />
        }
      >
        <SmartphoneIcon className={cn(iconClassName ?? 'size-4')} />
      </DialogTrigger>
      <DialogPopup className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>Open on phone</DialogTitle>
          <DialogDescription>{resolveDialogDescription(state.snapshot)}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-6">
          <RemoteAccessBody
            state={state}
            copiedUrl={copiedUrl}
            isCopied={isCopied}
            onCopy={value => copyToClipboard(value, value)}
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
