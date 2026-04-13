import { InfoIcon, PlusIcon, XIcon, ChevronDownIcon, LoaderIcon, RefreshCwIcon } from 'lucide-react'
import { useState, useEffect, type ReactNode } from 'react'
import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
} from '@orxa-code/contracts'
import { ProviderCardConfiguredProviders } from './ProviderCardAuthDetails'
import { OpencodeModelVisibilitySection } from './OpencodeModelVisibilitySection'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent } from '../ui/collapsible'
import { Input } from '../ui/input'
import { Switch } from '../ui/switch'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/tooltip'
import { cn } from '../../lib/utils'
import { formatRelativeTime } from '../../timestampFormat'

export interface ProviderCardData {
  provider: ProviderKind
  title: string
  binaryPlaceholder: string
  binaryDescription: ReactNode
  homePathKey: string | null | undefined
  homePlaceholder: string | undefined
  homeDescription: ReactNode
  binaryPathValue: string
  isDirty: boolean
  liveProvider: ServerProvider | undefined
  models: ReadonlyArray<ServerProviderModel>
  providerConfig: {
    readonly enabled: boolean
    readonly binaryPath: string
    readonly customModels: ReadonlyArray<string>
    readonly hiddenModelSlugs?: ReadonlyArray<string>
  }
  statusStyle: { dot: string }
  summary: { headline: string; detail: string | null }
  versionLabel: string | null
}

interface ProviderModelCallbacks {
  onBinaryPathChange: (provider: ProviderKind, value: string) => void
  onCodexHomePathChange: (value: string) => void
  onCustomModelInputChange: (provider: ProviderKind, value: string) => void
  onCustomModelInputKeyDown: (provider: ProviderKind, key: string) => void
  onAddCustomModel: (provider: ProviderKind) => void
  onHiddenModelSlugsChange: (
    provider: ProviderKind,
    hiddenModelSlugs: ReadonlyArray<string>
  ) => void
  onRemoveCustomModel: (provider: ProviderKind, slug: string) => void
  onSetModelListRef: (provider: ProviderKind, el: HTMLDivElement | null) => void
}

export interface ProviderCardProps extends ProviderModelCallbacks {
  card: ProviderCardData
  codexHomePath: string
  customModelInput: string
  customModelError: string | null
  openProviderDetails: boolean
  onToggleDetails: (provider: ProviderKind) => void
  onToggleEnabled: (provider: ProviderKind, enabled: boolean) => void
  onResetProvider: (provider: ProviderKind) => void
}

interface ProviderModelRowProps {
  provider: ProviderKind
  model: ServerProviderModel
  onRemove: (provider: ProviderKind, slug: string) => void
}

