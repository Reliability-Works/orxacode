import type { CodexDoctorResult, CodexModelEntry, CodexUpdateResult } from '@shared/ipc'
import type { Dispatch, SetStateAction } from 'react'
import type { AppPreferences } from '~/types/app'
import {
  CodexArgsField,
  CodexBinaryPathField,
  CodexConnectionStatus,
  CodexDiagnosticsSection,
} from './codex-general-section-ui'

type CodexGeneralSectionProps = {
  appPreferences: AppPreferences
  onAppPreferencesChange: (next: AppPreferences) => void
  codexState: { status: string } | null
  codexDoctorRunning: boolean
  setCodexDoctorRunning: (value: boolean) => void
  codexDoctorResult: CodexDoctorResult | null
  setCodexDoctorResult: (value: CodexDoctorResult | null) => void
  codexUpdateRunning: boolean
  setCodexUpdateRunning: (value: boolean) => void
  codexUpdateResult: CodexUpdateResult | null
  setCodexUpdateResult: (value: CodexUpdateResult | null) => void
  setFeedback: (message: string) => void
}

export function CodexGeneralSection({
  appPreferences,
  onAppPreferencesChange,
  codexState,
  codexDoctorRunning,
  setCodexDoctorRunning,
  codexDoctorResult,
  setCodexDoctorResult,
  codexUpdateRunning,
  setCodexUpdateRunning,
  codexUpdateResult,
  setCodexUpdateResult,
  setFeedback,
}: CodexGeneralSectionProps) {
  const codexStatus = codexState?.status ?? 'unknown'
  const codexConnected = codexStatus === 'connected'
  const updateCodexPreferences = (patch: Partial<AppPreferences>) =>
    onAppPreferencesChange({ ...appPreferences, ...patch })
  const handleBrowseCodexBinary = () => {
    void window.orxa.app
      .openFile({ title: 'Select codex binary', filters: [] })
      .then(result => {
        if (result) {
          updateCodexPreferences({ codexPath: result.path })
        }
      })
  }
  const handleRunDoctor = () => {
    setCodexDoctorRunning(true)
    setCodexDoctorResult(null)
    void window.orxa.codex
      .doctor()
      .then(result => {
        setCodexDoctorResult(result)
        setFeedback('Doctor completed')
      })
      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
      .finally(() => setCodexDoctorRunning(false))
  }
  const handleUpdateCodex = () => {
    setCodexUpdateRunning(true)
    setCodexUpdateResult(null)
    void window.orxa.codex
      .update()
      .then(result => {
        setCodexUpdateResult(result)
        setFeedback(result.message)
      })
      .catch((error: unknown) => setFeedback(error instanceof Error ? error.message : String(error)))
      .finally(() => setCodexUpdateRunning(false))
  }

  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">codex / general</p>
      <CodexBinaryPathField
        codexPath={appPreferences.codexPath}
        onCodexPathChange={codexPath => updateCodexPreferences({ codexPath })}
        onBrowse={handleBrowseCodexBinary}
      />
      <CodexArgsField
        codexArgs={appPreferences.codexArgs}
        onCodexArgsChange={codexArgs => updateCodexPreferences({ codexArgs })}
      />
      <CodexDiagnosticsSection
        codexDoctorRunning={codexDoctorRunning}
        codexDoctorResult={codexDoctorResult}
        codexUpdateRunning={codexUpdateRunning}
        codexUpdateResult={codexUpdateResult}
        onRunDoctor={handleRunDoctor}
        onUpdateCodex={handleUpdateCodex}
      />
      <CodexConnectionStatus codexConnected={codexConnected} codexStatus={codexStatus} />
    </section>
  )
}

type CodexModelsSectionProps = {
  appPreferences: AppPreferences
  onAppPreferencesChange: (next: AppPreferences) => void
  codexModels: CodexModelEntry[]
  codexModelsLoading: boolean
  setCodexModelsLoading: (value: boolean) => void
  setCodexModels: Dispatch<SetStateAction<CodexModelEntry[]>>
  setFeedback: (message: string) => void
}

