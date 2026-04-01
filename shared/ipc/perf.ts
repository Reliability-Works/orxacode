export const PERF_SURFACES = [
  'startup',
  'workspace',
  'session',
  'browser',
  'terminal',
  'background',
  'opencode',
  'codex',
  'claude',
  'claude_chat',
  'ipc',
  'render',
  'event_bus',
] as const

export const PERF_KINDS = ['span', 'counter', 'gauge'] as const

export const PERF_OUTCOMES = ['ok', 'error', 'timeout', 'cancelled'] as const

export const PERF_TRIGGERS = ['bootstrap', 'user', 'background', 'resume', 'poll'] as const

export const PERF_SIZE_BUCKETS = ['0', '1k', '10k', '100k', '1m_plus'] as const

export const PERF_UNITS = ['ms', 'count'] as const

export type PerfSurface = (typeof PERF_SURFACES)[number]
export type PerfKind = (typeof PERF_KINDS)[number]
export type PerfOutcome = (typeof PERF_OUTCOMES)[number]
export type PerfTrigger = (typeof PERF_TRIGGERS)[number]
export type PerfSizeBucket = (typeof PERF_SIZE_BUCKETS)[number]
export type PerfUnit = (typeof PERF_UNITS)[number]

export const PERF_METRICS = [
  'ipc.invoke_rtt_ms',
  'ipc.handler_ms',
  'ipc.inflight_count',
  'startup.total_ms',
  'startup.step.runtime_profiles_ms',
  'startup.step.cleanup_sessions_ms',
  'startup.step.workspace_bootstrap_ms',
  'workspace.select_ms',
  'workspace.refresh_ms',
  'session.create_ms',
  'session.runtime.load_ms',
  'session.messages.load_ms',
  'background.workspace_refresh_ms',
  'prompt.send_ack_ms',
  'prompt.first_event_ms',
  'prompt.first_assistant_output_ms',
  'prompt.complete_ms',
  'browser.ensure_tab_ms',
  'browser.open_tab_ms',
  'browser.navigate_ms',
  'browser.reload_ms',
  'browser.agent_action_ms',
  'browser.inspect_enable_ms',
  'terminal.create_ms',
  'terminal.connect_ms',
  'terminal.create_to_first_output_ms',
  'terminal.write_count',
  'terminal.write_ms',
  'terminal.resize_ms',
  'terminal.close_ms',
  'background.poll_ms',
  'background.poll_count',
  'background.resume_sync_ms',
  'renderer.longtask_ms',
  'render.commit_ms',
  'render.commit_count',
  'render.slow_commit_count',
  'render.commit_burst_count',
  'event.batch.flush_ms',
  'event.batch.size',
  'pty.output.batch_count',
  'pty.output.batch_bytes_bucket',
  'opencode.bootstrap_ms',
  'opencode.refresh_project_ms',
  'opencode.refresh_project_delta_ms',
  'opencode.create_session_ms',
  'opencode.get_session_runtime_ms',
  'opencode.load_messages_ms',
  'opencode.send_prompt_ms',
  'opencode.get_server_diagnostics_ms',
  'codex.start_ms',
  'codex.start_thread_ms',
  'codex.resume_thread_ms',
  'codex.resume_provider_thread_ms',
  'codex.start_turn_ms',
  'codex.interrupt_turn_ms',
  'browser.controller.open_tab_ms',
  'browser.controller.navigate_ms',
  'browser.controller.reload_ms',
  'browser.controller.inspect_enable_ms',
  'browser.controller.agent_action_ms',
  'terminal.service.create_ms',
  'terminal.service.connect_ms',
  'terminal.service.resize_ms',
  'terminal.service.close_ms',
] as const

export type PerfMetric = (typeof PERF_METRICS)[number]

export type PerfEventInput = {
  surface: PerfSurface
  metric: PerfMetric
  kind: PerfKind
  value: number
  unit: PerfUnit
  outcome?: PerfOutcome
  trigger?: PerfTrigger
  process: 'renderer' | 'main'
  channel?: string
  component?: string
  workspaceHash?: string
  sessionHash?: string
  threadHash?: string
  requestSizeBucket?: PerfSizeBucket
  responseSizeBucket?: PerfSizeBucket
  sampleRate?: number
}

export type PerfEventEntry = PerfEventInput & {
  id: string
  timestamp: number
}

export type PerfSummaryFilter = {
  surface?: PerfSurface
  metric?: PerfMetric
  process?: 'renderer' | 'main'
  limit?: number
  sinceMs?: number
  includeInternalTelemetry?: boolean
}

export type PerfSnapshotExportInput = {
  sinceMs?: number
  summaryLimit?: number
  includeEvents?: boolean
  eventLimit?: number
  includeInternalTelemetry?: boolean
  minDurationMs?: number
  slowOnly?: boolean
  surfaces?: PerfSurface[]
}

export type PerfSummaryRow = {
  metric: PerfMetric
  surface: PerfSurface
  channel?: string
  component?: string
  count: number
  p50?: number
  p95?: number
  max?: number
  errorCount: number
}

export type PerfSnapshotExport =
  | {
      path: string
    }
  | {
      rows: PerfSummaryRow[]
      events: PerfEventEntry[]
      filter: {
        sinceMs?: number
        summaryLimit: number
        includeEvents: boolean
        eventLimit: number
        includeInternalTelemetry: boolean
        minDurationMs: number
        slowOnly: boolean
        surfaces?: PerfSurface[]
      }
      eventStats: {
        rawMatched: number
        matched: number
        exported: number
        internalTelemetryExcluded: number
        priorityMatched: number
        priorityExported: number
      }
    }

export type PerfAlert = {
  metric: PerfMetric
  surface: PerfSurface
  summary: string
  severity: 'warn' | 'error'
  timestamp: number
}

export function toPerfSizeBucket(value: number): PerfSizeBucket {
  if (value <= 0) return '0'
  if (value < 1_000) return '1k'
  if (value < 10_000) return '10k'
  if (value < 100_000) return '100k'
  return '1m_plus'
}

export function estimateJsonSizeBucket(value: unknown): PerfSizeBucket {
  try {
    const encoded = JSON.stringify(value)
    return toPerfSizeBucket(encoded ? encoded.length : 0)
  } catch {
    return '0'
  }
}
