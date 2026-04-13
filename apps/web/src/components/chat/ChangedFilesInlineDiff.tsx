import { FileDiff } from '@pierre/diffs/react'
import { type ThreadId, type TurnId } from '@orxa-code/contracts'
import { useQuery } from '@tanstack/react-query'

import { checkpointDiffQueryOptions } from '../../lib/providerReactQuery'
import { resolveDiffThemeName } from '../../lib/diffRendering'
import { findChangedFileDiff } from './ChangedFilesInlineDiff.logic'

export function ChangedFilesInlineDiff(props: {
  threadId: ThreadId
  turnId: TurnId
  checkpointTurnCount?: number | undefined
  filePath: string
  resolvedTheme: 'light' | 'dark'
}) {
  const checkpointTurnCount = props.checkpointTurnCount
  const checkpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      threadId: props.threadId,
      fromTurnCount:
        typeof checkpointTurnCount === 'number' ? Math.max(0, checkpointTurnCount - 1) : null,
      toTurnCount: checkpointTurnCount ?? null,
      cacheScope: `changed-files-inline:${props.turnId}:${props.filePath}`,
      enabled: typeof checkpointTurnCount === 'number',
    })
  )

  if (typeof checkpointTurnCount !== 'number') {
    return (
      <div className="mx-2 mb-1 mt-1 rounded-md border border-border/60 bg-background/70 px-3 py-2 text-caption text-muted-foreground/70">
        Inline diff unavailable for this turn.
      </div>
    )
  }

  if (checkpointDiffQuery.isLoading) {
    return (
      <div className="mx-2 mb-1 mt-1 rounded-md border border-border/60 bg-background/70 px-3 py-2 text-caption text-muted-foreground/70">
        Loading diff...
      </div>
    )
  }

  if (checkpointDiffQuery.error instanceof Error) {
    return (
      <div className="mx-2 mb-1 mt-1 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-caption text-red-400/80">
        {checkpointDiffQuery.error.message}
      </div>
    )
  }

  const fileDiff = findChangedFileDiff(checkpointDiffQuery.data?.diff, props.filePath)
  if (!fileDiff) {
    return (
      <div className="mx-2 mb-1 mt-1 rounded-md border border-border/60 bg-background/70 px-3 py-2 text-caption text-muted-foreground/70">
        No inline diff available for {props.filePath}.
      </div>
    )
  }

  return (
    <div className="mx-2 mb-1 mt-1 overflow-hidden rounded-md border border-border/70 bg-background">
      <FileDiff
        fileDiff={fileDiff}
        options={{
          diffStyle: 'unified',
          lineDiffType: 'none',
          overflow: 'scroll',
          theme: resolveDiffThemeName(props.resolvedTheme),
          themeType: props.resolvedTheme,
        }}
      />
    </div>
  )
}
