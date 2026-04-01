interface ThinkingShimmerProps {
  label?: string
}

export function ThinkingShimmer({ label = 'Thinking' }: ThinkingShimmerProps) {
  return (
    <div className="thinking-shimmer" aria-label={label} aria-live="polite">
      <span className="thinking-shimmer-text">{label}...</span>
    </div>
  )
}
