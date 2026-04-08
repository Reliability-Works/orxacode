import type { ProviderKind } from '@orxa-code/contracts'
import { DEFAULT_UNIFIED_SETTINGS } from '@orxa-code/contracts/settings'
import { APP_BASE_NAME } from '../../branding'
import { ProviderModelPicker } from '../chat/ProviderModelPicker'
import { TraitsPicker } from '../chat/TraitsPicker'
import { useSettings, useUpdateSettings } from '../../hooks/useSettings'
import {
  resolveAppModelSelectionState,
  getCustomModelOptionsByProvider,
} from '../../modelSelection'
import { useServerProviders } from '../../rpc/serverState'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { SettingsSection, SettingsRow, SettingResetButton } from './settingsLayout'

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

const TIMESTAMP_FORMAT_LABELS = {
  locale: 'System default',
  '12-hour': '12-hour',
  '24-hour': '24-hour',
} as const

type Theme = 'light' | 'dark' | 'system'

export interface GeneralSectionProps {
  theme: string
  setTheme: (theme: Theme) => void
  settings: ReturnType<typeof useSettings>
  updateSettings: ReturnType<typeof useUpdateSettings>['updateSettings']
  isGitWritingModelDirty: boolean
  textGenProvider: ProviderKind
  textGenModel: string | null
  textGenModelOptions: ReturnType<typeof resolveAppModelSelectionState>['options']
  gitModelOptionsByProvider: ReturnType<typeof getCustomModelOptionsByProvider>
  serverProviders: ReturnType<typeof useServerProviders>
}

