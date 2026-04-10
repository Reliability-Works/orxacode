import { type DesktopRemoteAccessSnapshot } from '@orxa-code/contracts'
import { CheckIcon, CopyIcon, QrCodeIcon, RefreshCwIcon, SmartphoneIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

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

interface RemoteAccessState {
  snapshot: DesktopRemoteAccessSnapshot | null
  isLoading: boolean
  errorMessage: string | null
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

  useEffect(() => {
    if (!open) return
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
  }, [open])

  return { snapshot, isLoading, errorMessage }
}

function RemoteAccessBody(props: {
  state: RemoteAccessState
  copiedUrl: string | null
  isCopied: boolean
  onCopy: (value: string) => void
}) {
  const primaryEndpoint = useMemo(
    () => props.state.snapshot?.endpoints[0] ?? null,
    [props.state.snapshot]
  )

  if (props.state.isLoading) {
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

  if (props.state.snapshot && props.state.snapshot.enabled && primaryEndpoint) {
    return (
      <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            <QrCodeIcon className="size-3.5" />
            Scan
          </div>
          <RemoteAccessQrCode value={primaryEndpoint.url} />
          <p className="text-center text-xs text-muted-foreground">
            The QR uses the first detected LAN address.
          </p>
        </div>
        <div className="space-y-3">
          {props.state.snapshot.endpoints.map(endpoint => (
            <EndpointRow
              key={endpoint.id}
              label={endpoint.label}
              address={endpoint.address}
              url={endpoint.url}
              isCopied={props.isCopied && props.copiedUrl === endpoint.url}
              onCopy={props.onCopy}
            />
          ))}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-muted-foreground">
            Anyone on the same network with this link can control your Orxa session while the app is
            open. This is a local prototype path, not the final public relay flow.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
      No external IPv4 network address was found. Make sure this Mac is connected to Wi-Fi or
      Ethernet, then try again.
    </div>
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
          <DialogDescription>
            Connect your phone to this Mac over your local network. Scan the QR code or copy one of
            the links below while both devices are on the same Wi-Fi.
          </DialogDescription>
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
