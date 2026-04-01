import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { PerfSurface } from '../../shared/ipc'
import type { PerformanceTelemetryService } from '../services/performance-telemetry-service'

export function registerMeasuredHandler<Args extends unknown[], Result>(
  telemetry: PerformanceTelemetryService,
  channel: string,
  surface: PerfSurface,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Promise<Result> | Result
) {
  ipcMain.handle(channel, async (event, ...args) => {
    const startedAt = performance.now()
    try {
      const result = await handler(event, ...(args as Args))
      telemetry.record({
        surface,
        metric: 'ipc.handler_ms',
        kind: 'span',
        value: performance.now() - startedAt,
        unit: 'ms',
        outcome: 'ok',
        process: 'main',
        channel,
      })
      return result
    } catch (error) {
      const message =
        error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
      telemetry.record({
        surface,
        metric: 'ipc.handler_ms',
        kind: 'span',
        value: performance.now() - startedAt,
        unit: 'ms',
        outcome: message.includes('timeout') ? 'timeout' : 'error',
        process: 'main',
        channel,
      })
      throw error
    }
  })
}
