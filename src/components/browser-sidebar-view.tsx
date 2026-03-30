import { type MutableRefObject } from 'react'
import { ArrowLeft, ArrowRight, Crosshair, Plus, RefreshCw } from 'lucide-react'
import type { McpDevToolsServerState } from '@shared/ipc'
import type { BrowserSidebarStateView } from '../lib/app-session-utils'
import { McpStatusIndicator } from './McpStatusIndicator'
import type { BrowserAnnotation } from './browser-sidebar-state'
import { BrowserSidebarAnnotationsPanel } from './browser-sidebar-annotations-panel'
import { BrowserSidebarMenuBar } from './browser-sidebar-menubar'

export type BrowserSidebarViewProps = {
  browserState: BrowserSidebarStateView
  browserUrlInput: string
  browserHistoryValue: string
  openMenu: string | null
  setOpenMenu: (value: string | null) => void
  closeMenu: () => void
  menubarRef: MutableRefObject<HTMLElement | null>
  browserViewportHostRef: MutableRefObject<HTMLDivElement | null>
  inspectMode: boolean
  setInspectMode: (value: boolean) => void
  annotations: BrowserAnnotation[]
  copied: boolean
  updateAnnotationComment: (id: string, comment: string) => void
  removeAnnotation: (id: string) => void
  clearAnnotations: () => void
  copyAnnotationsPrompt: () => void
  runBrowserAction: (action: () => void | Promise<void>) => void
  submitBrowserNavigation: () => void
  setBrowserUrlInput: (value: string) => void
  setBrowserHistoryValue: (value: string) => void
  onBrowserOpenTab?: () => Promise<void> | void
  onBrowserCloseTab?: (tabID: string) => Promise<void> | void
  onBrowserGoBack: () => Promise<void> | void
  onBrowserGoForward: () => Promise<void> | void
  onBrowserReload: () => Promise<void> | void
  onBrowserSelectTab: (tabID: string) => Promise<void> | void
  onBrowserSelectHistory: (url: string) => Promise<void> | void
  onBrowserTakeControl: () => Promise<void> | void
  onBrowserHandBack: () => Promise<void> | void
  onBrowserStop: () => Promise<void> | void
  onCollapse?: () => void
  mcpDevToolsState?: McpDevToolsServerState
}

function BrowserTabStrip({
  browserState,
  onBrowserCloseTab,
  onBrowserOpenTab,
  onBrowserSelectTab,
  runBrowserAction,
}: Pick<
  BrowserSidebarViewProps,
  'browserState' | 'onBrowserCloseTab' | 'onBrowserOpenTab' | 'onBrowserSelectTab' | 'runBrowserAction'
>) {
  return (
    <div className="browser-tab-strip" role="tablist" aria-label="Browser tabs">
      {browserState.tabs.length === 0 ? (
        <span className="browser-tab-empty">No tabs</span>
      ) : (
        browserState.tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.isActive}
            className={`browser-tab ${tab.isActive ? 'active' : ''}`.trim()}
            onClick={() => runBrowserAction(() => onBrowserSelectTab(tab.id))}
            title={tab.url || tab.title}
          >
            <span className="browser-tab-title">{tab.title || tab.url || 'Untitled'}</span>
            {onBrowserCloseTab ? (
              <span
                role="button"
                tabIndex={0}
                className="browser-tab-close"
                aria-label={`Close ${tab.title || tab.url || 'tab'}`}
                onClick={event => {
                  event.stopPropagation()
                  runBrowserAction(() => onBrowserCloseTab(tab.id))
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    event.stopPropagation()
                    runBrowserAction(() => onBrowserCloseTab(tab.id))
                  }
                }}
              >
                ×
              </span>
            ) : null}
          </button>
        ))
      )}
      {onBrowserOpenTab ? (
        <button
          type="button"
          className="browser-tab browser-tab-add"
          onClick={() => runBrowserAction(onBrowserOpenTab)}
          title="Open new tab"
          aria-label="Open new tab"
        >
          <Plus size={11} />
        </button>
      ) : null}
    </div>
  )
}

