import { useCallback, useRef, type ProfilerOnRenderCallback } from 'react'
import type { PerfEventInput } from '@shared/ipc'

export function reportPerf(input: PerfEventInput) {
  const pending = window.orxa?.app?.reportPerf?.(input)
  void pending?.catch(() => undefined)
}

export async function measurePerf<T>(
  input: Omit<PerfEventInput, 'value'>,
  run: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now()
  try {
    const result = await run()
    reportPerf({
      ...input,
      value: performance.now() - startedAt,
    })
    return result
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
    reportPerf({
      ...input,
      value: performance.now() - startedAt,
      outcome: message.includes('timeout') ? 'timeout' : 'error',
    })
    throw error
  }
}

export function usePerfProfiler() {
  const recentCommitTimesRef = useRef<Record<string, number[]>>({})

  return useCallback(
    (component: string): ProfilerOnRenderCallback =>
      (_id, _phase, actualDuration) => {
        const now = performance.now()
        reportPerf({
          surface: 'render',
          metric: 'render.commit_ms',
          kind: 'span',
          value: actualDuration,
          unit: 'ms',
          process: 'renderer',
          component,
        })
        reportPerf({
          surface: 'render',
          metric: 'render.commit_count',
          kind: 'counter',
          value: 1,
          unit: 'count',
          process: 'renderer',
          component,
        })
        if (actualDuration >= 50) {
          reportPerf({
            surface: 'render',
            metric: 'render.slow_commit_count',
            kind: 'counter',
            value: 1,
            unit: 'count',
            process: 'renderer',
            component,
          })
        }

        const recent = (recentCommitTimesRef.current[component] ?? []).filter(
          time => now - time < 1000
        )
        recent.push(now)
        recentCommitTimesRef.current[component] = recent
        if (recent.length >= 4) {
          reportPerf({
            surface: 'render',
            metric: 'render.commit_burst_count',
            kind: 'counter',
            value: 1,
            unit: 'count',
            process: 'renderer',
            component,
          })
          recentCommitTimesRef.current[component] = recent.slice(-2)
        }
      },
    []
  )
}
