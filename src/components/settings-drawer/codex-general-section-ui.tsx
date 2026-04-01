import type { CodexDoctorResult, CodexUpdateResult } from '@shared/ipc'

type CodexBinaryPathFieldProps = {
  codexPath: string
  onCodexPathChange: (value: string) => void
  onBrowse: () => void
}

export function CodexBinaryPathField({
  codexPath,
  onCodexPathChange,
  onBrowse,
}: CodexBinaryPathFieldProps) {
  return (
    <>
      <p className="settings-server-subtitle">// codex binary path</p>
      <div className="settings-codex-field-row">
        <input
          type="text"
          className="settings-codex-input"
          value={codexPath}
          onChange={e => onCodexPathChange(e.target.value)}
          placeholder="(uses system PATH)"
        />
        <button type="button" className="settings-server-btn" onClick={onBrowse}>
          browse
        </button>
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => onCodexPathChange('')}
        >
          use PATH
        </button>
      </div>
      <p className="settings-codex-help">Leave empty to use the system PATH resolution.</p>
    </>
  )
}

type CodexArgsFieldProps = {
  codexArgs: string
  onCodexArgsChange: (value: string) => void
}

export function CodexArgsField({ codexArgs, onCodexArgsChange }: CodexArgsFieldProps) {
  return (
    <>
      <p className="settings-server-subtitle" style={{ marginTop: '16px' }}>
        // default codex args
      </p>
      <div className="settings-codex-field-row">
        <input
          type="text"
          className="settings-codex-input"
          value={codexArgs}
          onChange={e => onCodexArgsChange(e.target.value)}
          placeholder="e.g. --quiet --no-color"
        />
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => onCodexArgsChange('')}
        >
          clear
        </button>
      </div>
      <p className="settings-codex-help">
        Extra flags passed to the codex app-server. Supports --quiet, --no-color, etc.
      </p>
    </>
  )
}

type CodexDiagnosticsSectionProps = {
  codexDoctorRunning: boolean
  codexDoctorResult: CodexDoctorResult | null
  codexUpdateRunning: boolean
  codexUpdateResult: CodexUpdateResult | null
  onRunDoctor: () => void
  onUpdateCodex: () => void
}

export function CodexDiagnosticsSection({
  codexDoctorRunning,
  codexDoctorResult,
  codexUpdateRunning,
  codexUpdateResult,
  onRunDoctor,
  onUpdateCodex,
}: CodexDiagnosticsSectionProps) {
  return (
    <>
      <p className="settings-server-subtitle" style={{ marginTop: '16px' }}>
        // diagnostics
      </p>
      <div className="settings-codex-field-row">
        <button
          type="button"
          className="settings-server-btn"
          disabled={codexDoctorRunning}
          onClick={onRunDoctor}
        >
          {codexDoctorRunning ? 'running...' : 'run doctor'}
        </button>
        <button
          type="button"
          className="settings-server-btn"
          disabled={codexUpdateRunning}
          onClick={onUpdateCodex}
        >
          {codexUpdateRunning ? 'updating...' : 'update codex'}
        </button>
      </div>
      {codexDoctorResult ? <CodexDoctorResultPanel result={codexDoctorResult} /> : null}
      {codexUpdateResult ? <CodexUpdateResultPanel result={codexUpdateResult} /> : null}
    </>
  )
}

function CodexDoctorResultPanel({ result }: { result: CodexDoctorResult }) {
  return (
    <div
      className={`settings-codex-doctor ${result.appServer === 'ok' ? 'settings-codex-doctor--ok' : 'settings-codex-doctor--error'}`}
    >
      <div className="settings-server-status-row">
        <span className="settings-server-status-key">version</span>
        <span className="settings-server-status-value">{result.version}</span>
      </div>
      <div className="settings-server-status-row">
        <span className="settings-server-status-key">app-server</span>
        <span
          className={`settings-server-status-value${result.appServer === 'ok' ? ' settings-server-status-value--green' : ''}`}
        >
          {result.appServer}
        </span>
      </div>
      <div className="settings-server-status-row">
        <span className="settings-server-status-key">node</span>
        <span
          className={`settings-server-status-value${result.node === 'ok' ? ' settings-server-status-value--green' : ''}`}
        >
          {result.node}
        </span>
      </div>
      <div className="settings-server-status-row">
        <span className="settings-server-status-key">path</span>
        <span className="settings-server-status-value settings-server-status-value--path">
          {result.path}
        </span>
      </div>
    </div>
  )
}

function CodexUpdateResultPanel({ result }: { result: CodexUpdateResult }) {
  return (
    <div
      className={`settings-codex-doctor ${result.ok ? 'settings-codex-doctor--ok' : 'settings-codex-doctor--error'}`}
    >
      <p className="settings-memory-desc">{result.message}</p>
    </div>
  )
}

export function CodexConnectionStatus({
  codexConnected,
  codexStatus,
}: {
  codexConnected: boolean
  codexStatus: string
}) {
  return (
    <>
      <p className="settings-server-subtitle" style={{ marginTop: '16px' }}>
        // connection status
      </p>
      <div className="settings-server-status-card">
        <div className="settings-server-status-row">
          <span className="settings-server-status-key">codex app-server</span>
          <span
            className={`settings-server-status-value${codexConnected ? ' settings-server-status-value--green' : ''}`}
          >
            {codexStatus}
          </span>
        </div>
      </div>
    </>
  )
}
