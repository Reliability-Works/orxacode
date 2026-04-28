import { DEFAULT_UNIFIED_SETTINGS } from '@orxa-code/contracts/settings'
import { Equal } from 'effect'
import { useCallback, useMemo } from 'react'

import { ensureNativeApi, readNativeApi } from '../../nativeApi'
import { useTheme } from '../../hooks/useTheme'
import { useSettings, useUpdateSettings } from '../../hooks/useSettings'
import { PROVIDER_SETTINGS } from './providerSettings'

function computeChangedSettingLabels(
  theme: string,
  lightPresetId: string,
  darkPresetId: string,
  uiFont: string,
  codeFont: string,
  settings: ReturnType<typeof useSettings>,
  isGitWritingModelDirty: boolean,
  areProviderSettingsDirty: boolean
): string[] {
  return [
    ...(theme !== 'system' ? ['Mode'] : []),
    ...(lightPresetId !== 'default' ? ['Light theme'] : []),
    ...(darkPresetId !== 'default' ? ['Dark theme'] : []),
    ...(uiFont !== 'system' ? ['Interface font'] : []),
    ...(codeFont !== 'system' ? ['Code font'] : []),
    ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
      ? ['Time format']
      : []),
    ...(settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap
      ? ['Diff line wrapping']
      : []),
    ...(settings.enableAssistantStreaming !== DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming
      ? ['Assistant output']
      : []),
    ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
      ? ['New thread mode']
      : []),
    ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
      ? ['Delete confirmation']
      : []),
    ...(isGitWritingModelDirty ? ['Git writing model'] : []),
    ...(areProviderSettingsDirty ? ['Providers'] : []),
  ]
}

export function useSettingsRestore(onRestored?: () => void) {
  const { theme, setTheme, lightPresetId, darkPresetId, uiFont, codeFont, resetPresets } =
    useTheme()
  const settings = useSettings()
  const { resetSettings } = useUpdateSettings()

  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null
  )
  const areProviderSettingsDirty = PROVIDER_SETTINGS.some(providerSettings => {
    const currentSettings = settings.providers[providerSettings.provider]
    const defaultSettings = DEFAULT_UNIFIED_SETTINGS.providers[providerSettings.provider]
    return !Equal.equals(currentSettings, defaultSettings)
  })

  const changedSettingLabels = useMemo(
    () =>
      computeChangedSettingLabels(
        theme,
        lightPresetId,
        darkPresetId,
        uiFont,
        codeFont,
        settings,
        isGitWritingModelDirty,
        areProviderSettingsDirty
      ),
    [
      areProviderSettingsDirty,
      isGitWritingModelDirty,
      settings,
      theme,
      lightPresetId,
      darkPresetId,
      uiFont,
      codeFont,
    ]
  )

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return
    const api = readNativeApi()
    const confirmed = await (api ?? ensureNativeApi()).dialogs.confirm(
      ['Restore default settings?', `This will reset: ${changedSettingLabels.join(', ')}.`].join(
        '\n'
      )
    )
    if (!confirmed) return
    setTheme('system')
    resetPresets()
    resetSettings()
    onRestored?.()
  }, [changedSettingLabels, onRestored, resetPresets, resetSettings, setTheme])

  return { changedSettingLabels, restoreDefaults }
}
