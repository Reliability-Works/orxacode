import { useIsMobile } from '../../hooks/useMediaQuery'

export function ChatViewEmptyState() {
  const isMobile = useIsMobile()
  if (isMobile) {
    return <div className="min-h-0 min-w-0 flex-1 bg-background" />
  }
  return (
    <div className="flex h-svh min-w-0 flex-1 items-center justify-center bg-background px-6 text-center text-muted-foreground/40">
      <p className="text-sm">Select a thread or create a new one to get started.</p>
    </div>
  )
}
