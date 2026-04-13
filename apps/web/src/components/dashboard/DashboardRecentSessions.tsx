import type { DashboardSnapshot, RecentSession } from '@orxa-code/contracts'
import { useNavigate } from '@tanstack/react-router'
import { BotIcon, CodeIcon, ZapIcon } from 'lucide-react'
import type { ReactNode } from 'react'

function ProviderIcon({ provider }: { provider: RecentSession['provider'] }): ReactNode {
  if (provider === 'claudeAgent') {
    return <BotIcon className="size-3 shrink-0 text-muted-foreground" />
  }
  if (provider === 'opencode') {
    return <ZapIcon className="size-3 shrink-0 text-muted-foreground" />
  }
  return <CodeIcon className="size-3 shrink-0 text-muted-foreground" />
}

function relativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

interface RecentSessionRowProps {
  session: RecentSession
  onClick: () => void
}

function RecentSessionRow({ session, onClick }: RecentSessionRowProps) {
  return (
    <button
      type="button"
      className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
      onClick={onClick}
    >
      <ProviderIcon provider={session.provider} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground group-hover:text-foreground">
          {session.title}
        </p>
        {session.projectName ? (
          <p className="truncate text-mini text-muted-foreground">{session.projectName}</p>
        ) : null}
      </div>
      <span className="shrink-0 text-mini text-muted-foreground/70">
        {relativeTime(session.updatedAt)}
      </span>
    </button>
  )
}

interface DashboardRecentSessionsProps {
  recentSessions: DashboardSnapshot['recentSessions']
}

export function DashboardRecentSessions({ recentSessions }: DashboardRecentSessionsProps) {
  const navigate = useNavigate()

  if (recentSessions.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">Recent sessions</span>
        <p className="text-xs text-muted-foreground/60">No sessions yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Recent sessions</span>
      <div className="flex flex-col">
        {recentSessions.map(session => (
          <RecentSessionRow
            key={session.threadId}
            session={session}
            onClick={() =>
              void navigate({ to: '/$threadId', params: { threadId: session.threadId } })
            }
          />
        ))}
      </div>
    </div>
  )
}
