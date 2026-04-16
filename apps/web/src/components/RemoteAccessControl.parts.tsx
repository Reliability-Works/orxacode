import type { DesktopRemoteAccessEndpoint, DesktopRemoteAccessSnapshot } from '@orxa-code/contracts'
import { CheckIcon, ChevronDownIcon, CopyIcon, RefreshCwIcon, TerminalIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  buildTailscaleServeCommand,
  buildTailscaleServeDisableCommand,
  buildTailscaleServeStatusCommand,
} from './remoteAccessControl.helpers'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

export function RemoteAccessQrCode(props: { value: string }) {
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

export function EndpointRow(props: {
  label: string
  address: string
  url: string
  isCopied: boolean
  onCopy: (value: string) => void
  wrapAddress?: boolean
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {props.label}
        </div>
        <div
          className={
            props.wrapAddress
              ? 'break-all font-mono text-sm text-foreground'
              : 'truncate font-mono text-sm text-foreground'
          }
        >
          {props.address}
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => props.onCopy(props.url)}>
        {props.isCopied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        {props.isCopied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}

export function TailscaleServeCard(props: {
  port: number
  copiedUrl: string | null
  isCopied: boolean
  onCopy: (value: string) => void
}) {
  const serveCommand = useMemo(() => buildTailscaleServeCommand(props.port), [props.port])
  const serveStatusCommand = useMemo(() => buildTailscaleServeStatusCommand(), [])
  const disableServeCommand = useMemo(() => buildTailscaleServeDisableCommand(), [])

  return (
    <div className="rounded-2xl border border-sky-500/20 bg-sky-500/5 p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-sky-100/80">
        <TerminalIcon className="size-3.5" />
        Recommended: Tailscale Serve
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Run this on the Mac that is hosting Orxa. It exposes a stable private HTTPS URL for your
        tailnet and avoids the port drift problem.
      </p>
      <div className="mt-4 space-y-2">
        <EndpointRow
          label="Start Serve"
          address={serveCommand}
          url={serveCommand}
          isCopied={props.isCopied && props.copiedUrl === serveCommand}
          onCopy={props.onCopy}
        />
        <EndpointRow
          label="Verify"
          address={serveStatusCommand}
          url={serveStatusCommand}
          isCopied={props.isCopied && props.copiedUrl === serveStatusCommand}
          onCopy={props.onCopy}
        />
        <EndpointRow
          label="Disable"
          address={disableServeCommand}
          url={disableServeCommand}
          isCopied={props.isCopied && props.copiedUrl === disableServeCommand}
          onCopy={props.onCopy}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        After Serve is configured, open this Mac&apos;s MagicDNS hostname from Tailscale on your
        phone.
      </p>
    </div>
  )
}

export function RemoteAccessReadyCard(props: {
  endpoint: DesktopRemoteAccessEndpoint
  copiedUrl: string | null
  isCopied: boolean
  onCopy: (value: string) => void
}) {
  const hostUrl = props.endpoint.sessionUrl ?? props.endpoint.url
  const pairingUrl = props.endpoint.bootstrapUrl ?? props.endpoint.url

  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
      <div className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-100/80">
        Ready Over Tailscale Serve
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Pair once on this stable host, then reopen the same host to resume from your phone.
      </p>
      <div className="mt-4">
        <EndpointRow
          label="MagicDNS host"
          address={props.endpoint.address}
          url={hostUrl}
          isCopied={props.isCopied && props.copiedUrl === hostUrl}
          onCopy={props.onCopy}
          wrapAddress={true}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => props.onCopy(pairingUrl)}
          className="min-w-0"
        >
          {props.isCopied && props.copiedUrl === pairingUrl ? 'Pair Link Copied' : 'Copy Pair Link'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => props.onCopy(hostUrl)}
          className="min-w-0"
        >
          {props.isCopied && props.copiedUrl === hostUrl ? 'Host Copied' : 'Copy Host'}
        </Button>
      </div>
    </div>
  )
}

export function DirectFallbackCard(props: {
  endpoint: DesktopRemoteAccessEndpoint | null
  copiedUrl: string | null
  isCopied: boolean
  onCopy: (value: string) => void
}) {
  if (!props.endpoint) {
    return null
  }

  const isStableHostname =
    props.endpoint.transport === 'wss' || props.endpoint.address.endsWith('.ts.net')

  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {isStableHostname ? 'Preferred Pairing Link' : 'Direct Fallback Link'}
      </div>
      <EndpointRow
        label={props.endpoint.label}
        address={props.endpoint.address}
        url={props.endpoint.bootstrapUrl ?? ''}
        isCopied={props.isCopied && props.copiedUrl === props.endpoint.bootstrapUrl}
        onCopy={props.onCopy}
        wrapAddress={isStableHostname}
      />
      <p className="mt-3 text-xs text-muted-foreground">
        {isStableHostname
          ? 'This is the stable MagicDNS host served through Tailscale Serve. Pair on this host once, then reopen the same host to resume.'
          : 'These addresses are live interface IPs on this Mac. They are valid, but they can change. Prefer Tailscale Serve when you want a stable hostname.'}
      </p>
    </div>
  )
}

