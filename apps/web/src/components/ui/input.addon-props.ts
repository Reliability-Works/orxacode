import * as React from 'react'

/** Shared input addon props used by AutocompleteInput and ComboboxInput. */
export interface InputAddonProps {
  showTrigger?: boolean
  showClear?: boolean
  startAddon?: React.ReactNode
  size?: 'sm' | 'default' | 'lg' | number
  ref?: React.Ref<HTMLInputElement>
}

/** Resolves the normalized size value from an InputAddonProps size field. */
export function resolveInputSize(size: InputAddonProps['size']): 'sm' | 'default' | 'lg' | number {
  return (size ?? 'default') as 'sm' | 'default' | 'lg' | number
}
