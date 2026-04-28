import { isElectron } from '../../env'
import { Button } from '../ui/button'
import { ProviderCard, ProvidersSectionHeader } from './ProviderCard'
import {
  PROVIDER_STATUS_STYLES,
  getProviderSummary,
  getProviderVersionLabel,
} from './providerCardLogic'
import {
  AboutVersionRow,
  DesktopUpdateChannelRow,
  StaticAboutVersionRow,
} from './AboutVersionSection'
import { AppearanceSection } from './AppearanceSection'
import { GeneralSection } from './GeneralSection'
import { SettingsSection, SettingsRow, SettingsPageContainer } from './settingsLayout'
import { PROVIDER_SETTINGS } from './providerSettings'
import { useGeneralSettingsPanel } from './useGeneralSettingsPanel'
import { DEFAULT_UNIFIED_SETTINGS } from '@orxa-code/contracts/settings'
import { Equal } from 'effect'
import type { ProviderCardData } from './ProviderCard'
import type { ProviderKind } from '@orxa-code/contracts'
import { useSettings } from '../../hooks/useSettings'
import { useServerProviders } from '../../rpc/serverState'
import { CursorIcon, Gemini, type Icon } from '../Icons'
import { cn } from '../../lib/utils'

function buildProviderCards(
  settings: ReturnType<typeof useSettings>,
  serverProviders: ReturnType<typeof useServerProviders>
): ProviderCardData[] {
  return PROVIDER_SETTINGS.map(providerSettings => {
    const liveProvider = serverProviders.find(c => c.provider === providerSettings.provider)
    const providerConfig = settings.providers[providerSettings.provider]
    const defaultProviderConfig = DEFAULT_UNIFIED_SETTINGS.providers[providerSettings.provider]
    const statusKey = liveProvider?.status ?? (providerConfig.enabled ? 'warning' : 'disabled')
    const summary = getProviderSummary(liveProvider)
    const models =
      liveProvider?.models ??
      providerConfig.customModels.map(slug => ({
        slug,
        name: slug,
        isCustom: true as const,
        capabilities: null,
      }))
    return {
      provider: providerSettings.provider,
      title: providerSettings.title,
      binaryPlaceholder: providerSettings.binaryPlaceholder,
      binaryDescription: providerSettings.binaryDescription,
      homePathKey: providerSettings.homePathKey,
      homePlaceholder: providerSettings.homePlaceholder,
      homeDescription: providerSettings.homeDescription,
      binaryPathValue: providerConfig.binaryPath,
      isDirty: !Equal.equals(providerConfig, defaultProviderConfig),
      liveProvider,
      models,
      providerConfig,
      statusStyle: PROVIDER_STATUS_STYLES[statusKey],
      summary,
      versionLabel: getProviderVersionLabel(liveProvider?.version),
    }
  })
}

interface ProvidersSectionProps {
  panel: ReturnType<typeof useGeneralSettingsPanel>
  providerCards: ProviderCardData[]
  lastCheckedAt: string | null
}

function getLastCheckedAt(serverProviders: ReturnType<typeof useServerProviders>): string | null {
  return serverProviders.length > 0
    ? serverProviders.reduce(
        (latest, p) => (p.checkedAt > latest ? p.checkedAt : latest),
        serverProviders[0]!.checkedAt
      )
    : null
}

function ProvidersSectionBlock({ panel, providerCards, lastCheckedAt }: ProvidersSectionProps) {
  const {
    settings,
    openProviderDetails,
    setOpenProviderDetails,
    customModelInputByProvider,
    setCustomModelInputByProvider,
    customModelErrorByProvider,
    isRefreshingProviders,
    modelListRefs,
    refreshProviders,
    addCustomModel,
    handleHiddenModelSlugsChange,
    removeCustomModel,
    handleToggleEnabled,
    handleBinaryPathChange,
    handleCodexHomePathChange,
    handleResetProvider,
  } = panel
  return (
    <SettingsSection
      title="Providers"
      headerAction={
        <ProvidersSectionHeader
          lastCheckedAt={lastCheckedAt}
          isRefreshing={isRefreshingProviders}
          onRefresh={refreshProviders}
        />
      }
    >
      {providerCards.map(card => (
        <ProviderCard
          key={card.provider}
          card={card}
          codexHomePath={settings.providers.codex.homePath}
          customModelInput={customModelInputByProvider[card.provider]}
          customModelError={customModelErrorByProvider[card.provider] ?? null}
          openProviderDetails={openProviderDetails[card.provider]}
          onToggleDetails={(provider: ProviderKind) =>
            setOpenProviderDetails(e => ({ ...e, [provider]: !e[provider] }))
          }
          onToggleEnabled={handleToggleEnabled}
          onBinaryPathChange={handleBinaryPathChange}
          onCodexHomePathChange={handleCodexHomePathChange}
          onCustomModelInputChange={(provider, value) =>
            setCustomModelInputByProvider(e => ({ ...e, [provider]: value }))
          }
          onCustomModelInputKeyDown={(provider, key) => {
            if (key === 'Enter') addCustomModel(provider)
          }}
          onAddCustomModel={addCustomModel}
          onHiddenModelSlugsChange={handleHiddenModelSlugsChange}
          onRemoveCustomModel={removeCustomModel}
          onResetProvider={handleResetProvider}
          onSetModelListRef={(provider, el) => {
            modelListRefs.current[provider] = el
          }}
        />
      ))}
    </SettingsSection>
  )
}

