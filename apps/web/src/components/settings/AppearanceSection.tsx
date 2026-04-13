import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { APP_BASE_NAME } from '../../branding'
import { useSettings, useUpdateSettings } from '../../hooks/useSettings'
import { DEFAULT_UNIFIED_SETTINGS, type UiScale } from '@orxa-code/contracts/settings'
import type { Theme } from '../../hooks/useTheme'
import { UI_FONT_OPTIONS, CODE_FONT_OPTIONS } from '../../hooks/useTheme'
import { LIGHT_PRESETS, DARK_PRESETS } from '../../themes/presets'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/select'
import { SettingsSection, SettingsRow, SettingResetButton } from './settingsLayout'

const TIMESTAMP_FORMAT_LABELS = {
  locale: 'System default',
  '12-hour': '12-hour',
  '24-hour': '24-hour',
} as const

const UI_SCALE_OPTIONS: ReadonlyArray<{ value: UiScale; label: string }> = [
  { value: 'small', label: 'Small' },
  { value: 'default', label: 'Default' },
  { value: 'large', label: 'Large' },
]

export interface AppearanceSectionProps {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  lightPresetId: string
  darkPresetId: string
  uiFont: string
  codeFont: string
  setTheme: (theme: Theme) => void
  setPreset: (mode: 'light' | 'dark', presetId: string) => void
  setUiFont: (fontId: string) => void
  setCodeFont: (fontId: string) => void
  resetPresets: () => void
  settings: ReturnType<typeof useSettings>
  updateSettings: ReturnType<typeof useUpdateSettings>['updateSettings']
}

const MODE_OPTIONS: Array<{ value: Theme; label: string; icon: typeof SunIcon }> = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
]

function ModeRow({ theme, setTheme }: Pick<AppearanceSectionProps, 'theme' | 'setTheme'>) {
  return (
    <SettingsRow
      title="Mode"
      description={`Controls whether ${APP_BASE_NAME} uses a light or dark color scheme.`}
      resetAction={
        theme !== 'system' ? (
          <SettingResetButton label="mode" onClick={() => setTheme('system')} />
        ) : null
      }
      control={
        <div className="inline-flex items-center rounded-lg border border-border bg-muted/50 p-0.5">
          {MODE_OPTIONS.map(option => {
            const isActive = theme === option.value
            const Icon = option.icon
            return (
              <button
                key={option.value}
                type="button"
                aria-label={`${option.label} mode`}
                aria-pressed={isActive}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setTheme(option.value)}
              >
                <Icon className="size-3.5" />
                {option.label}
              </button>
            )
          })}
        </div>
      }
    />
  )
}

