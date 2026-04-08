import { useCallback, useRef, useState } from 'react'
import type React from 'react'
import type { ProviderKind } from '@orxa-code/contracts'
import { DEFAULT_UNIFIED_SETTINGS } from '@orxa-code/contracts/settings'
import { normalizeModelSlug } from '@orxa-code/shared/model'
import { Equal } from 'effect'
import { resolveAndPersistPreferredEditor } from '../../editorPreferences'
import { useTheme } from '../../hooks/useTheme'
import { useSettings, useUpdateSettings } from '../../hooks/useSettings'
import {
  MAX_CUSTOM_MODEL_LENGTH,
  getCustomModelOptionsByProvider,
  resolveAppModelSelectionState,
} from '../../modelSelection'
import { ensureNativeApi } from '../../nativeApi'
import {
  useServerAvailableEditors,
  useServerKeybindingsConfigPath,
  useServerProviders,
} from '../../rpc/serverState'

type Settings = ReturnType<typeof useSettings>
type UpdateSettings = ReturnType<typeof useUpdateSettings>['updateSettings']
type ServerProviders = ReturnType<typeof useServerProviders>

interface ValidateCustomModelInput {
  provider: ProviderKind
  input: string
  existingCustomModels: ReadonlyArray<string>
  serverProviders: ServerProviders
}

function validateCustomModelSlug(
  args: ValidateCustomModelInput
): { ok: true; normalized: string } | { ok: false; error: string } {
  const normalized = normalizeModelSlug(args.input, args.provider)
  if (!normalized) return { ok: false, error: 'Enter a model slug.' }
  if (
    args.serverProviders
      .find(c => c.provider === args.provider)
      ?.models.some(o => !o.isCustom && o.slug === normalized)
  )
    return { ok: false, error: 'That model is already built in.' }
  if (normalized.length > MAX_CUSTOM_MODEL_LENGTH)
    return {
      ok: false,
      error: `Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`,
    }
  if (args.existingCustomModels.includes(normalized))
    return { ok: false, error: 'That custom model is already saved.' }
  return { ok: true, normalized }
}

function scrollModelListToEnd(el: HTMLDivElement): void {
  const scrollToEnd = () => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  requestAnimationFrame(scrollToEnd)
  const observer = new MutationObserver(() => {
    scrollToEnd()
    observer.disconnect()
  })
  observer.observe(el, { childList: true, subtree: true })
  setTimeout(() => observer.disconnect(), 2_000)
}

function useCustomModelActions(
  settings: Settings,
  updateSettings: UpdateSettings,
  serverProviders: ServerProviders,
  customModelInputByProvider: Record<ProviderKind, string>,
  setCustomModelInputByProvider: React.Dispatch<React.SetStateAction<Record<ProviderKind, string>>>,
  setCustomModelErrorByProvider: React.Dispatch<
    React.SetStateAction<Partial<Record<ProviderKind, string | null>>>
  >,
  modelListRefs: React.MutableRefObject<Partial<Record<ProviderKind, HTMLDivElement | null>>>
) {
  const addCustomModel = useCallback(
    (provider: ProviderKind) => {
      const customModels = settings.providers[provider].customModels
      const result = validateCustomModelSlug({
        provider,
        input: customModelInputByProvider[provider],
        existingCustomModels: customModels,
        serverProviders,
      })
      if (!result.ok) {
        setCustomModelErrorByProvider(e => ({ ...e, [provider]: result.error }))
        return
      }
      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...settings.providers[provider],
            customModels: [...customModels, result.normalized],
          },
        },
      })
      setCustomModelInputByProvider(e => ({ ...e, [provider]: '' }))
      setCustomModelErrorByProvider(e => ({ ...e, [provider]: null }))
      const el = modelListRefs.current[provider]
      if (el) scrollModelListToEnd(el)
    },
    [
      customModelInputByProvider,
      modelListRefs,
      serverProviders,
      settings,
      updateSettings,
      setCustomModelErrorByProvider,
      setCustomModelInputByProvider,
    ]
  )

  const removeCustomModel = useCallback(
    (provider: ProviderKind, slug: string) => {
      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: {
            ...settings.providers[provider],
            customModels: settings.providers[provider].customModels.filter(m => m !== slug),
          },
        },
      })
      setCustomModelErrorByProvider(e => ({ ...e, [provider]: null }))
    },
    [settings, updateSettings, setCustomModelErrorByProvider]
  )

  return { addCustomModel, removeCustomModel }
}

