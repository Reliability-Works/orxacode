import type { ProviderKind } from '@orxa-code/contracts'
import { DEFAULT_UNIFIED_SETTINGS } from '@orxa-code/contracts/settings'
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

export interface GeneralSectionProps {
  settings: ReturnType<typeof useSettings>
  updateSettings: ReturnType<typeof useUpdateSettings>['updateSettings']
  isGitWritingModelDirty: boolean
  textGenProvider: ProviderKind
  textGenModel: string | null
  textGenModelOptions: ReturnType<typeof resolveAppModelSelectionState>['options']
  gitModelOptionsByProvider: ReturnType<typeof getCustomModelOptionsByProvider>
  serverProviders: ReturnType<typeof useServerProviders>
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
                } as import('@orxa-code/contracts').ModelSelection,
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