function LightPresetRow({
  lightPresetId,
  setPreset,
}: Pick<AppearanceSectionProps, 'lightPresetId' | 'setPreset'>) {
  return (
    <SettingsRow
      title="Light theme"
      description="Color palette used in light mode."
      resetAction={
        lightPresetId !== 'default' ? (
          <SettingResetButton label="light theme" onClick={() => setPreset('light', 'default')} />
        ) : null
      }
      control={
        <Select
          value={lightPresetId}
          onValueChange={value => {
            if (value) setPreset('light', value)
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="Light theme preset">
            <SelectValue>
              {LIGHT_PRESETS.find(p => p.id === lightPresetId)?.name ?? 'Default'}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {LIGHT_PRESETS.map(preset => (
              <SelectItem hideIndicator key={preset.id} value={preset.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block size-3 rounded-full border border-black/10"
                    style={{ backgroundColor: preset.vars['--primary'] || '#6c7bff' }}
                  />
                  {preset.name}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  )
}

function DarkPresetRow({
  darkPresetId,
  setPreset,
}: Pick<AppearanceSectionProps, 'darkPresetId' | 'setPreset'>) {
  return (
    <SettingsRow
      title="Dark theme"
      description="Color palette used in dark mode."
      resetAction={
        darkPresetId !== 'default' ? (
          <SettingResetButton label="dark theme" onClick={() => setPreset('dark', 'default')} />
        ) : null
      }
      control={
        <Select
          value={darkPresetId}
          onValueChange={value => {
            if (value) setPreset('dark', value)
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="Dark theme preset">
            <SelectValue>
              {DARK_PRESETS.find(p => p.id === darkPresetId)?.name ?? 'Default'}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {DARK_PRESETS.map(preset => (
              <SelectItem hideIndicator key={preset.id} value={preset.id}>
                <span className="flex items-center gap-2">
                  <span
                    className="inline-block size-3 rounded-full border border-white/10"
                    style={{ backgroundColor: preset.vars['--primary'] || '#6c7bff' }}
                  />
                  {preset.name}
                </span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  )
}

function UiFontRow({ uiFont, setUiFont }: Pick<AppearanceSectionProps, 'uiFont' | 'setUiFont'>) {
  return (
    <SettingsRow
      title="Interface font"
      description="Font used for UI text. Non-system fonts must be installed locally."
      resetAction={
        uiFont !== 'system' ? (
          <SettingResetButton label="interface font" onClick={() => setUiFont('system')} />
        ) : null
      }
      control={
        <Select
          value={uiFont}
          onValueChange={value => {
            if (value) setUiFont(value)
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="Interface font">
            <SelectValue>
              {UI_FONT_OPTIONS.find(o => o.id === uiFont)?.name ?? 'System'}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {UI_FONT_OPTIONS.map(option => (
              <SelectItem hideIndicator key={option.id} value={option.id}>
                <span style={{ fontFamily: option.stack }}>{option.name}</span>
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  )
}

function CodeFontRow({
  codeFont,
  setCodeFont,
}: Pick<AppearanceSectionProps, 'codeFont' | 'setCodeFont'>) {
  return (
    <SettingsRow
      title="Code font"
      description="Font used for code, terminal output, and monospace text."
      resetAction={
        codeFont !== 'system' ? (
          <SettingResetButton label="code font" onClick={() => setCodeFont('system')} />
        ) : null
      }
      control={
        <Select
          value={codeFont}
          onValueChange={value => {
            if (value) setCodeFont(value)
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="Code font">
            <SelectValue>
              {CODE_FONT_OPTIONS.find(o => o.id === codeFont)?.name ?? 'System'}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {CODE_FONT_OPTIONS.map(option => (
              <SelectItem hideIndicator key={option.id} value={option.id}>
                <span style={{ fontFamily: option.stack }}>{option.name}</span>
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
}: Pick<AppearanceSectionProps, 'settings' | 'updateSettings'>) {
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

function UiScaleRow({
  settings,
  updateSettings,
}: Pick<AppearanceSectionProps, 'settings' | 'updateSettings'>) {
  return (
    <SettingsRow
      title="Interface scale"
      description="Adjust the overall size of text and UI elements."
      resetAction={
        settings.uiScale !== DEFAULT_UNIFIED_SETTINGS.uiScale ? (
          <SettingResetButton
            label="interface scale"
            onClick={() => updateSettings({ uiScale: DEFAULT_UNIFIED_SETTINGS.uiScale })}
          />
        ) : null
      }
      control={
        <Select
          value={settings.uiScale}
          onValueChange={value => {
            if (value === 'small' || value === 'default' || value === 'large') {
              updateSettings({ uiScale: value })
            }
          }}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="Interface scale">
            <SelectValue>
              {UI_SCALE_OPTIONS.find(o => o.value === settings.uiScale)?.label ?? 'Default'}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {UI_SCALE_OPTIONS.map(option => (
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

export function AppearanceSection(props: AppearanceSectionProps) {
  return (
    <SettingsSection title="Appearance">
      <ModeRow theme={props.theme} setTheme={props.setTheme} />
      <LightPresetRow lightPresetId={props.lightPresetId} setPreset={props.setPreset} />
      <DarkPresetRow darkPresetId={props.darkPresetId} setPreset={props.setPreset} />
      <UiFontRow uiFont={props.uiFont} setUiFont={props.setUiFont} />
      <CodeFontRow codeFont={props.codeFont} setCodeFont={props.setCodeFont} />
      <UiScaleRow settings={props.settings} updateSettings={props.updateSettings} />
      <TimeFormatRow settings={props.settings} updateSettings={props.updateSettings} />
    </SettingsSection>
  )
}
