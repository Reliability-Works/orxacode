import { DEFAULT_UNIFIED_SETTINGS } from '@orxa-code/contracts/settings'
import { Equal } from 'effect'
import { useCallback, useMemo } from 'react'

import { ensureNativeApi, readNativeApi } from '../../nativeApi'
import { useTheme } from '../../hooks/useTheme'
import { useSettings, useUpdateSettings } from '../../hooks/useSettings'
import { PROVIDER_SETTINGS } from './providerSettings'

export function useSettingsRestore(onRestored?: () => void) {
  const { theme, setTheme } = useTheme()
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
    () => [
      ...(theme !== 'system' ? ['Theme'] : []),
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
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? ['Archive confirmation']
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? ['Delete confirmation']
        : []),
      ...(isGitWritingModelDirty ? ['Git writing model'] : []),
      ...(areProviderSettingsDirty ? ['Providers'] : []),
    ],
    [
      areProviderSettingsDirty,
      isGitWritingModelDirty,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.defaultThreadEnvMode,
      settings.diffWordWrap,
      settings.enableAssistantStreaming,
      settings.timestampFormat,
      theme,
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
    resetSettings()
    onRestored?.()
  }, [changedSettingLabels, onRestored, resetSettings, setTheme])

  return {
    changedSettingLabels,
    restoreDefaults,
  }
}
