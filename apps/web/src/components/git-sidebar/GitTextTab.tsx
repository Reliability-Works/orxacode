import type { ReactNode } from 'react'

import { Skeleton } from '../ui/skeleton'

export function GitSidebarSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-5 rounded" />
      ))}
    </div>
  )
}

export interface GitTextTabProps {
  data: { text: string } | undefined
  isPending: boolean
  emptyMessage: string
  errorMessage?: string
  isError?: boolean
}

export function GitTextTab({ data, isPending, emptyMessage, isError }: GitTextTabProps): ReactNode {
  if (isPending) {
    return <GitSidebarSkeleton />
  }

  if (isError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">
          GitHub CLI unavailable. Run <code className="font-mono">gh auth login</code> to enable.
        </p>
      </div>
    )
  }

  const text = data?.text?.trim() ?? ''

  if (!text) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-xs text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="overflow-y-auto p-3">
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground">
        {text}
      </pre>
    </div>
  )
}