function useProviderSettingsActions(
  settings: Settings,
  updateSettings: UpdateSettings,
  textGenProvider: ProviderKind
) {
  const handleToggleEnabled = useCallback(
    (provider: ProviderKind, checked: boolean) => {
      const shouldClearModelSelection = !checked && textGenProvider === provider
      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: { ...settings.providers[provider], enabled: checked },
        },
        ...(shouldClearModelSelection
          ? { textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection }
          : {}),
      })
    },
    [settings, textGenProvider, updateSettings]
  )

  const handleBinaryPathChange = useCallback(
    (provider: ProviderKind, value: string) => {
      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: { ...settings.providers[provider], binaryPath: value },
        },
      })
    },
    [settings, updateSettings]
  )

  const handleCodexHomePathChange = useCallback(
    (value: string) => {
      updateSettings({
        providers: {
          ...settings.providers,
          codex: { ...settings.providers.codex, homePath: value },
        },
      })
    },
    [settings, updateSettings]
  )

  const handleResetProvider = useCallback(
    (provider: ProviderKind) => {
      updateSettings({
        providers: {
          ...settings.providers,
          [provider]: DEFAULT_UNIFIED_SETTINGS.providers[provider],
        },
      })
    },
    [settings, updateSettings]
  )

  return {
    handleToggleEnabled,
    handleBinaryPathChange,
    handleCodexHomePathChange,
    handleResetProvider,
  }
}

function useGeneralSettingsPanelState(settings: Settings) {
  const [isOpeningKeybindings, setIsOpeningKeybindings] = useState(false)
  const [openKeybindingsError, setOpenKeybindingsError] = useState<string | null>(null)
  const [openProviderDetails, setOpenProviderDetails] = useState<Record<ProviderKind, boolean>>({
    codex: Boolean(
      settings.providers.codex.binaryPath !== DEFAULT_UNIFIED_SETTINGS.providers.codex.binaryPath ||
      settings.providers.codex.homePath !== DEFAULT_UNIFIED_SETTINGS.providers.codex.homePath ||
      settings.providers.codex.customModels.length > 0
    ),
    claudeAgent: Boolean(
      settings.providers.claudeAgent.binaryPath !==
        DEFAULT_UNIFIED_SETTINGS.providers.claudeAgent.binaryPath ||
      settings.providers.claudeAgent.customModels.length > 0
    ),
  })
  const [customModelInputByProvider, setCustomModelInputByProvider] = useState<
    Record<ProviderKind, string>
  >({ codex: '', claudeAgent: '' })
  const [customModelErrorByProvider, setCustomModelErrorByProvider] = useState<
    Partial<Record<ProviderKind, string | null>>
  >({})
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false)
  const refreshingRef = useRef(false)
  const modelListRefs = useRef<Partial<Record<ProviderKind, HTMLDivElement | null>>>({})
  return {
    isOpeningKeybindings,
    setIsOpeningKeybindings,
    openKeybindingsError,
    setOpenKeybindingsError,
    openProviderDetails,
    setOpenProviderDetails,
    customModelInputByProvider,
    setCustomModelInputByProvider,
    customModelErrorByProvider,
    setCustomModelErrorByProvider,
    isRefreshingProviders,
    setIsRefreshingProviders,
    refreshingRef,
    modelListRefs,
  }
}

function useGeneralSettingsPanelDerived(settings: Settings, serverProviders: ServerProviders) {
  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders)
  const {
    provider: textGenProvider,
    model: textGenModel,
    options: textGenModelOptions,
  } = textGenerationModelSelection
  const gitModelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    textGenProvider,
    textGenModel
  )
  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null
  )
  return {
    textGenProvider,
    textGenModel,
    textGenModelOptions,
    gitModelOptionsByProvider,
    isGitWritingModelDirty,
  }
}

