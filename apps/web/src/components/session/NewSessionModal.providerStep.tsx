import * as React from 'react'
import type { ProviderKind, ServerProvider, ServerProviderState } from '@orxa-code/contracts'
import { PROVIDER_DISPLAY_NAMES } from '@orxa-code/contracts'

import { Badge } from '~/components/ui/badge'
import { Tooltip, TooltipPopup, TooltipTrigger } from '~/components/ui/tooltip'
import { cn } from '~/lib/utils'
import { useServerProviders } from '~/rpc/serverState'
import { CursorIcon, Gemini } from '../Icons'
import { ProviderLogo } from './ProviderLogos'

// ── Provider descriptions ─────────────────────────────────────────────

const PROVIDER_DESCRIPTIONS: Record<ProviderKind, string> = {
  claudeAgent: "Anthropic's Claude via the Agent SDK",
  codex: 'OpenAI Codex via JSON-RPC',
  opencode: 'Opencode with user-authenticated providers',
}

// ── Status chip ───────────────────────────────────────────────────────

type BadgeVariant = 'success' | 'warning' | 'error' | 'outline'

function statusVariant(status: ServerProviderState): BadgeVariant {
  if (status === 'ready') return 'success'
  if (status === 'warning') return 'warning'
  if (status === 'error') return 'error'
  return 'outline'
}

function statusLabel(status: ServerProviderState): string {
  if (status === 'ready') return 'Ready'
  if (status === 'warning') return 'Warning'
  if (status === 'error') return 'Error'
  return 'Disabled'
}

function isCardEnabled(liveProvider: ServerProvider | undefined): boolean {
  if (!liveProvider) return false
  return liveProvider.status === 'ready'
}

const CARD_CLASSNAME =
  'flex flex-col items-center gap-3 rounded-xl border bg-card p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

interface CardBodyProps {
  readonly logo: React.ReactNode
  readonly label: string
  readonly description: string
  readonly badge: React.ReactNode
}

function CardBody(props: CardBodyProps): React.JSX.Element {
  return (
    <>
      {props.logo}
      <div className="flex w-full flex-col items-center gap-1">
        <span className="font-medium text-sm leading-none">{props.label}</span>
        <span className="text-center text-muted-foreground text-xs">{props.description}</span>
      </div>
      {props.badge}
    </>
  )
}

// ── Live provider card ────────────────────────────────────────────────

interface ProviderCardProps {
  readonly provider: ProviderKind
  readonly liveProvider: ServerProvider | undefined
  readonly pending: boolean
  readonly onSelect: (provider: ProviderKind) => void
}

function ProviderCard(props: ProviderCardProps): React.JSX.Element {
  const { provider, liveProvider, pending, onSelect } = props
  const enabled = isCardEnabled(liveProvider) && !pending
  const status = liveProvider?.status ?? 'disabled'
  const label = PROVIDER_DISPLAY_NAMES[provider]
  const description = PROVIDER_DESCRIPTIONS[provider]
  const tooltipMessage = !enabled ? (liveProvider?.message ?? statusLabel(status)) : null

  function handleClick(): void {
    if (!enabled) return
    onSelect(provider)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    if (!enabled) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(provider)
    }
  }

  const card = (
    <button
      aria-disabled={!enabled || undefined}
      className={cn(
        CARD_CLASSNAME,
        enabled ? 'cursor-pointer hover:bg-muted/50' : 'cursor-not-allowed opacity-50'
      )}
      tabIndex={0}
      type="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <CardBody
        logo={<ProviderLogo provider={provider} size={40} />}
        label={label}
        description={description}
        badge={
          <Badge size="sm" variant={statusVariant(status)}>
            {statusLabel(status)}
          </Badge>
        }
      />
    </button>
  )

  if (tooltipMessage) {
    return (
      <Tooltip>
        <TooltipTrigger render={card} />
        <TooltipPopup side="bottom">{tooltipMessage}</TooltipPopup>
      </Tooltip>
    )
  }

  return card
}

// ── Coming soon card ──────────────────────────────────────────────────

interface ComingSoonCardProps {
  readonly label: string
  readonly description: string
  readonly icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
}

function ComingSoonCard(props: ComingSoonCardProps): React.JSX.Element {
  const { label, description, icon: IconComponent } = props
  return (
    <div aria-disabled className={cn(CARD_CLASSNAME, 'cursor-not-allowed opacity-50')}>
      <CardBody
        logo={<IconComponent aria-hidden className="size-10" />}
        label={label}
        description={description}
        badge={
          <Badge size="sm" variant="outline">
            Coming soon
          </Badge>
        }
      />
    </div>
  )
}

// ── Step component ────────────────────────────────────────────────────

const PROVIDER_KINDS: readonly ProviderKind[] = ['claudeAgent', 'codex', 'opencode']

const COMING_SOON_ENTRIES: ReadonlyArray<ComingSoonCardProps> = [
  { label: 'Cursor', description: 'Cursor Agent CLI', icon: CursorIcon },
  { label: 'Gemini', description: 'Google Gemini', icon: Gemini },
]

interface NewSessionModalProviderStepProps {
  readonly pendingProvider: ProviderKind | null
  readonly onSelect: (provider: ProviderKind) => void
}

export function NewSessionModalProviderStep(
  props: NewSessionModalProviderStepProps
): React.JSX.Element {
  const { pendingProvider, onSelect } = props
  const liveProviders = useServerProviders()

  function findProvider(kind: ProviderKind): ServerProvider | undefined {
    return liveProviders.find(p => p.provider === kind)
  }

  return (
    <div className="grid grid-cols-3 gap-3 p-1 sm:grid-cols-5">
      {PROVIDER_KINDS.map(kind => (
        <ProviderCard
          key={kind}
          liveProvider={findProvider(kind)}
          pending={pendingProvider !== null && pendingProvider !== kind}
          provider={kind}
          onSelect={onSelect}
        />
      ))}
      {COMING_SOON_ENTRIES.map(entry => (
        <ComingSoonCard
          key={entry.label}
          label={entry.label}
          description={entry.description}
          icon={entry.icon}
        />
      ))}
    </div>
  )
}
