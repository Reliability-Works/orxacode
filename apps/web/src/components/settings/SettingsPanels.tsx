import { ArchiveIcon, ArchiveX } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { ThreadId } from '@orxa-code/contracts'
import { isElectron } from '../../env'
import { useThreadActions } from '../../hooks/useThreadActions'
import { readNativeApi } from '../../nativeApi'
import { useStore } from '../../store'
import { formatRelativeTimeLabel } from '../../timestampFormat'
import { Button } from '../ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../ui/empty'
import { toastManager } from '../ui/toastState'
import { ProjectFavicon } from '../ProjectFavicon'
import { ProviderCard, ProvidersSectionHeader } from './ProviderCard'
import {
  PROVIDER_STATUS_STYLES,
  getProviderSummary,
  getProviderVersionLabel,
} from './providerCardLogic'
import { AboutVersionRow, StaticAboutVersionRow } from './AboutVersionSection'
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

interface AdvancedAboutProps {
  keybindingsConfigPath: string | null
  openKeybindingsError: string | null
  isOpeningKeybindings: boolean
  openKeybindingsFile: () => void
}

function AdvancedAboutBlock({
  keybindingsConfigPath,
  openKeybindingsError,
  isOpeningKeybindings,
  openKeybindingsFile,
}: AdvancedAboutProps) {
  return (
    <>
      <SettingsSection title="Advanced">
        <SettingsRow
          title="Keybindings"
          description="Open the persisted `keybindings.json` file to edit advanced bindings directly."
          status={
            <>
              <span className="block break-all font-mono text-[11px] text-foreground">
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
      <SettingsSection title="About">
        {isElectron ? (
          <AboutVersionRow SettingsRowComponent={SettingsRow} />
        ) : (
          <StaticAboutVersionRow SettingsRowComponent={SettingsRow} />
        )}
      </SettingsSection>
    </>
  )
}

export function GeneralSettingsPanel() {
  const panel = useGeneralSettingsPanel()
  const {
    theme,
    setTheme,
    settings,
    updateSettings,
    isOpeningKeybindings,
    openKeybindingsError,
    keybindingsConfigPath,
    serverProviders,
    textGenProvider,
    textGenModel,
    textGenModelOptions,
    gitModelOptionsByProvider,
    isGitWritingModelDirty,
    openKeybindingsFile,
  } = panel

  const providerCards = buildProviderCards(settings, serverProviders)
  const lastCheckedAt =
    serverProviders.length > 0
      ? serverProviders.reduce(
          (latest, p) => (p.checkedAt > latest ? p.checkedAt : latest),
          serverProviders[0]!.checkedAt
        )
      : null

  return (
    <SettingsPageContainer>
      <GeneralSection
        theme={theme}
        setTheme={setTheme}
        settings={settings}
        updateSettings={updateSettings}
        isGitWritingModelDirty={isGitWritingModelDirty}
        textGenProvider={textGenProvider}
        textGenModel={textGenModel}
        textGenModelOptions={textGenModelOptions}
        gitModelOptionsByProvider={gitModelOptionsByProvider}
        serverProviders={serverProviders}
      />
      <ProvidersSectionBlock
        panel={panel}
        providerCards={providerCards}
        lastCheckedAt={lastCheckedAt}
      />
      <AdvancedAboutBlock
        keybindingsConfigPath={keybindingsConfigPath ?? null}
        openKeybindingsError={openKeybindingsError}
        isOpeningKeybindings={isOpeningKeybindings}
        openKeybindingsFile={openKeybindingsFile}
      />
    </SettingsPageContainer>
  )
}

interface ArchivedThread {
  id: ThreadId
  title: string
  archivedAt: string | null
  createdAt: string
}

function ArchivedThreadRow({
  thread,
  onContextMenu,
  onUnarchive,
}: {
  thread: ArchivedThread
  onContextMenu: (threadId: ThreadId, position: { x: number; y: number }) => void
  onUnarchive: (threadId: ThreadId) => Promise<void>
}) {
  return (
    <div
      className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
      onContextMenu={event => {
        event.preventDefault()
        onContextMenu(thread.id, { x: event.clientX, y: event.clientY })
      }}
    >
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-medium text-foreground">{thread.title}</h3>
        <p className="text-xs text-muted-foreground">
          Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
          {' \u00b7 Created '}
          {formatRelativeTimeLabel(thread.createdAt)}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
        onClick={() =>
          void onUnarchive(thread.id).catch(error => {
            toastManager.add({
              type: 'error',
              title: 'Failed to unarchive thread',
              description: error instanceof Error ? error.message : 'An error occurred.',
            })
          })
        }
      >
        <ArchiveX className="size-3.5" />
        <span>Unarchive</span>
      </Button>
    </div>
  )
}

function useArchivedThreadsData() {
  const projects = useStore(store => store.projects)
  const threads = useStore(store => store.threads)
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions()
  const archivedGroups = useMemo(() => {
    const projectById = new Map(projects.map(project => [project.id, project] as const))
    return [...projectById.values()]
      .map(project => ({
        project,
        threads: threads
          .filter(thread => thread.projectId === project.id && thread.archivedAt !== null)
          .toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.createdAt
            const rightKey = right.archivedAt ?? right.createdAt
            return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id)
          }),
      }))
      .filter(group => group.threads.length > 0)
  }, [projects, threads])
  const handleContextMenu = useCallback(
    async (threadId: ThreadId, position: { x: number; y: number }) => {
      const api = readNativeApi()
      if (!api) return
      const clicked = await api.contextMenu.show(
        [
          { id: 'unarchive', label: 'Unarchive' },
          { id: 'delete', label: 'Delete', destructive: true },
        ],
        position
      )
      if (clicked === 'unarchive') {
        try {
          await unarchiveThread(threadId)
        } catch (error) {
          toastManager.add({
            type: 'error',
            title: 'Failed to unarchive thread',
            description: error instanceof Error ? error.message : 'An error occurred.',
          })
        }
        return
      }
      if (clicked === 'delete') await confirmAndDeleteThread(threadId)
    },
    [confirmAndDeleteThread, unarchiveThread]
  )
  return { archivedGroups, handleContextMenu, unarchiveThread }
}

function ArchivedThreadsEmpty() {
  return (
    <SettingsSection title="Archived threads">
      <Empty className="min-h-88">
        <EmptyMedia variant="icon">
          <ArchiveIcon />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>No archived threads</EmptyTitle>
          <EmptyDescription>Archived threads will appear here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </SettingsSection>
  )
}

export function ArchivedThreadsPanel() {
  const { archivedGroups, handleContextMenu, unarchiveThread } = useArchivedThreadsData()
  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <ArchivedThreadsEmpty />
      ) : (
        archivedGroups.map(({ project, threads: projectThreads }) => (
          <SettingsSection
            key={project.id}
            title={project.name}
            icon={<ProjectFavicon cwd={project.cwd} />}
          >
            {projectThreads.map(thread => (
              <ArchivedThreadRow
                key={thread.id}
                thread={thread}
                onContextMenu={handleContextMenu}
                onUnarchive={unarchiveThread}
              />
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  )
}
