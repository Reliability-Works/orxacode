interface FollowupDockProps {
  suggestions: string[]
  onSelect: (text: string) => void
  onDismiss?: () => void
}

const MAX_CHIP_LENGTH = 72

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text
}

export function FollowupDock({ suggestions, onSelect, onDismiss }: FollowupDockProps) {
  if (suggestions.length === 0) {
    return null
  }

  return (
    <div className="followup-dock" role="group" aria-label="Follow-up suggestions">
      <div className="followup-dock-chips">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            type="button"
            className="followup-chip"
            title={suggestion.length > MAX_CHIP_LENGTH ? suggestion : undefined}
            onClick={() => onSelect(suggestion)}
          >
            {truncate(suggestion, MAX_CHIP_LENGTH)}
          </button>
        ))}
      </div>
      {onDismiss ? (
        <button
          type="button"
          className="followup-dock-dismiss"
          aria-label="Dismiss suggestions"
          onClick={onDismiss}
        >
          &times;
        </button>
      ) : null}
    </div>
  )
}