export function ManualPairingCard(props: {
  host: string
  pairingCode: string
  copiedUrl: string | null
  isCopied: boolean
  onCopy: (value: string) => void
}) {
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Manual Pairing
      </div>
      <div className="space-y-2">
        <EndpointRow
          label="Mac address"
          address={props.host}
          url={props.host}
          isCopied={props.isCopied && props.copiedUrl === props.host}
          onCopy={props.onCopy}
          wrapAddress={true}
        />
        <EndpointRow
          label="Pairing code"
          address={props.pairingCode}
          url={props.pairingCode}
          isCopied={props.isCopied && props.copiedUrl === props.pairingCode}
          onCopy={props.onCopy}
          wrapAddress={true}
        />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Paste these into the phone&apos;s manual connect form if you are pairing from an installed
        home-screen app or another browser context.
      </p>
    </div>
  )
}

export function OtherNetworkPathsCard(props: {
  endpoints: DesktopRemoteAccessEndpoint[]
  copiedUrl: string | null
  isCopied: boolean
  onCopy: (value: string) => void
}) {
  if (props.endpoints.length === 0) {
    return null
  }

  return (
    <Collapsible className="rounded-2xl border bg-card p-4">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Other Network Paths
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {props.endpoints.length} additional interface{props.endpoints.length === 1 ? '' : 's'}{' '}
            were detected on this Mac.
          </p>
        </div>
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-4 space-y-2">
          {props.endpoints.map(endpoint => (
            <EndpointRow
              key={endpoint.id}
              label={endpoint.label}
              address={endpoint.address}
              url={endpoint.bootstrapUrl ?? ''}
              isCopied={props.isCopied && props.copiedUrl === endpoint.bootstrapUrl}
              onCopy={props.onCopy}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function RemoteAccessDiagnosticsCard(props: {
  snapshot: DesktopRemoteAccessSnapshot
  preferredEndpoint: DesktopRemoteAccessEndpoint | null
}) {
  return (
    <Collapsible className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-amber-100/80">
            Live Snapshot
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Shows exactly what the desktop bridge returned for pairing routes.
          </p>
        </div>
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-4 space-y-3 font-mono text-xs text-foreground">
          <div className="rounded-xl border bg-background/60 p-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Primary
            </div>
            <div className="mt-2 break-all">
              {props.preferredEndpoint
                ? `${props.preferredEndpoint.label} | ${props.preferredEndpoint.transport ?? 'ws'} | ${props.preferredEndpoint.bootstrapUrl ?? props.preferredEndpoint.url}`
                : 'none'}
            </div>
          </div>
          <div className="rounded-xl border bg-background/60 p-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Bootstrap URL
            </div>
            <div className="mt-2 break-all">{props.snapshot.bootstrapUrl ?? 'null'}</div>
          </div>
          <div className="rounded-xl border bg-background/60 p-3">
            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              Endpoints
            </div>
            <div className="mt-2 space-y-2">
              {props.snapshot.endpoints.map(endpoint => (
                <div key={endpoint.id} className="break-all">
                  {endpoint.label} | {endpoint.transport ?? 'ws'} |{' '}
                  {endpoint.bootstrapUrl ?? endpoint.url}
                </div>
              ))}
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function AdvancedRemoteAccessCard(props: {
  copiedUrl: string | null
  isCopied: boolean
  manualPairingValues: {
    host: string
    pairingCode: string
  } | null
  onCopy: (value: string) => void
  preferredEndpoint: DesktopRemoteAccessEndpoint | null
  secondaryEndpoints: DesktopRemoteAccessEndpoint[]
  showDiagnostics: boolean
  snapshot: DesktopRemoteAccessSnapshot
}) {
  const hasContent =
    props.manualPairingValues !== null ||
    props.secondaryEndpoints.length > 0 ||
    props.showDiagnostics

  if (!hasContent) {
    return null
  }

  return (
    <Collapsible className="rounded-2xl border bg-card p-4">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 text-left">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Advanced
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manual pairing, fallback network paths, and diagnostics.
          </p>
        </div>
        <ChevronDownIcon className="size-4 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-4 space-y-3">
          {props.manualPairingValues ? (
            <ManualPairingCard
              host={props.manualPairingValues.host}
              pairingCode={props.manualPairingValues.pairingCode}
              copiedUrl={props.copiedUrl}
              isCopied={props.isCopied}
              onCopy={props.onCopy}
            />
          ) : null}
          <OtherNetworkPathsCard
            endpoints={props.secondaryEndpoints}
            copiedUrl={props.copiedUrl}
            isCopied={props.isCopied}
            onCopy={props.onCopy}
          />
          {props.showDiagnostics ? (
            <RemoteAccessDiagnosticsCard
              snapshot={props.snapshot}
              preferredEndpoint={props.preferredEndpoint}
            />
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
