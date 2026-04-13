import { useState } from 'react'

import {
  buildMobileSyncDebugLogText,
  clearMobileSyncDebugEntries,
  filterMobileSyncDebugEntries,
  type MobileSyncDebugFilter,
  useMobileSyncDebugEntries,
} from '../mobileSyncDebugBuffer'
import { MobileSyncDebugEntryList, MobileSyncDebugFilterBar } from './MobileSyncDebugOverlay.parts'

const FILTER_TABS: ReadonlyArray<{
  readonly id: MobileSyncDebugFilter
  readonly label: string
}> = [
  { id: 'all', label: 'All' },
  { id: 'key', label: 'Key' },
  { id: 'errors', label: 'Errors' },
  { id: 'pair', label: 'Pair' },
  { id: 'socket', label: 'Socket' },
  { id: 'data', label: 'Data' },
]

function shouldRenderMobileSyncDebugDock() {
  if (typeof window === 'undefined' || window.desktopBridge) {
    return false
  }
  return (
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(max-width: 900px)').matches
  )
}

function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text)
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
  return Promise.resolve()
}

function MobileSyncDebugPanel(props: {
  copyStatus: 'idle' | 'copied' | 'error'
  entries: ReturnType<typeof useMobileSyncDebugEntries>
  filter: MobileSyncDebugFilter
  onClear: () => void
  onClose: () => void
  onCopy: () => void
  onFilterChange: (filter: MobileSyncDebugFilter) => void
}) {
  const visibleEntries = filterMobileSyncDebugEntries(props.entries, props.filter)

  return (
    <div className="pointer-events-auto flex max-h-[60vh] w-[min(92vw,30rem)] flex-col overflow-hidden rounded-2xl border border-border bg-background/95 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div>
          <div className="text-sm font-medium text-foreground">Mobile Sync Logs</div>
          <div className="text-xs text-muted-foreground">
            {visibleEntries.length} shown / {props.entries.length} captured
          </div>
        </div>
        <button
          type="button"
          className="rounded-lg border border-border px-2 py-1 text-xs text-foreground"
          onClick={props.onClose}
        >
          Close
        </button>
      </div>
      <div className="flex gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          className="rounded-lg border border-border px-2 py-1 text-xs text-foreground"
          onClick={props.onCopy}
        >
          {props.copyStatus === 'copied'
            ? 'Copied'
            : props.copyStatus === 'error'
              ? 'Copy failed'
              : 'Copy'}
        </button>
        <button
          type="button"
          className="rounded-lg border border-border px-2 py-1 text-xs text-foreground"
          onClick={props.onClear}
        >
          Clear
        </button>
      </div>
      <MobileSyncDebugFilterBar
        filter={props.filter}
        tabs={FILTER_TABS}
        onFilterChange={props.onFilterChange}
      />
      <MobileSyncDebugEntryList entries={visibleEntries} />
    </div>
  )
}

export function MobileSyncDebugDock() {
  const entries = useMobileSyncDebugEntries()
  const [open, setOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const [filter, setFilter] = useState<MobileSyncDebugFilter>('key')
  const filteredEntries = filterMobileSyncDebugEntries(entries, filter)
  const logText = buildMobileSyncDebugLogText(filter)

  if (!shouldRenderMobileSyncDebugDock()) {
    return null
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {open ? (
        <MobileSyncDebugPanel
          copyStatus={copyStatus}
          entries={entries}
          filter={filter}
          onClear={() => {
            clearMobileSyncDebugEntries()
            setCopyStatus('idle')
          }}
          onClose={() => setOpen(false)}
          onCopy={() => {
            void copyTextToClipboard(logText).then(
              () => setCopyStatus('copied'),
              () => setCopyStatus('error')
            )
          }}
          onFilterChange={nextFilter => {
            setFilter(nextFilter)
            setCopyStatus('idle')
          }}
        />
      ) : null}
      <button
        type="button"
        className="w-full rounded-xl border border-sidebar-border bg-sidebar px-3 py-2 text-xs font-medium text-sidebar-foreground shadow-sm"
        onClick={() => {
          setOpen(openState => !openState)
          setCopyStatus('idle')
        }}
      >
        Sync Logs ({filteredEntries.length}/{entries.length})
      </button>
    </div>
  )
}