function ProviderModelRow({ provider, model, onRemove }: ProviderModelRowProps) {
  const caps = model.capabilities
  const capLabels: string[] = []
  if (caps?.supportsFastMode) capLabels.push('Fast mode')
  if (caps?.supportsThinkingToggle) capLabels.push('Thinking')
  if (caps?.reasoningEffortLevels && caps.reasoningEffortLevels.length > 0) {
    capLabels.push('Reasoning')
  }
  const hasDetails = capLabels.length > 0 || model.name !== model.slug

  return (
    <div className="flex items-center gap-2 py-1">
      <span className="min-w-0 truncate text-xs text-foreground/90">{model.name}</span>
      {hasDetails ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className="shrink-0 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                aria-label={`Details for ${model.name}`}
              />
            }
          >
            <InfoIcon className="size-3" />
          </TooltipTrigger>
          <TooltipPopup side="top" className="max-w-56">
            <div className="space-y-1">
              <code className="block text-caption text-foreground">{model.slug}</code>
              {capLabels.length > 0 ? (
                <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                  {capLabels.map(label => (
                    <span key={label} className="text-mini text-muted-foreground">
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {model.isCustom ? (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="text-mini text-muted-foreground">custom</span>
          <button
            type="button"
            className="text-muted-foreground transition-colors hover:text-foreground"
            aria-label={`Remove ${model.slug}`}
            onClick={() => onRemove(provider, model.slug)}
          >
            <XIcon className="size-3" />
          </button>
        </div>
      ) : null}
    </div>
  )
}

interface ProviderCardHeaderProps {
  card: ProviderCardData
  providerDisplayName: string
  openProviderDetails: boolean
  onToggleDetails: (provider: ProviderKind) => void
  onToggleEnabled: (provider: ProviderKind, enabled: boolean) => void
  onResetProvider: (provider: ProviderKind) => void
}

function ProviderCardResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Reset ${label} to default`}
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
            onClick={event => {
              event.stopPropagation()
              onClick()
            }}
          />
        }
      />
      <TooltipPopup side="top">Reset to default</TooltipPopup>
    </Tooltip>
  )
}

function ProviderCardHeader({
  card,
  providerDisplayName,
  openProviderDetails,
  onToggleDetails,
  onToggleEnabled,
  onResetProvider,
}: ProviderCardHeaderProps) {
  return (
    <div className="px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <span className={cn('size-2 shrink-0 rounded-full', card.statusStyle.dot)} />
            <h3 className="text-sm font-medium text-foreground">{providerDisplayName}</h3>
            {card.versionLabel ? (
              <code className="text-xs text-muted-foreground">{card.versionLabel}</code>
            ) : null}
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {card.isDirty ? (
                <ProviderCardResetButton
                  label={`${providerDisplayName} provider settings`}
                  onClick={() => onResetProvider(card.provider)}
                />
              ) : null}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            {card.summary.headline}
            {card.summary.detail ? ` - ${card.summary.detail}` : null}
          </p>
          <ProviderCardConfiguredProviders
            configuredProviders={card.liveProvider?.auth.configuredProviders}
          />
        </div>
        <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => onToggleDetails(card.provider)}
            aria-label={`Toggle ${providerDisplayName} details`}
          >
            <ChevronDownIcon
              className={cn('size-3.5 transition-transform', openProviderDetails && 'rotate-180')}
            />
          </Button>
          <Switch
            checked={card.providerConfig.enabled}
            onCheckedChange={checked => onToggleEnabled(card.provider, Boolean(checked))}
            aria-label={`Enable ${providerDisplayName}`}
          />
        </div>
      </div>
    </div>
  )
}

interface ProviderCardBodyProps extends ProviderModelCallbacks {
  card: ProviderCardData
  codexHomePath: string
  customModelInput: string
  customModelError: string | null
}

function ProviderCardBody({
  card,
  codexHomePath,
  customModelInput,
  customModelError,
  onBinaryPathChange,
  onCodexHomePathChange,
  onCustomModelInputChange,
  onCustomModelInputKeyDown,
  onAddCustomModel,
  onHiddenModelSlugsChange,
  onRemoveCustomModel,
  onSetModelListRef,
}: ProviderCardBodyProps) {
  const providerDisplayName = PROVIDER_DISPLAY_NAMES[card.provider] ?? card.title
  return (
    <div className="space-y-0">
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <label htmlFor={`provider-install-${card.provider}-binary-path`} className="block">
          <span className="text-xs font-medium text-foreground">
            {providerDisplayName} binary path
          </span>
          <Input
            id={`provider-install-${card.provider}-binary-path`}
            className="mt-1.5"
            value={card.binaryPathValue}
            onChange={event => onBinaryPathChange(card.provider, event.target.value)}
            placeholder={card.binaryPlaceholder}
            spellCheck={false}
          />
          <span className="mt-1 block text-xs text-muted-foreground">{card.binaryDescription}</span>
        </label>
      </div>
      {card.homePathKey ? (
        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
          <label htmlFor={`provider-install-${card.homePathKey}`} className="block">
            <span className="text-xs font-medium text-foreground">CODEX_HOME path</span>
            <Input
              id={`provider-install-${card.homePathKey}`}
              className="mt-1.5"
              value={codexHomePath}
              onChange={event => onCodexHomePathChange(event.target.value)}
              placeholder={card.homePlaceholder}
              spellCheck={false}
            />
            {card.homeDescription ? (
              <span className="mt-1 block text-xs text-muted-foreground">
                {card.homeDescription}
              </span>
            ) : null}
          </label>
        </div>
      ) : null}
      <div className="border-t border-border/60 px-4 py-3 sm:px-5">
        <ProviderModelList
          card={card}
          customModelInput={customModelInput}
          customModelError={customModelError}
          onCustomModelInputChange={onCustomModelInputChange}
          onCustomModelInputKeyDown={onCustomModelInputKeyDown}
          onAddCustomModel={onAddCustomModel}
          onHiddenModelSlugsChange={onHiddenModelSlugsChange}
          onRemoveCustomModel={onRemoveCustomModel}
          onSetModelListRef={onSetModelListRef}
        />
      </div>
    </div>
  )
}

type ProviderModelListProps = Pick<
  ProviderModelCallbacks,
  | 'onCustomModelInputChange'
  | 'onCustomModelInputKeyDown'
  | 'onAddCustomModel'
  | 'onHiddenModelSlugsChange'
  | 'onRemoveCustomModel'
  | 'onSetModelListRef'
> & {
  card: ProviderCardData
  customModelInput: string
  customModelError: string | null
}

function ProviderModelList({
  card,
  customModelInput,
  customModelError,
  onCustomModelInputChange,
  onCustomModelInputKeyDown,
  onAddCustomModel,
  onHiddenModelSlugsChange,
  onRemoveCustomModel,
  onSetModelListRef,
}: ProviderModelListProps) {
  return (
    <>
      <div className="text-xs font-medium text-foreground">Models</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {card.models.length} model{card.models.length === 1 ? '' : 's'} available.
      </div>
      <div
        ref={el => onSetModelListRef(card.provider, el)}
        className="mt-2 max-h-40 overflow-y-auto pb-1"
      >
        {card.models.map(model => (
          <ProviderModelRow
            key={`${card.provider}:${model.slug}`}
            provider={card.provider}
            model={model}
            onRemove={onRemoveCustomModel}
          />
        ))}
      </div>
      {card.provider === 'opencode' ? (
        <OpencodeModelVisibilitySection
          models={card.models}
          hiddenModelSlugs={card.providerConfig.hiddenModelSlugs ?? []}
          onHiddenModelSlugsChange={hiddenModelSlugs =>
            onHiddenModelSlugsChange(card.provider, hiddenModelSlugs)
          }
        />
      ) : null}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Input
          id={`custom-model-${card.provider}`}
          value={customModelInput}
          onChange={event => onCustomModelInputChange(card.provider, event.target.value)}
          onKeyDown={event => onCustomModelInputKeyDown(card.provider, event.key)}
          placeholder={
            card.provider === 'codex'
              ? 'gpt-6.7-codex-ultra-preview'
              : card.provider === 'opencode'
                ? 'anthropic/claude-sonnet-4-5'
                : 'claude-sonnet-5-0'
          }
          spellCheck={false}
        />
        <Button
          className="shrink-0"
          variant="outline"
          onClick={() => onAddCustomModel(card.provider)}
        >
          <PlusIcon className="size-3.5" />
          Add
        </Button>
      </div>
      {customModelError ? (
        <p className="mt-2 text-xs text-destructive">{customModelError}</p>
      ) : null}
    </>
  )
}

export function ProviderCard({
  card,
  codexHomePath,
  customModelInput,
  customModelError,
  openProviderDetails,
  onToggleDetails,
  onToggleEnabled,
  onBinaryPathChange,
  onCodexHomePathChange,
  onCustomModelInputChange,
  onCustomModelInputKeyDown,
  onAddCustomModel,
  onHiddenModelSlugsChange,
  onRemoveCustomModel,
  onResetProvider,
  onSetModelListRef,
}: ProviderCardProps) {
  const providerDisplayName = PROVIDER_DISPLAY_NAMES[card.provider] ?? card.title

  return (
    <div className="border-t border-border first:border-t-0">
      <ProviderCardHeader
        card={card}
        providerDisplayName={providerDisplayName}
        openProviderDetails={openProviderDetails}
        onToggleDetails={onToggleDetails}
        onToggleEnabled={onToggleEnabled}
        onResetProvider={onResetProvider}
      />
      <Collapsible
        open={openProviderDetails}
        onOpenChange={open => {
          if (open !== openProviderDetails) onToggleDetails(card.provider)
        }}
      >
        <CollapsibleContent>
          <ProviderCardBody
            card={card}
            codexHomePath={codexHomePath}
            customModelInput={customModelInput}
            customModelError={customModelError}
            onBinaryPathChange={onBinaryPathChange}
            onCodexHomePathChange={onCodexHomePathChange}
            onCustomModelInputChange={onCustomModelInputChange}
            onCustomModelInputKeyDown={onCustomModelInputKeyDown}
            onAddCustomModel={onAddCustomModel}
            onHiddenModelSlugsChange={onHiddenModelSlugsChange}
            onRemoveCustomModel={onRemoveCustomModel}
            onSetModelListRef={onSetModelListRef}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

// ProvidersSectionHeader - header action for the Providers SettingsSection

function useRelativeTimeTick(intervalMs = 1_000) {
  const [tick, setTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return tick
}

function ProviderLastChecked({ lastCheckedAt }: { lastCheckedAt: string | null }) {
  useRelativeTimeTick()
  const lastCheckedRelative = lastCheckedAt ? formatRelativeTime(lastCheckedAt) : null

  if (!lastCheckedRelative) {
    return null
  }

  return (
    <span className="text-caption text-muted-foreground/60">
      {lastCheckedRelative.suffix ? (
        <>
          Checked <span className="font-mono tabular-nums">{lastCheckedRelative.value}</span>{' '}
          {lastCheckedRelative.suffix}
        </>
      ) : (
        <>Checked {lastCheckedRelative.value}</>
      )}
    </span>
  )
}

interface ProvidersSectionHeaderProps {
  lastCheckedAt: string | null
  isRefreshing: boolean
  onRefresh: () => void
}

export function ProvidersSectionHeader({
  lastCheckedAt,
  isRefreshing,
  onRefresh,
}: ProvidersSectionHeaderProps): ReactNode {
  return (
    <div className="flex items-center gap-1.5">
      <ProviderLastChecked lastCheckedAt={lastCheckedAt} />
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost"
              className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
              disabled={isRefreshing}
              onClick={() => void onRefresh()}
              aria-label="Refresh provider status"
            >
              {isRefreshing ? (
                <LoaderIcon className="size-3 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-3" />
              )}
            </Button>
          }
        />
        <TooltipPopup side="top">Refresh provider status</TooltipPopup>
      </Tooltip>
    </div>
  )
}