export function CodexModelsSection({
  appPreferences,
  onAppPreferencesChange,
  codexModels,
  codexModelsLoading,
  setCodexModelsLoading,
  setCodexModels,
  setFeedback,
}: CodexModelsSectionProps) {
  const selectedModelEntry = codexModels.find(m => m.id === appPreferences.codexDefaultModel)
  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">codex / models</p>

      <p className="settings-server-subtitle">// default model</p>
      <div className="settings-codex-field-row">
        <select
          className="settings-codex-input"
          value={appPreferences.codexDefaultModel}
          onChange={e =>
            onAppPreferencesChange({ ...appPreferences, codexDefaultModel: e.target.value })
          }
        >
          <option value="">(none -- use codex default)</option>
          {codexModels.map(m => (
            <option key={m.id} value={m.id}>
              {m.name || m.id}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="settings-server-btn"
          disabled={codexModelsLoading}
          onClick={() => {
            setCodexModelsLoading(true)
            void window.orxa.codex
              .listModels()
              .then(models => {
                setCodexModels(models)
                setFeedback('Models refreshed')
              })
              .catch((error: unknown) =>
                setFeedback(error instanceof Error ? error.message : String(error))
              )
              .finally(() => setCodexModelsLoading(false))
          }}
        >
          {codexModelsLoading ? 'loading...' : 'refresh'}
        </button>
      </div>

      <p className="settings-server-subtitle" style={{ marginTop: '16px' }}>
        // reasoning effort
      </p>
      <select
        className="settings-codex-input"
        value={appPreferences.codexReasoningEffort}
        disabled={!selectedModelEntry || selectedModelEntry.supportedReasoningEfforts.length === 0}
        onChange={e =>
          onAppPreferencesChange({ ...appPreferences, codexReasoningEffort: e.target.value })
        }
      >
        <option value="low">low</option>
        <option value="medium">medium</option>
        <option value="high">high</option>
      </select>
      {!selectedModelEntry || selectedModelEntry.supportedReasoningEfforts.length === 0 ? (
        <p className="settings-codex-help">
          Reasoning effort is not supported by the selected model.
        </p>
      ) : null}
    </section>
  )
}

type CodexAccessSectionProps = {
  appPreferences: AppPreferences
  onAppPreferencesChange: (next: AppPreferences) => void
}

export function CodexAccessSection({
  appPreferences,
  onAppPreferencesChange,
}: CodexAccessSectionProps) {
  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">codex / access</p>

      <p className="settings-server-subtitle">// access mode</p>
      <select
        className="settings-codex-input"
        value={appPreferences.codexAccessMode}
        onChange={e =>
          onAppPreferencesChange({ ...appPreferences, codexAccessMode: e.target.value })
        }
      >
        <option value="read-only">read-only</option>
        <option value="on-request">on-request (ask for approval)</option>
        <option value="full-access">full-access (auto-approve)</option>
      </select>
    </section>
  )
}

type CodexConfigSectionProps = {
  codexLoading: boolean
  codexConfigToml: string
  setCodexConfigToml: (value: string) => void
  setFeedback: (message: string) => void
}

export function CodexConfigSection({
  codexLoading,
  codexConfigToml,
  setCodexConfigToml,
  setFeedback,
}: CodexConfigSectionProps) {
  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">codex / config</p>

      <p className="settings-server-subtitle">// config.toml</p>
      <p className="raw-path">~/.codex/config.toml</p>
      {codexLoading ? (
        <p className="settings-memory-desc">loading...</p>
      ) : (
        <textarea
          className="settings-personalization-textarea"
          value={codexConfigToml}
          onChange={e => setCodexConfigToml(e.target.value)}
          placeholder="(file not found or empty)"
          style={{ minHeight: '280px' }}
        />
      )}
      <div className="settings-codex-field-row">
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => {
            void window.orxa.app
              .writeTextFile('~/.codex/config.toml', codexConfigToml)
              .then(() => setFeedback('config.toml saved'))
              .catch((error: unknown) =>
                setFeedback(error instanceof Error ? error.message : String(error))
              )
          }}
        >
          save
        </button>
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => {
            void window.orxa.app
              .readTextFile('~/.codex/config.toml')
              .then(content => {
                setCodexConfigToml(content)
                setFeedback('config.toml refreshed')
              })
              .catch((error: unknown) =>
                setFeedback(error instanceof Error ? error.message : String(error))
              )
          }}
        >
          refresh
        </button>
      </div>
    </section>
  )
}

type CodexPersonalizationSectionProps = {
  codexLoading: boolean
  codexAgentsMd: string
  setCodexAgentsMd: (value: string) => void
  setFeedback: (message: string) => void
}

export function CodexPersonalizationSection({
  codexLoading,
  codexAgentsMd,
  setCodexAgentsMd,
  setFeedback,
}: CodexPersonalizationSectionProps) {
  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">codex / personalization</p>

      <p className="settings-server-subtitle">// agent instructions (AGENTS.md)</p>
      <p className="raw-path">~/.codex/AGENTS.md</p>
      {codexLoading ? (
        <p className="settings-memory-desc">loading...</p>
      ) : (
        <textarea
          className="settings-personalization-textarea"
          value={codexAgentsMd}
          onChange={e => setCodexAgentsMd(e.target.value)}
          placeholder="(file not found or empty)"
          style={{ minHeight: '280px' }}
        />
      )}
      <div className="settings-codex-field-row">
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => {
            void window.orxa.app
              .writeTextFile('~/.codex/AGENTS.md', codexAgentsMd)
              .then(() => setFeedback('AGENTS.md saved'))
              .catch((error: unknown) =>
                setFeedback(error instanceof Error ? error.message : String(error))
              )
          }}
        >
          save
        </button>
        <button
          type="button"
          className="settings-server-btn"
          onClick={() => {
            void window.orxa.app
              .readTextFile('~/.codex/AGENTS.md')
              .then(content => {
                setCodexAgentsMd(content)
                setFeedback('AGENTS.md refreshed')
              })
              .catch((error: unknown) =>
                setFeedback(error instanceof Error ? error.message : String(error))
              )
          }}
        >
          refresh
        </button>
      </div>
    </section>
  )
}

export function CodexDirsSection() {
  return (
    <section className="settings-section-card settings-pad settings-server-grid">
      <p className="settings-server-title">codex / directories</p>

      <p className="settings-server-subtitle">// codex directories</p>
      <div className="settings-claude-dirs">
        <div className="settings-dir-row">
          <span className="settings-server-status-key">~/.codex/memories/</span>
          <button
            type="button"
            className="settings-server-btn"
            onClick={() => void window.orxa.app.revealInFinder('~/.codex/memories')}
          >
            open in finder
          </button>
        </div>
        <div className="settings-dir-row">
          <span className="settings-server-status-key">~/.codex/skills/</span>
          <button
            type="button"
            className="settings-server-btn"
            onClick={() => void window.orxa.app.revealInFinder('~/.codex/skills')}
          >
            open in finder
          </button>
        </div>
      </div>
    </section>
  )
}
