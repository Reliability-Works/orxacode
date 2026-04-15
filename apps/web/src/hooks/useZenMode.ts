import { useCallback, useEffect, useMemo } from 'react'
import { useSettings, useUpdateSettings } from './useSettings'
import type { TopbarButtonId } from '../components/chat/topbarButtonRegistry'

export function useZenModeShortcut() {
  const zen = useZenMode()
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'z' && event.key !== 'Z') return
      if (!(event.metaKey || event.ctrlKey)) return
      if (!event.shiftKey) return
      if (event.altKey) return
      event.preventDefault()
      zen.toggleZen()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [zen])
}

export function useZenMode() {
  const zen = useSettings(s => s.zenMode)
  const { updateSettings } = useUpdateSettings()

  const allowlist = useMemo(() => new Set(zen.topbarAllowlist), [zen.topbarAllowlist])

  const enterZen = useCallback(() => {
    updateSettings({ zenMode: { enabled: true, topbarAllowlist: zen.topbarAllowlist } })
  }, [updateSettings, zen.topbarAllowlist])

  const exitZen = useCallback(() => {
    updateSettings({ zenMode: { enabled: false, topbarAllowlist: zen.topbarAllowlist } })
  }, [updateSettings, zen.topbarAllowlist])

  const toggleZen = useCallback(() => {
    updateSettings({ zenMode: { enabled: !zen.enabled, topbarAllowlist: zen.topbarAllowlist } })
  }, [updateSettings, zen.enabled, zen.topbarAllowlist])

  const setAllowlist = useCallback(
    (next: ReadonlyArray<TopbarButtonId>) => {
      updateSettings({ zenMode: { enabled: zen.enabled, topbarAllowlist: next } })
    },
    [updateSettings, zen.enabled]
  )

  const isButtonVisible = useCallback(
    (id: TopbarButtonId) => !zen.enabled || allowlist.has(id),
    [zen.enabled, allowlist]
  )

  return {
    enabled: zen.enabled,
    allowlist,
    allowlistArray: zen.topbarAllowlist,
    enterZen,
    exitZen,
    toggleZen,
    setAllowlist,
    isButtonVisible,
  }
}
