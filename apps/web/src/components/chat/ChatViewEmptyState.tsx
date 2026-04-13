import { useIsMobile } from '../../hooks/useMediaQuery'

export function ChatViewEmptyState() {
  const isMobile = useIsMobile()
  if (isMobile) {
    return <div className="min-h-0 min-w-0 flex-1 bg-background" />
  }
  return (
    <div className="flex h-svh min-w-0 flex-1 flex-col items-center justify-center gap-2 bg-background px-6 text-center text-muted-foreground/60">
      <p className="text-sm">Select a thread or create a new one to get started.</p>
      <p className="text-xs text-muted-foreground/40">
        Press{' '}
        <kbd className="rounded border border-border/70 px-1 py-0.5 font-mono text-[10px]">⇧⌘O</kbd>{' '}
        to start a new thread
      </p>
    </div>
  )
}
