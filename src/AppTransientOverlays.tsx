import { useState, type Dispatch, type SetStateAction } from 'react'
import { PERF_SURFACES, type PerfSummaryRow, type PerfSurface } from '@shared/ipc'
import { getSessionContextActions } from './lib/session-context-menu'
import type { ContextMenuState } from './hooks/useWorkspaceState-shared'
import type { AppShellUpdateProgressState } from './hooks/useAppShellUpdateFlow'
import type { DebugLogLevel } from './app-core-debug'
import type { SessionType } from '~/types/canvas'
import type { PerfExportOptions } from './perf-export-options'

type DebugLogEntry = {
  id: string
  time: number
  level: DebugLogLevel
  eventType: string
  summary: string
  details?: string
}

type AppTransientOverlaysProps = {
  contextMenu: ContextMenuState
  setContextMenu: Dispatch<SetStateAction<ContextMenuState>>
  changeProjectDirectory: (directory: string, label: string) => Promise<void>
  removeProjectDirectory: (directory: string, label: string) => Promise<void>
  getSessionType: (sessionID: string, directory?: string) => SessionType | undefined
  archiveSession: (directory: string, sessionID: string) => Promise<void>
  copySessionID: (directory: string, sessionID: string) => Promise<void>
  renameSession: (directory: string, sessionID: string, currentTitle: string) => void
  debugModalOpen: boolean
  setDebugModalOpen: Dispatch<SetStateAction<boolean>>
  statusLine: string
  debugLogLevelFilter: 'all' | DebugLogLevel
  setDebugLogLevelFilter: Dispatch<SetStateAction<'all' | DebugLogLevel>>
  filteredDebugLogs: DebugLogEntry[]
  copyDebugLogsAsJson: () => Promise<void>
  perfSummaryRows: PerfSummaryRow[]
  perfSummaryLoading: boolean
  perfSummaryError: string | null
  perfWindowMs: number
  setPerfWindowMs: (value: number) => void
  refreshPerfSummary: () => Promise<void>
  exportPerfSnapshotAsJson: () => Promise<void>
  perfExportOptions: PerfExportOptions
  setPerfExportOptions: Dispatch<SetStateAction<PerfExportOptions>>
  updateProgressState: AppShellUpdateProgressState | null
  setUpdateProgressState: Dispatch<SetStateAction<AppShellUpdateProgressState | null>>
}

const PERF_WINDOW_PRESETS = [
  { label: 'Last 5m', value: 5 * 60_000 },
  { label: 'Last 15m', value: 15 * 60_000 },
  { label: 'Last 30m', value: 30 * 60_000 },
  { label: 'Last 2h', value: 2 * 60 * 60_000 },
] as const

function formatMetricValue(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a'
  }
  return value >= 100 ? `${Math.round(value)}ms` : `${value.toFixed(1)}ms`
}

