'use client'

import * as React from 'react'

const START_ADDON_CLASS =
  "[&_svg]:-mx-0.5 pointer-events-none absolute inset-y-0 start-px z-10 flex items-center ps-[calc(--spacing(3)-1px)] opacity-80 has-[+[data-size=sm]]:ps-[calc(--spacing(2.5)-1px)] [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4"

/** Shared start-addon overlay for input-like controls (Autocomplete, Combobox). */
export function InputStartAddon({ children, slot }: { children: React.ReactNode; slot: string }) {
  if (!children) return null
  return (
    <div aria-hidden="true" className={START_ADDON_CLASS} data-slot={slot}>
      {children}
    </div>
  )
}
