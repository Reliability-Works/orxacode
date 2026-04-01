import { useEffect } from 'react'
import { normalizeMessageBundles } from '../lib/opencode-event-reducer'
import { measurePerf, reportPerf } from '../lib/performance'
import { useUnifiedRuntimeStore } from '../state/unified-runtime-store'

type Props = {
  directory: string
  sessionID: string
}

const OPENCODE_BACKGROUND_POLL_MS = 1500

export function OpencodeBackgroundSessionManager({ directory, sessionID }: Props) {
  const setOpencodeRuntimeSnapshot = useUnifiedRuntimeStore(
    state => state.setOpencodeRuntimeSnapshot
  )

  useEffect(() => {
    let cancelled = false

    const sync = async () => {
      if (!window.orxa?.opencode) {
        return
      }
      try {
        const runtime = await measurePerf(
          {
            surface: 'background',
            metric: 'background.poll_ms',
            kind: 'span',
            unit: 'ms',
            process: 'renderer',
            trigger: 'poll',
            component: 'opencode-background-session-manager',
            workspaceHash: directory,
            sessionHash: sessionID,
          },
          () => window.orxa.opencode.getSessionRuntime(directory, sessionID)
        )
        reportPerf({
          surface: 'background',
          metric: 'background.poll_count',
          kind: 'counter',
          value: 1,
          unit: 'count',
          process: 'renderer',
          trigger: 'poll',
          component: 'opencode-background-session-manager',
          workspaceHash: directory,
          sessionHash: sessionID,
        })
        if (cancelled) {
          return
        }
        setOpencodeRuntimeSnapshot(directory, sessionID, {
          ...runtime,
          messages: normalizeMessageBundles(runtime.messages),
        })
      } catch {
        // Background supervision is best-effort only.
      }
    }

    void sync()
    const timer = window.setInterval(() => {
      void sync()
    }, OPENCODE_BACKGROUND_POLL_MS)
    const onResume = () => {
      void measurePerf(
        {
          surface: 'background',
          metric: 'background.resume_sync_ms',
          kind: 'span',
          unit: 'ms',
          process: 'renderer',
          trigger: 'resume',
          component: 'opencode-background-session-manager',
          workspaceHash: directory,
          sessionHash: sessionID,
        },
        sync
      ).catch(() => undefined)
    }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('pageshow', onResume)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('pageshow', onResume)
    }
  }, [directory, sessionID, setOpencodeRuntimeSnapshot])

  return null
}
