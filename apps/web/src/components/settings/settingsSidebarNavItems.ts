import type { ComponentType } from 'react'
import { ArchiveIcon, Settings2Icon } from 'lucide-react'

export type SettingsSectionPath = '/settings/general' | '/settings/archived'

export const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  label: string
  to: SettingsSectionPath
  icon: ComponentType<{ className?: string }>
}> = [
  { label: 'General', to: '/settings/general', icon: Settings2Icon },
  { label: 'Archive', to: '/settings/archived', icon: ArchiveIcon },
]
