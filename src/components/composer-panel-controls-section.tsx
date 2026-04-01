import { memo, useRef, useState, type CSSProperties } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  Compass,
  GitBranch,
  Plus,
  Search as SearchIcon,
  Shield,
  Zap,
} from 'lucide-react'
import { ModelPicker } from './composer-panel-model-picker'
import type { ComposerPanelProps } from './ComposerPanel.impl'
import type { PermissionMode } from '../types/app'
import type { SessionGuardrailState } from '../lib/session-controls'
import { useDismissibleLayer } from './composer/useDismissibleLayer'

type ComposerControlsSectionProps = Pick<
  ComposerPanelProps,
  | 'agentOptions'
  | 'selectedAgent'
  | 'onAgentChange'
  | 'permissionMode'
  | 'onPermissionModeChange'
  | 'guardrailState'
  | 'isPlanMode'
  | 'hasPlanAgent'
  | 'togglePlanMode'
  | 'browserModeEnabled'
  | 'setBrowserModeEnabled'
  | 'hideBrowserToggle'
  | 'hidePlanToggle'
  | 'branchMenuOpen'
  | 'setBranchMenuOpen'
  | 'branchLoading'
  | 'branchSwitching'
  | 'hasActiveProject'
  | 'branchCurrent'
  | 'branchDisplayValue'
  | 'branchSearchInputRef'
  | 'branchQuery'
  | 'setBranchQuery'
  | 'branchActionError'
  | 'clearBranchActionError'
  | 'checkoutBranch'
  | 'filteredBranches'
  | 'openBranchCreateModal'
  | 'modelSelectOptions'
  | 'selectedModel'
  | 'setSelectedModel'
  | 'selectedVariant'
  | 'setSelectedVariant'
  | 'variantOptions'
  | 'variantLabel'
  | 'variantEmptyLabel'
  | 'customControls'
  | 'compactionProgress'
  | 'compactionHint'
  | 'compactionCompacted'
>

