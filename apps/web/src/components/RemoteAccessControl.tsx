import { type DesktopRemoteAccessSnapshot } from '@orxa-code/contracts'
import { CheckIcon, CopyIcon, QrCodeIcon, RefreshCwIcon, SmartphoneIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { useCopyToClipboard } from '~/hooks/useCopyToClipboard'
import { cn } from '~/lib/utils'
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

function RemoteAccessQrCode(props: { value: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void import('qrcode')
      .then(module =>
        module.toDataURL(props.value, {
          errorCorrectionLevel: 'M',
          margin: 1,
          scale: 8,
          width: 224,
        })
      )
      .then(url => {
        if (!cancelled) {
          setDataUrl(url)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [props.value])

  return (
    <div className="flex h-56 w-56 items-center justify-center rounded-2xl border bg-white p-3 shadow-sm">
      {dataUrl ? (
        <img src={dataUrl} alt="QR code for Orxa Code remote access" className="h-full w-full" />
      ) : (
        <RefreshCwIcon className="size-5 animate-spin text-zinc-500" />
      )}
    </div>
  )
}

function EndpointRow(props: {
  label: string
  address: string
  url: string
  isCopied: boolean
  onCopy: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {props.label}
        </div>
        <div className="truncate font-mono text-sm text-foreground">{props.address}</div>
      </div>
      <Button size="sm" variant="outline" onClick={() => props.onCopy(props.url)}>
        {props.isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {props.isCopied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  )
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
    const bridge = window.desktopBridge
    if (!bridge?.setRemoteAccessPreferences || !bridge.getRemoteAccessSnapshot) {
      setErrorMessage('Remote access is only available from the desktop app.')
      return
    }

    setIsLoading(true)
    setErrorMessage(null)
    try {
      await bridge.setRemoteAccessPreferences({ enabled })
      const nextSnapshot = await bridge.getRemoteAccessSnapshot()
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
    return 'Phone access is off. Turn it on when you want this Mac to generate a QR code and private-network links.'
  }

  if (snapshot.status === 'unavailable') {
    return 'Phone access is on, but this Mac does not currently have a reachable IPv4 address. Join Wi-Fi, Ethernet, or Tailscale and refresh.'
  }

  return 'Connect your phone over the same Wi-Fi or any private network that can reach this Mac, including Tailscale.'
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
  const primaryEndpoint = useMemo(
    () => props.snapshot.endpoints[0] ?? null,
    [props.snapshot.endpoints]
  )

  return (
    <div className="space-y-4">
      <RemoteAccessToggleCard
        enabled={true}
        isLoading={props.state.isLoading}
        onEnabledChange={props.state.setEnabled}
      />
      <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <QrCodeIcon className="size-3.5" />
            Scan
          </div>
          <RemoteAccessQrCode value={primaryEndpoint?.bootstrapUrl ?? ''} />
          <p className="text-center text-xs text-muted-foreground">
            The QR uses the first reachable address for this Mac.
          </p>
        </div>
        <div className="space-y-3">
          {props.snapshot.endpoints.map(endpoint => (
            <EndpointRow
              key={endpoint.id}
              label={endpoint.label}
              address={endpoint.address}
              url={endpoint.bootstrapUrl ?? ''}
              isCopied={props.isCopied && props.copiedUrl === endpoint.bootstrapUrl}
              onCopy={props.onCopy}
            />
          ))}
          <div className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-4 text-sm text-muted-foreground">
            Same Wi-Fi is not required if your phone can reach this Mac over a private network. If
            you use Tailscale, connect both devices to the same tailnet and use the{' '}
            <span className="font-medium text-foreground">Tailnet / VPN</span> address when it is
            available.
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-muted-foreground">
            Anyone who can reach one of these links can control your Orxa session while the app is
            open. This is still a local/private-network path, not the final public relay flow.
          </div>
        </div>
      </div>
    </div>
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
      <DialogPopup className="max-w-3xl">
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
