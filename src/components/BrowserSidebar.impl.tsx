import type { McpDevToolsServerState } from '@shared/ipc'
import type { BrowserSidebarStateView } from '../lib/app-session-utils'
import {
  BrowserSidebarView,
  type BrowserSidebarViewProps,
} from './browser-sidebar-view'
import {
  useBrowserSidebarAnnotations,
  useBrowserSidebarNavigation,
  useBrowserSidebarViewportReporter,
} from './browser-sidebar-state'

export type { BrowserAnnotation } from './browser-sidebar-state'

type BrowserSidebarProps = Omit<
  BrowserSidebarViewProps,
  | 'annotations'
  | 'browserHistoryValue'
  | 'browserUrlInput'
  | 'browserViewportHostRef'
  | 'clearAnnotations'
  | 'closeMenu'
  | 'copied'
  | 'copyAnnotationsPrompt'
  | 'inspectMode'
  | 'menubarRef'
  | 'openMenu'
  | 'removeAnnotation'
  | 'runBrowserAction'
  | 'setBrowserHistoryValue'
  | 'setBrowserUrlInput'
  | 'setInspectMode'
  | 'setOpenMenu'
  | 'submitBrowserNavigation'
  | 'updateAnnotationComment'
> & {
  browserState: BrowserSidebarStateView
  onBrowserOpenTab?: () => Promise<void> | void
  onBrowserCloseTab?: (tabID: string) => Promise<void> | void
  onBrowserNavigate: (url: string) => Promise<void> | void
  onBrowserGoBack: () => Promise<void> | void
  onBrowserGoForward: () => Promise<void> | void
  onBrowserReload: () => Promise<void> | void
  onBrowserSelectTab: (tabID: string) => Promise<void> | void
  onBrowserSelectHistory: (url: string) => Promise<void> | void
  onBrowserReportViewportBounds: (bounds: {
    x: number
    y: number
    width: number
    height: number
  }) => Promise<void> | void
  onBrowserTakeControl: () => Promise<void> | void
  onBrowserHandBack: () => Promise<void> | void
  onBrowserStop: () => Promise<void> | void
  onCollapse?: () => void
  onStatusChange: (message: string) => void
  onSendAnnotations?: (text: string) => void
  mcpDevToolsState?: McpDevToolsServerState
}

export function BrowserSidebar({
  browserState,
  onBrowserOpenTab,
  onBrowserCloseTab,
  onBrowserNavigate,
  onBrowserGoBack,
  onBrowserGoForward,
  onBrowserReload,
  onBrowserSelectTab,
  onBrowserSelectHistory,
  onBrowserReportViewportBounds,
  onBrowserTakeControl,
  onBrowserHandBack,
  onBrowserStop,
  onCollapse,
  onStatusChange,
  mcpDevToolsState,
}: BrowserSidebarProps) {
  const {
    browserHistoryValue,
    browserUrlInput,
    closeMenu,
    menubarRef,
    openMenu,
    runBrowserAction,
    setBrowserHistoryValue,
    setBrowserUrlInput,
    setOpenMenu,
    submitBrowserNavigation,
  } = useBrowserSidebarNavigation({
    browserState,
    onBrowserNavigate,
    onStatusChange,
  })
  const {
    annotations,
    clearAnnotations,
    copied,
    copyAnnotationsPrompt,
    inspectMode,
    removeAnnotation,
    setInspectMode,
    updateAnnotationComment,
  } = useBrowserSidebarAnnotations(browserState.activeUrl)
  const { browserViewportHostRef } = useBrowserSidebarViewportReporter({
    activeTabID: browserState.activeTabID ?? undefined,
    activeUrl: browserState.activeUrl ?? undefined,
    onBrowserReportViewportBounds,
  })

  return (
    <BrowserSidebarView
      annotations={annotations}
      browserHistoryValue={browserHistoryValue}
      browserState={browserState}
      browserUrlInput={browserUrlInput}
      browserViewportHostRef={browserViewportHostRef}
      clearAnnotations={clearAnnotations}
      closeMenu={closeMenu}
      copied={copied}
      copyAnnotationsPrompt={copyAnnotationsPrompt}
      inspectMode={inspectMode}
      mcpDevToolsState={mcpDevToolsState}
      menubarRef={menubarRef}
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
      onCollapse={onCollapse}
      openMenu={openMenu}
      removeAnnotation={removeAnnotation}
      runBrowserAction={runBrowserAction}
      setBrowserHistoryValue={setBrowserHistoryValue}
      setBrowserUrlInput={setBrowserUrlInput}
      setInspectMode={setInspectMode}
      setOpenMenu={setOpenMenu}
      submitBrowserNavigation={submitBrowserNavigation}
      updateAnnotationComment={updateAnnotationComment}
    />
  )
}