type PanelState = ReturnType<typeof useGeneralSettingsPanelState>

function useRefreshProviders(state: PanelState) {
  const { refreshingRef, setIsRefreshingProviders } = state
  return useCallback(() => {
    if (refreshingRef.current) return
    refreshingRef.current = true
    setIsRefreshingProviders(true)
    void ensureNativeApi()
      .server.refreshProviders()
      .catch((e: unknown) => {
        console.warn('Failed to refresh providers', e)
      })
      .finally(() => {
        refreshingRef.current = false
        setIsRefreshingProviders(false)
      })
  }, [refreshingRef, setIsRefreshingProviders])
}

function useOpenKeybindingsFile(
  state: PanelState,
  keybindingsConfigPath: string | null,
  availableEditors: ReturnType<typeof useServerAvailableEditors>
) {
  const { setIsOpeningKeybindings, setOpenKeybindingsError } = state
  return useCallback(() => {
    if (!keybindingsConfigPath) return
    setOpenKeybindingsError(null)
    setIsOpeningKeybindings(true)
    const editor = resolveAndPersistPreferredEditor(availableEditors ?? [])
    if (!editor) {
      setOpenKeybindingsError('No available editors found.')
      setIsOpeningKeybindings(false)
      return
    }
    void ensureNativeApi()
      .shell.openInEditor(keybindingsConfigPath, editor)
      .catch(e =>
        setOpenKeybindingsError(e instanceof Error ? e.message : 'Unable to open keybindings file.')
      )
      .finally(() => setIsOpeningKeybindings(false))
  }, [availableEditors, keybindingsConfigPath, setIsOpeningKeybindings, setOpenKeybindingsError])
}

export function useGeneralSettingsPanel() {
  const { theme, setTheme } = useTheme()
  const settings = useSettings()
  const { updateSettings } = useUpdateSettings()
  const state = useGeneralSettingsPanelState(settings)
  const keybindingsConfigPath = useServerKeybindingsConfigPath()
  const availableEditors = useServerAvailableEditors()
  const serverProviders = useServerProviders()
  const derived = useGeneralSettingsPanelDerived(settings, serverProviders)
  const refreshProviders = useRefreshProviders(state)
  const openKeybindingsFile = useOpenKeybindingsFile(state, keybindingsConfigPath, availableEditors)
  const { addCustomModel, removeCustomModel } = useCustomModelActions(
    settings,
    updateSettings,
    serverProviders,
    state.customModelInputByProvider,
    state.setCustomModelInputByProvider,
    state.setCustomModelErrorByProvider,
    state.modelListRefs
  )
  const providerActions = useProviderSettingsActions(
    settings,
    updateSettings,
    derived.textGenProvider
  )
  return {
    theme,
    setTheme,
    settings,
    updateSettings,
    isOpeningKeybindings: state.isOpeningKeybindings,
    openKeybindingsError: state.openKeybindingsError,
    openProviderDetails: state.openProviderDetails,
    setOpenProviderDetails: state.setOpenProviderDetails,
    customModelInputByProvider: state.customModelInputByProvider,
    setCustomModelInputByProvider: state.setCustomModelInputByProvider,
    customModelErrorByProvider: state.customModelErrorByProvider,
    isRefreshingProviders: state.isRefreshingProviders,
    modelListRefs: state.modelListRefs,
    keybindingsConfigPath,
    serverProviders,
    textGenProvider: derived.textGenProvider,
    textGenModel: derived.textGenModel,
    textGenModelOptions: derived.textGenModelOptions,
    gitModelOptionsByProvider: derived.gitModelOptionsByProvider,
    isGitWritingModelDirty: derived.isGitWritingModelDirty,
    refreshProviders,
    openKeybindingsFile,
    addCustomModel,
    removeCustomModel,
    handleToggleEnabled: providerActions.handleToggleEnabled,
    handleBinaryPathChange: providerActions.handleBinaryPathChange,
    handleCodexHomePathChange: providerActions.handleCodexHomePathChange,
    handleResetProvider: providerActions.handleResetProvider,
  }
}
