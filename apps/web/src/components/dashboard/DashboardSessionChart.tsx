import type { DashboardSnapshot } from '@orxa-code/contracts'

const CHART_HEIGHT = 64
const BAR_MIN_HEIGHT = 2

function formatDayLabel(day: string): string {
  const date = new Date(`${day}T00:00:00`)
  return date.toLocaleDateString(undefined, { weekday: 'short' })
}

interface BarProps {
  day: string
  sessions: number
  maxSessions: number
  isToday: boolean
}

function Bar({ day, sessions, maxSessions, isToday }: BarProps) {
  const ratio = maxSessions > 0 ? sessions / maxSessions : 0
  const barHeight = Math.max(BAR_MIN_HEIGHT, Math.round(ratio * CHART_HEIGHT))
  const label = formatDayLabel(day)

  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <span className="text-mini tabular-nums text-muted-foreground/70">{sessions || ''}</span>
      <div className="flex w-full flex-1 items-end">
        <div
          className="w-full rounded-sm transition-all"
          style={{ height: `${barHeight}px` }}
          aria-label={`${sessions} sessions on ${day}`}
          title={`${sessions} sessions`}
        >
          <div
            className={
              isToday
                ? 'h-full w-full rounded-sm bg-primary/80'
                : 'h-full w-full rounded-sm bg-muted-foreground/25 hover:bg-muted-foreground/40 transition-colors'
            }
          />
        </div>
      </div>
      <span
        className={`text-mini ${isToday ? 'font-semibold text-foreground' : 'text-muted-foreground/70'}`}
      >
        {label}
      </span>
    </div>
  )
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

interface DashboardSessionChartProps {
  daySeries: DashboardSnapshot['daySeries']
}

export function DashboardSessionChart({ daySeries }: DashboardSessionChartProps) {
  const today = todayKey()
  const maxSessions = Math.max(...daySeries.map(p => p.sessions), 1)

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Sessions (last 7 days)</span>
      <div
        className="flex gap-1.5"
        style={{ height: `${CHART_HEIGHT + 36}px` }}
        role="img"
        aria-label="Sessions per day bar chart"
      >
        {daySeries.map(point => (
          <Bar
            key={point.day}
            day={point.day}
            sessions={point.sessions}
            maxSessions={maxSessions}
            isToday={point.day === today}
          />
        ))}
      </div>
    </div>
  )
}
