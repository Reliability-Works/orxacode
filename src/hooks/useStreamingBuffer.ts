import { useEffect, useState } from 'react'
import type { UnifiedProjectedSessionPresentation } from '../lib/session-presentation'
import type { UnifiedTimelineRenderRow } from '../components/chat/unified-timeline-model'

/**
 * Client-side streaming buffer. When `enableStreaming` is false and a session is
 * actively generating, this hook holds back the in-progress assistant turn and
 * only reveals it once the session goes idle (turn complete).
 *
 * When `enableStreaming` is true, the presentation is passed through unchanged
 * (current default behaviour).
 */
export function useStreamingBuffer(
  presentation: UnifiedProjectedSessionPresentation | null | undefined,
  isSessionBusy: boolean,
  enableStreaming: boolean
): UnifiedProjectedSessionPresentation | null | undefined {
  const [snapshot, setSnapshot] = useState<UnifiedTimelineRenderRow[] | null>(null)
  const [wasBusy, setWasBusy] = useState(false)

  useEffect(() => {
    if (!enableStreaming) {
      // Capture snapshot when a turn begins (transition idle → busy)
      if (isSessionBusy && !wasBusy && presentation) {
        setSnapshot(presentation.rows)
      }
      // Clear snapshot when the turn ends (transition busy → idle)
      if (!isSessionBusy && wasBusy) {
        setSnapshot(null)
      }
    } else {
      setSnapshot(null)
    }
    setWasBusy(isSessionBusy)
  }, [isSessionBusy, enableStreaming, presentation, wasBusy])

  if (!presentation) return presentation
  if (enableStreaming) return presentation

  // When session is busy and we have a pre-turn snapshot, show the snapshot
  // plus a placeholder activity label so the user knows something is happening.
  if (isSessionBusy && snapshot) {
    return {
      ...presentation,
      rows: snapshot,
      latestActivity: presentation.latestActivity,
      latestActivityContent: presentation.latestActivityContent,
    }
  }

  return presentation
}
