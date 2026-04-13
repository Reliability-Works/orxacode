import type { ComponentType } from 'react'
import {
  ArchiveIcon,
  InfoIcon,
  PaletteIcon,
  Plug2Icon,
  Settings2Icon,
  SlidersHorizontalIcon,
} from 'lucide-react'

export type SettingsSectionPath =
  | '/settings/general'
  | '/settings/appearance'
  | '/settings/providers'
  | '/settings/advanced'
  | '/settings/about'
  | '/settings/archived'

export const SETTINGS_NAV_ITEMS: ReadonlyArray<{
  label: string
  to: SettingsSectionPath
  icon: ComponentType<{ className?: string }>
}> = [
  { label: 'General', to: '/settings/general', icon: SlidersHorizontalIcon },
  { label: 'Appearance', to: '/settings/appearance', icon: PaletteIcon },
  { label: 'Providers', to: '/settings/providers', icon: Plug2Icon },
  { label: 'Advanced', to: '/settings/advanced', icon: Settings2Icon },
  { label: 'About', to: '/settings/about', icon: InfoIcon },
  { label: 'Archive', to: '/settings/archived', icon: ArchiveIcon },
]