function ThemeRow({ theme, setTheme }: Pick<GeneralSectionProps, 'theme' | 'setTheme'>) {
  return (
    <SettingsRow
      title="Theme"
      description={`Choose how ${APP_BASE_NAME} looks across the app.`}
      resetAction={
        theme !== 'system' ? (
          <SettingResetButton label="theme" onClick={() => setTheme('system')} />
        ) : null
      }
      control={
        <Select
          value={theme}
          onValueChange={value => {
            if (value === 'system' || value === 'light' || value === 'dark') setTheme(value)
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="Theme preference">
            <SelectValue>
              {THEME_OPTIONS.find(o => o.value === theme)?.label ?? 'System'}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {THEME_OPTIONS.map(option => (
              <SelectItem hideIndicator key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  )
}

function TimeFormatRow({
  settings,
  updateSettings,
}: Pick<GeneralSectionProps, 'settings' | 'updateSettings'>) {
  return (
    <SettingsRow
      title="Time format"
      description="System default follows your browser or OS clock preference."
      resetAction={
        settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
          <SettingResetButton
            label="time format"
            onClick={() =>
              updateSettings({ timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.timestampFormat}
          onValueChange={value => {
            if (value === 'locale' || value === '12-hour' || value === '24-hour') {
              updateSettings({ timestampFormat: value })
            }
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="Timestamp format">
            <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="locale">
              {TIMESTAMP_FORMAT_LABELS.locale}
            </SelectItem>
            <SelectItem hideIndicator value="12-hour">
              {TIMESTAMP_FORMAT_LABELS['12-hour']}
            </SelectItem>
            <SelectItem hideIndicator value="24-hour">
              {TIMESTAMP_FORMAT_LABELS['24-hour']}
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  )
}

function AppearanceRows({
  theme,
  setTheme,
  settings,
  updateSettings,
}: Pick<GeneralSectionProps, 'theme' | 'setTheme' | 'settings' | 'updateSettings'>) {
  return (
    <>
      <ThemeRow theme={theme} setTheme={setTheme} />
      <TimeFormatRow settings={settings} updateSettings={updateSettings} />
    </>
  )
}

function DiffWrapRow({
  settings,
  updateSettings,
}: Pick<GeneralSectionProps, 'settings' | 'updateSettings'>) {
  return (
    <SettingsRow
      title="Diff line wrapping"
      description="Set the default wrap state when the diff panel opens."
      resetAction={
        settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap ? (
          <SettingResetButton
            label="diff line wrapping"
            onClick={() => updateSettings({ diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap })}
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.diffWordWrap}
          onCheckedChange={checked => updateSettings({ diffWordWrap: Boolean(checked) })}
          aria-label="Wrap diff lines by default"
        />
      }
    />
  )
}

function AssistantStreamingRow({
  settings,
  updateSettings,
}: Pick<GeneralSectionProps, 'settings' | 'updateSettings'>) {
  return (
    <SettingsRow
      title="Assistant output"
      description="Show token-by-token output while a response is in progress."
      resetAction={
        settings.enableAssistantStreaming !== DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming ? (
          <SettingResetButton
            label="assistant output"
            onClick={() =>
              updateSettings({
                enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.enableAssistantStreaming}
          onCheckedChange={checked =>
            updateSettings({ enableAssistantStreaming: Boolean(checked) })
          }
          aria-label="Stream assistant messages"
        />
      }
    />
  )
}

function NewThreadsRow({
  settings,
  updateSettings,
}: Pick<GeneralSectionProps, 'settings' | 'updateSettings'>) {
  return (
    <SettingsRow
      title="New threads"
      description="Pick the default workspace mode for newly created draft threads."
      resetAction={
        settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ? (
          <SettingResetButton
            label="new threads"
            onClick={() =>
              updateSettings({
                defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
              })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.defaultThreadEnvMode}
          onValueChange={value => {
            if (value === 'local' || value === 'worktree')
              updateSettings({ defaultThreadEnvMode: value })
          }}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label="Default thread mode">
            <SelectValue>
              {settings.defaultThreadEnvMode === 'worktree' ? 'New worktree' : 'Local'}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value="local">
              Local
            </SelectItem>
            <SelectItem hideIndicator value="worktree">
              New worktree
            </SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  )
}

function CoreBehaviorRows({
  settings,
  updateSettings,
}: Pick<GeneralSectionProps, 'settings' | 'updateSettings'>) {
  return (
    <>
      <DiffWrapRow settings={settings} updateSettings={updateSettings} />
      <AssistantStreamingRow settings={settings} updateSettings={updateSettings} />
      <NewThreadsRow settings={settings} updateSettings={updateSettings} />
    </>
  )
}

function ThreadConfirmationRows({
  settings,
  updateSettings,
}: Pick<GeneralSectionProps, 'settings' | 'updateSettings'>) {
  return (
    <>
      <SettingsRow
        title="Archive confirmation"
        description="Require a second click on the inline archive action before a thread is archived."
        resetAction={
          settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
            <SettingResetButton
              label="archive confirmation"
              onClick={() =>
                updateSettings({
                  confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.confirmThreadArchive}
            onCheckedChange={checked => updateSettings({ confirmThreadArchive: Boolean(checked) })}
            aria-label="Confirm thread archiving"
          />
        }
      />
      <SettingsRow
        title="Delete confirmation"
        description="Ask before deleting a thread and its chat history."
        resetAction={
          settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
            <SettingResetButton
              label="delete confirmation"
              onClick={() =>
                updateSettings({
                  confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.confirmThreadDelete}
            onCheckedChange={checked => updateSettings({ confirmThreadDelete: Boolean(checked) })}
            aria-label="Confirm thread deletion"
          />
        }
      />
    </>
  )
}

function ModelRowControl({
  settings,
  updateSettings,
  textGenProvider,
  textGenModel,
  textGenModelOptions,
  gitModelOptionsByProvider,
  serverProviders,
}: Omit<GeneralSectionProps, 'theme' | 'setTheme' | 'isGitWritingModelDirty'>) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <ProviderModelPicker
        provider={textGenProvider}
        model={textGenModel ?? ''}
        lockedProvider={null}
        providers={serverProviders}
        modelOptionsByProvider={gitModelOptionsByProvider}
        triggerVariant="outline"
        triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
        onProviderModelChange={(provider, model) => {
          updateSettings({
            textGenerationModelSelection: resolveAppModelSelectionState(
              { ...settings, textGenerationModelSelection: { provider, model } },
              serverProviders
            ),
          })
        }}
      />
      <TraitsPicker
        provider={textGenProvider}
        models={serverProviders.find(p => p.provider === textGenProvider)?.models ?? []}
        model={textGenModel ?? ''}
        prompt=""
        onPromptChange={() => {}}
        modelOptions={textGenModelOptions}
        allowPromptInjectedEffort={false}
        triggerVariant="outline"
        triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
        onModelOptionsChange={nextOptions => {
          updateSettings({
            textGenerationModelSelection: resolveAppModelSelectionState(
              {
                ...settings,
                textGenerationModelSelection: {
                  provider: textGenProvider,
                  model: textGenModel ?? '',
                  ...(nextOptions ? { options: nextOptions } : {}),
                },
              },
              serverProviders
            ),
          })
        }}
      />
    </div>
  )
}

function ModelRow(props: Omit<GeneralSectionProps, 'theme' | 'setTheme'>) {
  const { updateSettings, isGitWritingModelDirty } = props
  return (
    <SettingsRow
      title="Text generation model"
      description="Configure the model used for generated commit messages, PR titles, and similar Git text."
      resetAction={
        isGitWritingModelDirty ? (
          <SettingResetButton
            label="text generation model"
            onClick={() =>
              updateSettings({
                textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
              })
            }
          />
        ) : null
      }
      control={<ModelRowControl {...props} />}
    />
  )
}

export function GeneralSection(props: GeneralSectionProps) {
  return (
    <SettingsSection title="General">
      <AppearanceRows
        theme={props.theme}
        setTheme={props.setTheme}
        settings={props.settings}
        updateSettings={props.updateSettings}
      />
      <CoreBehaviorRows settings={props.settings} updateSettings={props.updateSettings} />
      <ThreadConfirmationRows settings={props.settings} updateSettings={props.updateSettings} />
      <ModelRow
        settings={props.settings}
        updateSettings={props.updateSettings}
        isGitWritingModelDirty={props.isGitWritingModelDirty}
        textGenProvider={props.textGenProvider}
        textGenModel={props.textGenModel}
        textGenModelOptions={props.textGenModelOptions}
        gitModelOptionsByProvider={props.gitModelOptionsByProvider}
        serverProviders={props.serverProviders}
      />
    </SettingsSection>
  )
}
