import type { MobileSyncDebugEntry, MobileSyncDebugFilter } from '../mobileSyncDebugBuffer'

export function MobileSyncDebugFilterBar(props: {
  filter: MobileSyncDebugFilter
  tabs: ReadonlyArray<{ readonly id: MobileSyncDebugFilter; readonly label: string }>
  onFilterChange: (filter: MobileSyncDebugFilter) => void
}) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
      {props.tabs.map(tab => (
        <button
          key={tab.id}
          type="button"
          className={
            props.filter === tab.id
              ? 'rounded-lg border border-foreground/20 bg-foreground px-2 py-1 text-[11px] font-medium text-background'
              : 'rounded-lg border border-border px-2 py-1 text-[11px] text-foreground'
          }
          onClick={() => props.onFilterChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export function MobileSyncDebugEntryList(props: {
  entries: readonly MobileSyncDebugEntry[]
}) {
  return (
    <div className="overflow-auto px-3 py-2 text-[11px] leading-5 text-foreground">
      {props.entries.length === 0 ? (
        <div className="text-muted-foreground">No mobile-sync entries captured yet.</div>
      ) : (
        props.entries.map(entry => (
          <div key={entry.id} className="mb-2 last:mb-0">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {entry.level} {entry.timestamp}
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">
              {entry.text}
            </pre>
          </div>
        ))
      )}
    </div>
  )
}
