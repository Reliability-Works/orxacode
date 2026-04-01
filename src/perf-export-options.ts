import { PERF_SURFACES, type PerfSurface } from '@shared/ipc'

export type PerfExportOptions = {
  slowOnly: boolean
  minDurationMs: number
  surfaces: PerfSurface[]
}

export const DEFAULT_PERF_EXPORT_OPTIONS: PerfExportOptions = {
  slowOnly: true,
  minDurationMs: 120,
  surfaces: [...PERF_SURFACES],
}