function ExportOptionsGroup({
  perfExportOptions,
  setPerfExportOptions,
}: Pick<AppTransientOverlaysProps, 'perfExportOptions' | 'setPerfExportOptions'>) {
  const allSelected = perfExportOptions.surfaces.length === PERF_SURFACES.length

  function toggleSurface(surface: PerfSurface) {
    setPerfExportOptions(current => {
      const has = current.surfaces.includes(surface)
      return {
        ...current,
        surfaces: has
          ? current.surfaces.filter(s => s !== surface)
          : [...current.surfaces, surface],
      }
    })
  }

  function toggleAll() {
    setPerfExportOptions(current => ({
      ...current,
      surfaces: allSelected ? [] : [...PERF_SURFACES],
    }))
  }

  return (
    <fieldset className="perf-export-options" aria-label="Export options">
      <legend>Export Options</legend>
      <div className="perf-export-options-row">
        <label className="perf-toggle-control" htmlFor="perf-slow-only">
          <input
            id="perf-slow-only"
            type="checkbox"
            checked={perfExportOptions.slowOnly}
            onChange={event =>
              setPerfExportOptions(current => ({
                ...current,
                slowOnly: event.target.checked,
              }))
            }
          />
          Slow-only
        </label>
        <label className="perf-number-control" htmlFor="perf-min-duration">
          Min duration (ms)
          <input
            id="perf-min-duration"
            type="number"
            min={0}
            step={10}
            value={perfExportOptions.minDurationMs}
            onChange={event =>
              setPerfExportOptions(current => ({
                ...current,
                minDurationMs: Math.max(0, Number(event.target.value) || 0),
              }))
            }
          />
        </label>
      </div>
      <div className="perf-export-surfaces">
        <div className="perf-export-surfaces-header">
          <span>Surfaces</span>
          <button
            type="button"
            className={`perf-surface-toggle-all ${allSelected ? 'active' : ''}`}
            onClick={toggleAll}
            aria-pressed={allSelected}
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        </div>
        <div className="perf-surface-chips" role="group" aria-label="Surface filters">
          {PERF_SURFACES.map(surface => {
            const checked = perfExportOptions.surfaces.includes(surface)
            return (
              <label key={surface} className={`perf-surface-chip ${checked ? 'active' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggleSurface(surface)} />
                {surface}
              </label>
            )
          })}
        </div>
      </div>
    </fieldset>
  )
}

function renderPerfDashboard(props: AppTransientOverlaysProps) {
  const {
    perfSummaryRows,
    perfSummaryLoading,
    perfSummaryError,
    perfWindowMs,
    setPerfWindowMs,
    refreshPerfSummary,
    exportPerfSnapshotAsJson,
    perfExportOptions,
    setPerfExportOptions,
  } = props

  const totalSamples = perfSummaryRows.reduce((sum, row) => sum + row.count, 0)
  const hotRow = [...perfSummaryRows].sort((left, right) => (right.p95 ?? 0) - (left.p95 ?? 0))[0]
  const slowRows = perfSummaryRows
    .filter(row => row.metric.endsWith('_ms') && row.surface !== 'ipc' && row.surface !== 'render')
    .sort((left, right) => (right.p95 ?? 0) - (left.p95 ?? 0))
    .slice(0, 8)
  const ipcRows = perfSummaryRows
    .filter(row => row.metric === 'ipc.invoke_rtt_ms' || row.metric === 'ipc.handler_ms')
    .sort((left, right) => (right.p95 ?? 0) - (left.p95 ?? 0))
    .slice(0, 10)
  const renderRows = perfSummaryRows
    .filter(
      row =>
        row.metric === 'render.commit_ms' ||
        row.metric === 'renderer.longtask_ms' ||
        row.metric === 'render.slow_commit_count'
    )
    .sort((left, right) => (right.p95 ?? 0) - (left.p95 ?? 0))
    .slice(0, 8)

  return (
    <section className="perf-panel" aria-label="Performance dashboard">
      <div className="perf-panel-header">
        <div>
          <h3>Performance Summary</h3>
          <p>
            Always on locally in all builds. Stored on-device only. No remote shipping. No settings
            toggle.
          </p>
        </div>
        <div className="perf-panel-actions">
          <label className="perf-window-control" htmlFor="perf-window-select">
            Window
            <select
              id="perf-window-select"
              value={perfWindowMs}
              onChange={event => setPerfWindowMs(Number(event.target.value))}
            >
              {PERF_WINDOW_PRESETS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void refreshPerfSummary()}>
            Refresh summary
          </button>
        </div>
      </div>
      <ExportOptionsGroup
        perfExportOptions={perfExportOptions}
        setPerfExportOptions={setPerfExportOptions}
      />
      <div className="perf-export-action-row">
        <button
          type="button"
          className="debug-log-copy-btn"
          onClick={() => void exportPerfSnapshotAsJson()}
          disabled={perfExportOptions.surfaces.length === 0}
        >
          Export focused metrics JSON
        </button>
        {perfExportOptions.surfaces.length === 0 ? (
          <small className="perf-export-hint">Select at least one surface to export.</small>
        ) : null}
      </div>
      <div className="perf-kpi-grid">
        <article className="perf-kpi-card">
          <strong>{perfSummaryRows.length}</strong>
          <span>summary rows</span>
        </article>
        <article className="perf-kpi-card">
          <strong>{totalSamples}</strong>
          <span>retained samples</span>
        </article>
        <article className="perf-kpi-card">
          <strong>{hotRow?.metric ?? 'n/a'}</strong>
          <span>hottest metric</span>
        </article>
        <article className="perf-kpi-card">
          <strong>{formatMetricValue(hotRow?.p95)}</strong>
          <span>worst p95</span>
        </article>
      </div>
      {perfSummaryLoading ? (
        <p className="perf-panel-status">Loading performance summary…</p>
      ) : null}
      {perfSummaryError ? (
        <p className="perf-panel-status perf-panel-status-error">{perfSummaryError}</p>
      ) : null}
      <div className="perf-section-grid">
        <section className="perf-section">
          <div className="perf-section-header">
            <h4>Slow transitions</h4>
            <small>user-facing spans by p95</small>
          </div>
          {slowRows.length === 0 ? (
            <p className="dashboard-empty">No transition samples yet.</p>
          ) : (
            <div className="perf-table">
              {slowRows.map(row => (
                <article
                  key={`${row.metric}:${row.surface}:${row.component ?? ''}`}
                  className="perf-row"
                >
                  <div>
                    <strong>{row.metric}</strong>
                    <small>
                      {row.surface}
                      {row.component ? ` • ${row.component}` : ''}
                    </small>
                  </div>
                  <div className="perf-row-values">
                    <span>P95 {formatMetricValue(row.p95)}</span>
                    <span>MAX {formatMetricValue(row.max)}</span>
                    <span>{row.count}x</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="perf-section">
          <div className="perf-section-header">
            <h4>IPC channels</h4>
            <small>cross-process cost by p95</small>
          </div>
          {ipcRows.length === 0 ? (
            <p className="dashboard-empty">No IPC timing rows yet.</p>
          ) : (
            <div className="perf-table">
              {ipcRows.map(row => (
                <article
                  key={`${row.metric}:${row.channel ?? ''}:${row.component ?? ''}`}
                  className="perf-row"
                >
                  <div>
                    <strong>{row.channel ?? row.metric}</strong>
                    <small>{row.metric}</small>
                  </div>
                  <div className="perf-row-values">
                    <span>P95 {formatMetricValue(row.p95)}</span>
                    <span>P50 {formatMetricValue(row.p50)}</span>
                    <span>{row.errorCount} err</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="perf-section">
          <div className="perf-section-header">
            <h4>Render pressure</h4>
            <small>commit and long-task hotspots</small>
          </div>
          {renderRows.length === 0 ? (
            <p className="dashboard-empty">No render samples yet.</p>
          ) : (
            <div className="perf-table">
              {renderRows.map(row => (
                <article key={`${row.metric}:${row.component ?? ''}`} className="perf-row">
                  <div>
                    <strong>{row.component ?? row.metric}</strong>
                    <small>{row.metric}</small>
                  </div>
                  <div className="perf-row-values">
                    <span>P95 {formatMetricValue(row.p95)}</span>
                    <span>MAX {formatMetricValue(row.max)}</span>
                    <span>{row.count}x</span>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  )
}

function renderContextMenu(props: AppTransientOverlaysProps) {
  const {
    archiveSession,
    changeProjectDirectory,
    contextMenu,
    copySessionID,
    getSessionType,
    removeProjectDirectory,
    renameSession,
    setContextMenu,
  } = props

  if (!contextMenu) {
    return null
  }

  return (
    <div
      className="context-menu-overlay"
      onClick={() => setContextMenu(null)}
      onContextMenu={event => event.preventDefault()}
    >
      <div
        className="context-menu"
        style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        onClick={event => event.stopPropagation()}
      >
        {contextMenu.kind === 'project'
          ? renderProjectContextMenu(
              contextMenu,
              setContextMenu,
              changeProjectDirectory,
              removeProjectDirectory
            )
          : renderSessionContextMenu(
              contextMenu,
              setContextMenu,
              getSessionType,
              archiveSession,
              copySessionID,
              renameSession
            )}
      </div>
    </div>
  )
}

function renderProjectContextMenu(
  contextMenu: Extract<NonNullable<ContextMenuState>, { kind: 'project' }>,
  setContextMenu: AppTransientOverlaysProps['setContextMenu'],
  changeProjectDirectory: AppTransientOverlaysProps['changeProjectDirectory'],
  removeProjectDirectory: AppTransientOverlaysProps['removeProjectDirectory']
) {
  return (
    <>
      <button
        type="button"
        onClick={() => {
          const { directory, label } = contextMenu
          setContextMenu(null)
          void changeProjectDirectory(directory, label)
        }}
      >
        Change Working Directory...
      </button>
      <button
        type="button"
        className="danger"
        onClick={() => {
          const { directory, label } = contextMenu
          setContextMenu(null)
          void removeProjectDirectory(directory, label)
        }}
      >
        Delete
      </button>
    </>
  )
}

function renderSessionContextMenu(
  contextMenu: Extract<NonNullable<ContextMenuState>, { kind: 'session' }>,
  setContextMenu: AppTransientOverlaysProps['setContextMenu'],
  getSessionType: AppTransientOverlaysProps['getSessionType'],
  archiveSession: AppTransientOverlaysProps['archiveSession'],
  copySessionID: AppTransientOverlaysProps['copySessionID'],
  renameSession: AppTransientOverlaysProps['renameSession']
) {
  const sessionType = getSessionType(contextMenu.sessionID, contextMenu.directory) ?? 'opencode'
  const actions = getSessionContextActions(sessionType)
  return (
    <>
      {actions.includes('archive') ? (
        <button
          type="button"
          onClick={() => {
            const { directory, sessionID } = contextMenu
            setContextMenu(null)
            void archiveSession(directory, sessionID)
          }}
        >
          Archive Session
        </button>
      ) : null}
      {actions.includes('copy_id') ? (
        <button
          type="button"
          onClick={() => {
            const { directory, sessionID } = contextMenu
            setContextMenu(null)
            void copySessionID(directory, sessionID)
          }}
        >
          {sessionType === 'codex'
            ? 'Copy Codex Thread ID'
            : sessionType === 'claude-chat'
              ? 'Copy Claude Thread ID'
              : 'Copy Session ID'}
        </button>
      ) : null}
      {actions.includes('rename') ? (
        <button
          type="button"
          onClick={() => {
            const { directory, sessionID, title } = contextMenu
            setContextMenu(null)
            void renameSession(directory, sessionID, title)
          }}
        >
          Rename Session
        </button>
      ) : null}
    </>
  )
}

type DebugTab = 'logs' | 'dashboard'

function DebugOverlay(props: AppTransientOverlaysProps) {
  const {
    copyDebugLogsAsJson,
    debugLogLevelFilter,
    debugModalOpen,
    filteredDebugLogs,
    setDebugLogLevelFilter,
    setDebugModalOpen,
    statusLine,
  } = props

  const [activeTab, setActiveTab] = useState<DebugTab>('logs')

  if (!debugModalOpen) {
    return null
  }

  return (
    <div className="overlay debug-log-overlay" onClick={() => setDebugModalOpen(false)}>
      <section
        className="modal debug-log-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Local diagnostics and performance"
        onClick={event => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2>Local Diagnostics</h2>
            <small className="debug-log-subtitle">Status: {statusLine}</small>
          </div>
          <button type="button" onClick={() => setDebugModalOpen(false)}>
            Close
          </button>
        </header>
        <nav className="debug-tab-bar" role="tablist" aria-label="Debug sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'logs'}
            aria-controls="debug-panel-logs"
            className={`debug-tab ${activeTab === 'logs' ? 'active' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            Logs
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'dashboard'}
            aria-controls="debug-panel-dashboard"
            className={`debug-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
        </nav>
        {activeTab === 'logs' ? (
          <div id="debug-panel-logs" role="tabpanel" className="debug-tab-panel">
            <div className="debug-log-toolbar">
              <span className="debug-log-filter-label">Filter level</span>
              {(['all', 'info', 'warn', 'error'] as const).map(level => (
                <button
                  key={level}
                  type="button"
                  className={debugLogLevelFilter === level ? 'active' : ''}
                  onClick={() => setDebugLogLevelFilter(level)}
                >
                  {level === 'all' ? 'All' : level.toUpperCase()}
                </button>
              ))}
              <button
                type="button"
                className="debug-log-copy-btn"
                onClick={() => void copyDebugLogsAsJson()}
              >
                Copy logs as JSON
              </button>
            </div>
            <div className="debug-log-list" role="log" aria-live="polite">
              {filteredDebugLogs.length === 0 ? (
                <p className="dashboard-empty">No debug logs yet.</p>
              ) : (
                filteredDebugLogs
                  .slice()
                  .reverse()
                  .map(entry => (
                    <article key={entry.id} className={`debug-log-item ${entry.level}`.trim()}>
                      <div className="debug-log-item-meta">
                        <span>{new Date(entry.time).toLocaleTimeString()}</span>
                        <span>{entry.eventType}</span>
                      </div>
                      <p>{entry.summary}</p>
                      {entry.details ? (
                        <details>
                          <summary>Details</summary>
                          <pre>{entry.details}</pre>
                        </details>
                      ) : null}
                    </article>
                  ))
              )}
            </div>
          </div>
        ) : (
          <div id="debug-panel-dashboard" role="tabpanel" className="debug-tab-panel">
            {renderPerfDashboard(props)}
          </div>
        )}
      </section>
    </div>
  )
}

function renderUpdateOverlay(props: AppTransientOverlaysProps) {
  const { setUpdateProgressState, updateProgressState } = props
  if (!updateProgressState) {
    return null
  }

  return (
    <div
      className="overlay"
      onClick={
        updateProgressState.phase === 'error' ? () => setUpdateProgressState(null) : undefined
      }
    >
      <section className="modal update-progress-modal" onClick={event => event.stopPropagation()}>
        <div className="update-progress-body">
          {updateProgressState.phase === 'error' ? (
            <>
              <h2>Update failed</h2>
              <p>{updateProgressState.message}</p>
              <button type="button" onClick={() => setUpdateProgressState(null)}>
                Dismiss
              </button>
            </>
          ) : (
            <>
              <span
                className="session-status-indicator busy commit-progress-spinner"
                aria-hidden="true"
              />
              <h2>
                {updateProgressState.phase === 'installing'
                  ? 'Installing update'
                  : 'Downloading update'}
                {updateProgressState.version ? ` ${updateProgressState.version}` : ''}
              </h2>
              <p>{updateProgressState.message}</p>
              {updateProgressState.phase === 'downloading' ? (
                <div className="update-progress-meter" aria-label="Update download progress">
                  <div
                    className="update-progress-meter-fill"
                    style={{
                      width: `${Math.max(0, Math.min(100, updateProgressState.percent ?? 0))}%`,
                    }}
                  />
                </div>
              ) : null}
              {updateProgressState.phase === 'downloading' ? (
                <small>
                  {typeof updateProgressState.percent === 'number'
                    ? `${Math.round(updateProgressState.percent)}%`
                    : 'Starting...'}
                </small>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  )
}

export function AppTransientOverlays(props: AppTransientOverlaysProps) {
  return (
    <>
      {renderContextMenu(props)}
      <DebugOverlay {...props} />
      {renderUpdateOverlay(props)}
    </>
  )
}