function BrowserNavRow({
  browserState,
  browserUrlInput,
  onBrowserGoBack,
  onBrowserGoForward,
  onBrowserReload,
  runBrowserAction,
  setBrowserUrlInput,
  submitBrowserNavigation,
}: Pick<
  BrowserSidebarViewProps,
  | 'browserState'
  | 'browserUrlInput'
  | 'onBrowserGoBack'
  | 'onBrowserGoForward'
  | 'onBrowserReload'
  | 'runBrowserAction'
  | 'setBrowserUrlInput'
  | 'submitBrowserNavigation'
>) {
  return (
    <div className="browser-nav-row">
      <div className="browser-nav-group">
        <button
          type="button"
          className="browser-nav-btn"
          onClick={() => runBrowserAction(onBrowserGoBack)}
          disabled={!browserState.canGoBack}
          aria-label="Back"
          title="Back"
        >
          <ArrowLeft size={13} />
        </button>
        <button
          type="button"
          className="browser-nav-btn"
          onClick={() => runBrowserAction(onBrowserGoForward)}
          disabled={!browserState.canGoForward}
          aria-label="Forward"
          title="Forward"
        >
          <ArrowRight size={13} />
        </button>
        <button
          type="button"
          className="browser-nav-btn"
          onClick={() => runBrowserAction(onBrowserReload)}
          aria-label="Reload"
          title={browserState.isLoading ? 'Loading...' : 'Reload'}
        >
          <RefreshCw size={13} className={browserState.isLoading ? 'spin' : ''} />
        </button>
      </div>
      <form
        className="browser-url-form"
        onSubmit={event => {
          event.preventDefault()
          submitBrowserNavigation()
        }}
      >
        <input
          type="text"
          className="browser-url-input"
          value={browserUrlInput}
          placeholder="Search or enter URL"
          onChange={event => setBrowserUrlInput(event.target.value)}
          aria-label="Browser URL"
        />
        <button type="submit" className="browser-url-go" aria-label="Navigate" tabIndex={-1}>
          Go
        </button>
      </form>
    </div>
  )
}

function BrowserControlStrip({
  browserState,
  inspectMode,
  mcpDevToolsState,
  onBrowserHandBack,
  onBrowserStop,
  onBrowserTakeControl,
  setInspectMode,
}: Pick<
  BrowserSidebarViewProps,
  | 'browserState'
  | 'inspectMode'
  | 'mcpDevToolsState'
  | 'onBrowserHandBack'
  | 'onBrowserStop'
  | 'onBrowserTakeControl'
  | 'setInspectMode'
>) {
  return (
    <div className="browser-control-strip">
      <span className={`browser-owner-chip owner-${browserState.controlOwner}`.trim()}>
        {browserState.controlOwner === 'human' ? 'human' : 'agent'}
      </span>
      {mcpDevToolsState ? <McpStatusIndicator state={mcpDevToolsState} /> : null}
      <div className="browser-control-actions">
        <button
          type="button"
          className={`browser-control-btn ${inspectMode ? 'active' : ''}`.trim()}
          onClick={() => setInspectMode(!inspectMode)}
          aria-label="Toggle inspect mode"
          title={inspectMode ? 'Exit inspect mode' : 'Inspect elements'}
        >
          <Crosshair size={12} />
          inspect
        </button>
        <button
          type="button"
          className="browser-control-btn"
          onClick={() => {
            void (browserState.controlOwner === 'human' ? onBrowserHandBack : onBrowserTakeControl)()
          }}
        >
          {browserState.controlOwner === 'human' ? 'hand back' : 'take control'}
        </button>
        <button
          type="button"
          className="browser-control-btn danger"
          onClick={() => void onBrowserStop()}
          disabled={!(browserState.canStop ?? browserState.actionRunning)}
        >
          stop
        </button>
      </div>
    </div>
  )
}