const COMING_SOON_PROVIDER_CARDS: ReadonlyArray<{
  label: string
  description: string
  icon: Icon
}> = [
  {
    label: 'Cursor',
    description: 'Cursor Agent CLI integration.',
    icon: CursorIcon,
  },
  {
    label: 'Gemini',
    description: 'Google Gemini provider integration.',
    icon: Gemini,
  },
]

function ComingSoonProvidersBlock() {
  return (
    <SettingsSection title="Coming Soon">
      <div className="grid gap-3 sm:grid-cols-2">
        {COMING_SOON_PROVIDER_CARDS.map(entry => (
          <div
            key={entry.label}
            aria-disabled
            className={cn(
              'rounded-xl border border-border/70 bg-card px-4 py-4 opacity-70',
              'cursor-not-allowed'
            )}
          >
            <div className="flex items-start gap-3">
              <entry.icon aria-hidden className="mt-0.5 size-8 shrink-0 text-foreground/85" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">{entry.label}</h3>
                  <span className="rounded-full border border-border/70 px-2 py-0.5 text-mini uppercase tracking-wide text-muted-foreground">
                    Coming soon
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{entry.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}

interface AdvancedSettingsProps {
  keybindingsConfigPath: string | null
  openKeybindingsError: string | null
  isOpeningKeybindings: boolean
  openKeybindingsFile: () => void
}

function AdvancedSettingsBlock({
  keybindingsConfigPath,
  openKeybindingsError,
  isOpeningKeybindings,
  openKeybindingsFile,
}: AdvancedSettingsProps) {
  return (
    <SettingsSection title="Advanced">
      <SettingsRow
        title="Keybindings"
        description="Open the persisted `keybindings.json` file to edit advanced bindings directly."
        status={
          <>
            <span className="block break-all font-mono text-caption text-foreground">
              {keybindingsConfigPath ?? 'Resolving keybindings path...'}
            </span>
            {openKeybindingsError ? (
              <span className="mt-1 block text-destructive">{openKeybindingsError}</span>
            ) : (
              <span className="mt-1 block">Opens in your preferred editor.</span>
            )}
          </>
        }
        control={
          <Button
            size="xs"
            variant="outline"
            disabled={!keybindingsConfigPath || isOpeningKeybindings}
            onClick={openKeybindingsFile}
          >
            {isOpeningKeybindings ? 'Opening...' : 'Open file'}
          </Button>
        }
      />
    </SettingsSection>
  )
}

function AboutSettingsBlock() {
  return (
    <SettingsSection title="About">
      {isElectron ? (
        <>
          <AboutVersionRow SettingsRowComponent={SettingsRow} />
          <DesktopUpdateChannelRow SettingsRowComponent={SettingsRow} />
        </>
      ) : (
        <StaticAboutVersionRow SettingsRowComponent={SettingsRow} />
      )}
    </SettingsSection>
  )
}

export function AppearanceSettingsPanel() {
  const panel = useGeneralSettingsPanel()
  const {
    theme,
    resolvedTheme,
    lightPresetId,
    darkPresetId,
    uiFont,
    codeFont,
    setTheme,
    setPreset,
    setUiFont,
    setCodeFont,
    resetPresets,
    settings,
    updateSettings,
  } = panel

  return (
    <SettingsPageContainer>
      <AppearanceSection
        theme={theme}
        resolvedTheme={resolvedTheme}
        lightPresetId={lightPresetId}
        darkPresetId={darkPresetId}
        uiFont={uiFont}
        codeFont={codeFont}
        setTheme={setTheme}
        setPreset={setPreset}
        setUiFont={setUiFont}
        setCodeFont={setCodeFont}
        resetPresets={resetPresets}
        settings={settings}
        updateSettings={updateSettings}
      />
    </SettingsPageContainer>
  )
}

export function GeneralSettingsPanel() {
  const panel = useGeneralSettingsPanel()
  const {
    settings,
    updateSettings,
    serverProviders,
    textGenProvider,
    textGenModel,
    textGenModelOptions,
    gitModelOptionsByProvider,
    isGitWritingModelDirty,
  } = panel

  return (
    <SettingsPageContainer>
      <GeneralSection
        settings={settings}
        updateSettings={updateSettings}
        isGitWritingModelDirty={isGitWritingModelDirty}
        textGenProvider={textGenProvider}
        textGenModel={textGenModel}
        textGenModelOptions={textGenModelOptions}
        gitModelOptionsByProvider={gitModelOptionsByProvider}
        serverProviders={serverProviders}
      />
    </SettingsPageContainer>
  )
}

export function ProvidersSettingsPanel() {
  const panel = useGeneralSettingsPanel()
  const providerCards = buildProviderCards(panel.settings, panel.serverProviders)
  const lastCheckedAt = getLastCheckedAt(panel.serverProviders)

  return (
    <SettingsPageContainer>
      <ProvidersSectionBlock
        panel={panel}
        providerCards={providerCards}
        lastCheckedAt={lastCheckedAt}
      />
      <ComingSoonProvidersBlock />
    </SettingsPageContainer>
  )
}

export function AdvancedSettingsPanel() {
  const panel = useGeneralSettingsPanel()

  return (
    <SettingsPageContainer>
      <AdvancedSettingsBlock
        keybindingsConfigPath={panel.keybindingsConfigPath ?? null}
        openKeybindingsError={panel.openKeybindingsError}
        isOpeningKeybindings={panel.isOpeningKeybindings}
        openKeybindingsFile={panel.openKeybindingsFile}
      />
    </SettingsPageContainer>
  )
}

export function AboutSettingsPanel() {
  return (
    <SettingsPageContainer>
      <AboutSettingsBlock />
    </SettingsPageContainer>
  )
}