function ComposerAgentMenu({
  agentOptions,
  selectedAgent,
  onAgentChange,
}: Pick<ComposerControlsSectionProps, 'agentOptions' | 'selectedAgent' | 'onAgentChange'>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useDismissibleLayer(open, ref, () => setOpen(false))
  if (agentOptions.length === 0) {
    return null
  }
  return (
    <div ref={ref} className={`composer-agent-wrap ${open ? 'open' : ''}`.trim()}>
      <button
        type="button"
        className="composer-agent-control"
        title={selectedAgent ? `Agent: ${selectedAgent}` : 'Select agent'}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Bot size={11} aria-hidden="true" />
        <span className="composer-pill-label">{selectedAgent ?? 'agent'}</span>
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {open ? (
        <div className="composer-agent-menu" role="menu" aria-label="Select agent">
          {agentOptions.map(agent => (
            <button
              key={agent.name}
              type="button"
              role="menuitemradio"
              aria-checked={agent.name === selectedAgent}
              className={agent.name === selectedAgent ? 'active' : ''}
              onClick={() => {
                onAgentChange(agent.name)
                setOpen(false)
              }}
            >
              <span className="composer-agent-option-main">
                <span>{agent.name}</span>
                <span className={`composer-agent-mode-badge ${agent.mode}`}>{agent.mode}</span>
              </span>
              {agent.name === selectedAgent ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ComposerPermissionMenu({
  permissionMode,
  onPermissionModeChange,
}: Pick<ComposerControlsSectionProps, 'permissionMode' | 'onPermissionModeChange'>) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)
  useDismissibleLayer(open, ref, () => setOpen(false))
  const permissionLabel = permissionMode === 'yolo-write' ? 'yolo mode' : 'restricted'
  const permissionOptions: Array<{
    mode: PermissionMode
    label: string
    Icon: typeof Shield
  }> = [
    { mode: 'ask-write', label: 'restricted', Icon: Shield },
    { mode: 'yolo-write', label: 'yolo mode', Icon: Zap },
  ]

  return (
    <div ref={ref} className={`composer-permission-wrap ${open ? 'open' : ''}`.trim()}>
      <button
        type="button"
        className="composer-permission-control"
        title="Permission mode"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {permissionMode === 'yolo-write' ? (
          <Zap size={11} aria-hidden="true" />
        ) : (
          <Shield size={11} aria-hidden="true" />
        )}
        <span className="composer-pill-label">{permissionLabel}</span>
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {open ? (
        <div className="composer-permission-menu" role="menu" aria-label="Permission mode">
          {permissionOptions.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              type="button"
              role="menuitemradio"
              aria-checked={permissionMode === mode}
              className={permissionMode === mode ? 'active' : ''}
              onClick={() => {
                onPermissionModeChange(mode as PermissionMode)
                setOpen(false)
              }}
            >
              <span className="composer-permission-option-main">
                <Icon size={13} aria-hidden="true" />
                <span>{label}</span>
              </span>
              {permissionMode === mode ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ComposerBranchMenu({
  branchMenuOpen,
  setBranchMenuOpen,
  branchLoading,
  branchSwitching,
  hasActiveProject,
  branchCurrent,
  branchDisplayValue,
  branchSearchInputRef,
  branchQuery,
  setBranchQuery,
  branchActionError,
  clearBranchActionError,
  checkoutBranch,
  filteredBranches,
  openBranchCreateModal,
}: Pick<
  ComposerControlsSectionProps,
  | 'branchMenuOpen'
  | 'setBranchMenuOpen'
  | 'branchLoading'
  | 'branchSwitching'
  | 'hasActiveProject'
  | 'branchCurrent'
  | 'branchDisplayValue'
  | 'branchSearchInputRef'
  | 'branchQuery'
  | 'setBranchQuery'
  | 'branchActionError'
  | 'clearBranchActionError'
  | 'checkoutBranch'
  | 'filteredBranches'
  | 'openBranchCreateModal'
>) {
  if (!hasActiveProject) {
    return null
  }
  return (
    <div className={`composer-branch-wrap ${branchMenuOpen ? 'open' : ''}`.trim()}>
      <button
        type="button"
        className="composer-branch-control"
        disabled={branchLoading || branchSwitching}
        onClick={() =>
          setBranchMenuOpen(value => {
            const next = !value
            if (next) {
              setBranchQuery('')
              clearBranchActionError()
            }
            return next
          })
        }
        title={branchCurrent || 'Branch'}
      >
        <span className="composer-branch-leading">
          <GitBranch size={11} aria-hidden="true" />
          <span className="composer-pill-label">{branchDisplayValue}</span>
        </span>
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      {branchMenuOpen ? (
        <div className="composer-branch-menu">
          <ComposerBranchSearch
            branchSearchInputRef={branchSearchInputRef}
            branchQuery={branchQuery}
            setBranchQuery={setBranchQuery}
            clearBranchActionError={clearBranchActionError}
            checkoutBranch={checkoutBranch}
          />
          <small>Branches</small>
          <div className="composer-branch-error-slot">
            {branchActionError ? <p className="composer-branch-error">{branchActionError}</p> : null}
          </div>
          <ComposerBranchList
            branchCurrent={branchCurrent}
            filteredBranches={filteredBranches}
            checkoutBranch={checkoutBranch}
          />
          <button
            type="button"
            className="composer-branch-create"
            disabled={branchLoading || branchSwitching}
            onClick={() => void openBranchCreateModal()}
          >
            <Plus size={14} aria-hidden="true" />
            Create new branch
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ComposerBranchSearch({
  branchSearchInputRef,
  branchQuery,
  setBranchQuery,
  clearBranchActionError,
  checkoutBranch,
}: Pick<
  ComposerControlsSectionProps,
  | 'branchSearchInputRef'
  | 'branchQuery'
  | 'setBranchQuery'
  | 'clearBranchActionError'
  | 'checkoutBranch'
>) {
  return (
    <div className="composer-branch-search">
      <SearchIcon size={13} aria-hidden="true" />
      <input
        ref={branchSearchInputRef}
        value={branchQuery}
        onChange={event => {
          clearBranchActionError()
          setBranchQuery(event.target.value)
        }}
        placeholder="Search branches"
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void checkoutBranch(branchQuery)
          }
        }}
      />
    </div>
  )
}

function ComposerBranchList({
  branchCurrent,
  filteredBranches,
  checkoutBranch,
}: Pick<ComposerControlsSectionProps, 'branchCurrent' | 'filteredBranches' | 'checkoutBranch'>) {
  return (
    <div className="composer-branch-list">
      {filteredBranches.length === 0 ? (
        <p>No branches found</p>
      ) : (
        filteredBranches.map(branch => (
          <button key={branch} type="button" onClick={() => void checkoutBranch(branch)}>
            <span className="composer-branch-item-main">
              <GitBranch size={13} aria-hidden="true" />
              <span>{branch}</span>
            </span>
            {branch === branchCurrent ? <Check size={13} aria-hidden="true" /> : null}
          </button>
        ))
      )}
    </div>
  )
}

function ComposerCompactionIndicator({
  compactionProgress,
  compactionHint,
  compactionCompacted,
}: Pick<
  ComposerControlsSectionProps,
  'compactionProgress' | 'compactionHint' | 'compactionCompacted'
>) {
  const clampedCompactionProgress = Math.max(0, Math.min(1, compactionProgress))
  const compactionProgressStyle = {
    '--compaction-progress': `${Math.round(clampedCompactionProgress * 100)}%`,
  } as CSSProperties

  return (
    <div
      className={`composer-compaction-indicator composer-compaction-indicator-inline ${compactionCompacted ? 'compacted' : ''}`.trim()}
      title={compactionHint}
      aria-label={compactionHint}
    >
      <span
        className="composer-compaction-glyph"
        style={compactionProgressStyle}
        aria-hidden="true"
      />
      <span className="composer-compaction-label">
        {Math.round(clampedCompactionProgress * 100)}%
      </span>
    </div>
  )
}

function ComposerGuardrailIndicator({
  guardrailState,
}: {
  guardrailState?: SessionGuardrailState
}) {
  if (!guardrailState) {
    return null
  }
  const ratio = Math.max(guardrailState.tokenRatio, guardrailState.runtimeRatio)
  const label =
    guardrailState.status === 'disabled'
      ? 'limits off'
      : `limits ${Math.round(clamp01(ratio) * 100)}%`
  return (
    <div
      className={`composer-permission-control composer-guardrail-indicator composer-guardrail-indicator--${guardrailState.status}`.trim()}
      title={guardrailState.detail}
      aria-label={guardrailState.detail}
    >
      <Shield size={11} aria-hidden="true" />
      <span className="composer-pill-label">{label}</span>
    </div>
  )
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

export const ComposerControlsSection = memo(function ComposerControlsSection(props: ComposerControlsSectionProps) {
  const {
    agentOptions, selectedAgent, onAgentChange, permissionMode, onPermissionModeChange,
    isPlanMode, hasPlanAgent, togglePlanMode, browserModeEnabled, setBrowserModeEnabled,
    hideBrowserToggle, hidePlanToggle, branchMenuOpen, setBranchMenuOpen, branchLoading,
    branchSwitching, hasActiveProject, branchCurrent, branchDisplayValue, branchSearchInputRef,
    branchQuery, setBranchQuery, branchActionError, clearBranchActionError, checkoutBranch,
    filteredBranches, openBranchCreateModal, modelSelectOptions, selectedModel,
    setSelectedModel, selectedVariant, setSelectedVariant, variantOptions, variantLabel,
    variantEmptyLabel, customControls, compactionProgress, compactionHint, compactionCompacted,
    guardrailState,
  } = props

  return (
    <div className="composer-controls">
      <ComposerAgentMenu
        agentOptions={agentOptions}
        selectedAgent={selectedAgent}
        onAgentChange={onAgentChange}
      />
      {!hidePlanToggle ? (
        <button
          type="button"
          className={`plan-toggle-inline${isPlanMode ? ' is-active' : ''}`}
          disabled={!hasPlanAgent}
          onClick={() => togglePlanMode(!isPlanMode)}
          aria-pressed={isPlanMode}
          title={isPlanMode ? 'Disable plan mode' : 'Enable plan mode'}
          aria-label={isPlanMode ? 'Disable plan mode' : 'Enable plan mode'}
        >
          <span className="plan-toggle-square" aria-hidden="true" />
          <span className="composer-pill-label">plan mode</span>
        </button>
      ) : null}
      {!hideBrowserToggle ? (
        <button
          type="button"
          className={`composer-mode-toggle-icon ${browserModeEnabled ? 'is-active' : ''}`.trim()}
          aria-pressed={browserModeEnabled}
          onClick={() => setBrowserModeEnabled(!browserModeEnabled)}
          title={browserModeEnabled ? 'Browser mode enabled' : 'Browser mode disabled'}
          aria-label={browserModeEnabled ? 'Disable Browser mode' : 'Enable Browser mode'}
        >
          <Compass size={11} aria-hidden="true" />
          <span className="composer-pill-label">browser</span>
        </button>
      ) : null}
      <ComposerPermissionMenu
        permissionMode={permissionMode}
        onPermissionModeChange={onPermissionModeChange}
      />
      <ComposerBranchMenu
        branchMenuOpen={branchMenuOpen}
        setBranchMenuOpen={setBranchMenuOpen}
        branchLoading={branchLoading}
        branchSwitching={branchSwitching}
        hasActiveProject={hasActiveProject}
        branchCurrent={branchCurrent}
        branchDisplayValue={branchDisplayValue}
        branchSearchInputRef={branchSearchInputRef}
        branchQuery={branchQuery}
        setBranchQuery={setBranchQuery}
        branchActionError={branchActionError}
        clearBranchActionError={clearBranchActionError}
        checkoutBranch={checkoutBranch}
        filteredBranches={filteredBranches}
        openBranchCreateModal={openBranchCreateModal}
      />
      <ModelPicker
        modelSelectOptions={modelSelectOptions}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        selectedVariant={selectedVariant}
        setSelectedVariant={setSelectedVariant}
        variantOptions={variantOptions}
        variantLabel={variantLabel}
        variantEmptyLabel={variantEmptyLabel}
      />
      {customControls}
      <div style={{ flex: 1 }} aria-hidden="true" />
      <ComposerGuardrailIndicator guardrailState={guardrailState} />
      <ComposerCompactionIndicator
        compactionProgress={compactionProgress}
        compactionHint={compactionHint}
        compactionCompacted={compactionCompacted}
      />
    </div>
  )
})