function BrowserSidebarHistorySelect({
  browserHistoryValue,
  browserState,
  onBrowserSelectHistory,
  runBrowserAction,
  setBrowserHistoryValue,
}: Pick<
  BrowserSidebarViewProps,
  'browserHistoryValue' | 'browserState' | 'onBrowserSelectHistory' | 'runBrowserAction' | 'setBrowserHistoryValue'
>) {
  return (
    <select
      className="browser-history-select"
      value={browserHistoryValue}
      onChange={event => {
        const selected = event.target.value
        setBrowserHistoryValue(selected)
        if (selected) {
          runBrowserAction(() => onBrowserSelectHistory(selected))
        }
      }}
      aria-label="Browser history"
      hidden
    >
      <option value="">History</option>
      {browserState.history.map(entry => (
        <option key={entry.id} value={entry.url}>
          {entry.label}
        </option>
      ))}
    </select>
  )
}

function BrowserViewportPane({
  activeUrl,
  browserViewportHostRef,
}: {
  activeUrl: string | null | undefined
  browserViewportHostRef: MutableRefObject<HTMLDivElement | null>
}) {
  return (
    <div className="browser-viewport-pane">
      <div ref={browserViewportHostRef} className="browser-viewport-host">
        <span className="browser-viewport-label">Renderer viewport host</span>
        <span className="browser-viewport-url">{activeUrl || 'No active URL'}</span>
      </div>
    </div>
  )
}

function BrowserSidebarContent({
  annotations,
  browserHistoryValue,
  browserState,
  browserUrlInput,
  browserViewportHostRef,
  clearAnnotations,
  copied,
  copyAnnotationsPrompt,
  inspectMode,
  mcpDevToolsState,
  onBrowserCloseTab,
  onBrowserGoBack,
  onBrowserGoForward,
  onBrowserHandBack,
  onBrowserOpenTab,
  onBrowserReload,
  onBrowserSelectHistory,
  onBrowserSelectTab,
  onBrowserStop,
  onBrowserTakeControl,
  removeAnnotation,
  runBrowserAction,
  setBrowserHistoryValue,
  setBrowserUrlInput,
  setInspectMode,
  submitBrowserNavigation,
  updateAnnotationComment,
}: Omit<
  BrowserSidebarViewProps,
  'closeMenu' | 'menubarRef' | 'openMenu' | 'setOpenMenu' | 'onCollapse'
>) {
  return (
    <section className="ops-section ops-section-fill browser-pane">
      <BrowserTabStrip
        browserState={browserState}
        onBrowserCloseTab={onBrowserCloseTab}
        onBrowserOpenTab={onBrowserOpenTab}
        onBrowserSelectTab={onBrowserSelectTab}
        runBrowserAction={runBrowserAction}
      />
      <BrowserNavRow
        browserState={browserState}
        browserUrlInput={browserUrlInput}
        onBrowserGoBack={onBrowserGoBack}
        onBrowserGoForward={onBrowserGoForward}
        onBrowserReload={onBrowserReload}
        runBrowserAction={runBrowserAction}
        setBrowserUrlInput={setBrowserUrlInput}
        submitBrowserNavigation={submitBrowserNavigation}
      />
      <BrowserSidebarHistorySelect
        browserHistoryValue={browserHistoryValue}
        browserState={browserState}
        onBrowserSelectHistory={onBrowserSelectHistory}
        runBrowserAction={runBrowserAction}
        setBrowserHistoryValue={setBrowserHistoryValue}
      />
      <BrowserControlStrip
        browserState={browserState}
        inspectMode={inspectMode}
        mcpDevToolsState={mcpDevToolsState}
        onBrowserHandBack={onBrowserHandBack}
        onBrowserStop={onBrowserStop}
        onBrowserTakeControl={onBrowserTakeControl}
        setInspectMode={setInspectMode}
      />
      <BrowserSidebarAnnotationsPanel
        annotations={annotations}
        clearAnnotations={clearAnnotations}
        copied={copied}
        copyAnnotationsPrompt={copyAnnotationsPrompt}
        removeAnnotation={removeAnnotation}
        updateAnnotationComment={updateAnnotationComment}
      />
      {!browserState.modeEnabled ? <p className="browser-mode-note">browser mode disabled</p> : null}
      <BrowserViewportPane
        activeUrl={browserState.activeUrl}
        browserViewportHostRef={browserViewportHostRef}
      />
    </section>
  )
}

export function BrowserSidebarView({
  annotations,
  browserHistoryValue,
  browserState,
  browserUrlInput,
  browserViewportHostRef,
  clearAnnotations,
  closeMenu,
  copied,
  copyAnnotationsPrompt,
  inspectMode,
  mcpDevToolsState,
  menubarRef,
  onBrowserCloseTab,
  onBrowserGoBack,
  onBrowserGoForward,
  onBrowserHandBack,
  onBrowserOpenTab,
  onBrowserReload,
  onBrowserSelectHistory,
  onBrowserSelectTab,
  onBrowserStop,
  onBrowserTakeControl,
  onCollapse,
  openMenu,
  removeAnnotation,
  runBrowserAction,
  setBrowserHistoryValue,
  setBrowserUrlInput,
  setInspectMode,
  setOpenMenu,
  submitBrowserNavigation,
  updateAnnotationComment,
}: BrowserSidebarViewProps) {
  return (
    <aside className="sidebar browser-sidebar">
      <BrowserSidebarMenuBar
        browserState={browserState}
        closeMenu={closeMenu}
        menubarRef={menubarRef}
        onBrowserCloseTab={onBrowserCloseTab}
        onBrowserGoBack={onBrowserGoBack}
        onBrowserGoForward={onBrowserGoForward}
        onBrowserOpenTab={onBrowserOpenTab}
        onBrowserReload={onBrowserReload}
        onBrowserSelectHistory={onBrowserSelectHistory}
        onBrowserStop={onBrowserStop}
        openMenu={openMenu}
        runBrowserAction={runBrowserAction}
        setBrowserUrlInput={setBrowserUrlInput}
        setOpenMenu={setOpenMenu}
        onCollapse={onCollapse}
      />
      <BrowserSidebarContent
        annotations={annotations}
        browserHistoryValue={browserHistoryValue}
        browserState={browserState}
        browserUrlInput={browserUrlInput}
        browserViewportHostRef={browserViewportHostRef}
        clearAnnotations={clearAnnotations}
        copied={copied}
        copyAnnotationsPrompt={copyAnnotationsPrompt}
        inspectMode={inspectMode}
        mcpDevToolsState={mcpDevToolsState}
        onBrowserCloseTab={onBrowserCloseTab}
        onBrowserGoBack={onBrowserGoBack}
        onBrowserGoForward={onBrowserGoForward}
        onBrowserHandBack={onBrowserHandBack}
        onBrowserOpenTab={onBrowserOpenTab}
        onBrowserReload={onBrowserReload}
        onBrowserSelectHistory={onBrowserSelectHistory}
        onBrowserSelectTab={onBrowserSelectTab}
        onBrowserStop={onBrowserStop}
        onBrowserTakeControl={onBrowserTakeControl}
        removeAnnotation={removeAnnotation}
        runBrowserAction={runBrowserAction}
        setBrowserHistoryValue={setBrowserHistoryValue}
        setBrowserUrlInput={setBrowserUrlInput}
        setInspectMode={setInspectMode}
        submitBrowserNavigation={submitBrowserNavigation}
        updateAnnotationComment={updateAnnotationComment}
      />
    </aside>
  )
}
