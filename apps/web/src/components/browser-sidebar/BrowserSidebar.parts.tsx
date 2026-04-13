import type { RefObject } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  GlobeIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'

import type {
  DesktopBrowserBridge,
  DesktopBrowserState,
  DesktopBrowserTabState,
} from '@orxa-code/contracts'
import { cn } from '~/lib/utils'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { BrowserInspectOverlay, BrowserInspectToggle } from './BrowserSidebarInspect'

export function BrowserSidebarHeader(props: {
  isRefreshing: boolean
  onRefresh: () => void
  onClose: () => void
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
      <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-xs font-medium text-foreground">Browser</span>
      <div className="ms-auto flex items-center gap-0.5">
        <Button
          size="xs"
          variant="ghost"
          onClick={props.onRefresh}
          disabled={props.isRefreshing}
          aria-label="Refresh browser sidebar"
          className="h-6 w-6 p-0"
        >
          <RefreshCwIcon className={cn('size-3', props.isRefreshing && 'animate-spin')} />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={props.onClose}
          aria-label="Close browser sidebar"
          className="h-6 w-6 p-0"
        >
          <XIcon className="size-3" />
        </Button>
      </div>
    </div>
  )
}

export function BrowserViewportHost(props: {
  activeUrl: string
  hostRef: RefObject<HTMLDivElement | null>
}) {
  const { activeUrl, hostRef } = props
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col border-t border-border">
      <div
        ref={hostRef}
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-muted/20"
        data-browser-viewport-host="true"
      >
        <div className="flex h-full min-h-0 min-w-0 items-center justify-center p-4">
          <div className="max-w-xs space-y-1 text-center">
            <p className="text-xs font-medium text-foreground">In-app browser viewport</p>
            <p className="break-all text-caption text-muted-foreground">
              {activeUrl || 'Open a page to begin browsing.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function BrowserUnavailableState() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-sm space-y-2 text-center">
        <p className="text-sm font-medium text-foreground">Browser unavailable</p>
        <p className="text-xs text-muted-foreground">
          The in-app browser is available only in the desktop app once the native runtime is ready.
        </p>
      </div>
    </div>
  )
}

export function BrowserErrorState(props: { message: string }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div className="max-w-sm space-y-2 text-center">
        <p className="text-sm font-medium text-foreground">Browser error</p>
        <p className="text-xs text-muted-foreground">{props.message}</p>
      </div>
    </div>
  )
}

function BrowserNavigationControls(props: {
  browserApi: DesktopBrowserBridge
  canGoBack: boolean
  canGoForward: boolean
  isLoading: boolean
  isRefreshing: boolean
  inspectMode: boolean
  onToggleInspectMode: () => void
  runAction: (action: () => Promise<unknown>) => void
}) {
  const {
    browserApi,
    canGoBack,
    canGoForward,
    isLoading,
    isRefreshing,
    inspectMode,
    onToggleInspectMode,
    runAction,
  } = props
  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => void runAction(() => browserApi.back())}
        disabled={!canGoBack || isRefreshing}
        aria-label="Back"
      >
        <ArrowLeftIcon className="size-3" />
      </Button>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => void runAction(() => browserApi.forward())}
        disabled={!canGoForward || isRefreshing}
        aria-label="Forward"
      >
        <ArrowRightIcon className="size-3" />
      </Button>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => void runAction(() => browserApi.reload())}
        disabled={isRefreshing}
        aria-label="Reload"
      >
        <RefreshCwIcon className={cn('size-3', isLoading && 'animate-spin')} />
      </Button>
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => void runAction(() => browserApi.openTab())}
        disabled={isRefreshing}
        aria-label="Open tab"
      >
        <PlusIcon className="size-3" />
      </Button>
      <BrowserInspectToggle
        inspectMode={inspectMode}
        disabled={isRefreshing}
        onToggle={onToggleInspectMode}
      />
    </div>
  )
}

function BrowserTabsStrip(props: {
  browserApi: DesktopBrowserBridge
  isRefreshing: boolean
  runAction: (action: () => Promise<unknown>) => void
  tabs: DesktopBrowserTabState[]
}) {
  const { browserApi, isRefreshing, runAction, tabs } = props
  if (tabs.length === 0) {
    return <span className="text-xs text-muted-foreground">No tabs</span>
  }
  return tabs.map(tab => (
    <div
      key={tab.id}
      className={cn(
        'flex max-w-52 items-center gap-1 rounded-full border pe-1',
        tab.isActive && 'border-foreground/20 bg-accent text-foreground'
      )}
    >
      <button
        type="button"
        className="min-w-0 flex-1 truncate px-2 py-1 text-left text-caption text-muted-foreground"
        onClick={() => void runAction(() => browserApi.switchTab(tab.id))}
        title={tab.url || tab.title}
        disabled={isRefreshing}
      >
        {tab.title || tab.url || 'Untitled'}
      </button>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="h-5 w-5 shrink-0 rounded-full p-0"
        onClick={() => void runAction(() => browserApi.closeTab(tab.id))}
        aria-label={`Close ${tab.title || tab.url || 'tab'}`}
        disabled={isRefreshing}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  ))
}

function BrowserAddressForm(props: {
  isRefreshing: boolean
  submitNavigation: () => void
  urlInput: string
  setUrlInput: (value: string) => void
}) {
  const { isRefreshing, submitNavigation, urlInput, setUrlInput } = props
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={event => {
        event.preventDefault()
        submitNavigation()
      }}
    >
      <Input
        nativeInput
        size="sm"
        value={urlInput}
        onChange={event => setUrlInput(event.target.value)}
        placeholder="Search or enter URL"
        aria-label="Browser URL"
      />
      <Button type="submit" size="xs" variant="outline" disabled={isRefreshing}>
        Go
      </Button>
    </form>
  )
}

function BrowserTabsRow(props: {
  browserApi: DesktopBrowserBridge
  isRefreshing: boolean
  runAction: (action: () => Promise<unknown>) => void
  tabs: DesktopBrowserTabState[]
}) {
  const { browserApi, isRefreshing, runAction, tabs } = props
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
      <BrowserTabsStrip
        browserApi={browserApi}
        isRefreshing={isRefreshing}
        runAction={runAction}
        tabs={tabs}
      />
    </div>
  )
}

export function BrowserSidebarLoadedBody(props: {
  activeState: DesktopBrowserState
  browserApi: DesktopBrowserBridge
  hostRef: RefObject<HTMLDivElement | null>
  isRefreshing: boolean
  inspectMode: boolean
  onToggleInspectMode: () => void
  runAction: (action: () => Promise<unknown>) => void
  submitNavigation: () => void
  urlInput: string
  setUrlInput: (value: string) => void
}) {
  const {
    activeState,
    browserApi,
    hostRef,
    isRefreshing,
    inspectMode,
    onToggleInspectMode,
    runAction,
    submitNavigation,
    urlInput,
    setUrlInput,
  } = props
  return (
    <>
      <div className="flex shrink-0 flex-col gap-2 border-b border-border p-3">
        <BrowserNavigationControls
          browserApi={browserApi}
          canGoBack={activeState.canGoBack}
          canGoForward={activeState.canGoForward}
          isLoading={activeState.isLoading}
          isRefreshing={isRefreshing}
          inspectMode={inspectMode}
          onToggleInspectMode={onToggleInspectMode}
          runAction={runAction}
        />
        <BrowserAddressForm
          isRefreshing={isRefreshing}
          submitNavigation={submitNavigation}
          urlInput={urlInput}
          setUrlInput={setUrlInput}
        />
        <BrowserTabsRow
          browserApi={browserApi}
          isRefreshing={isRefreshing}
          runAction={runAction}
          tabs={activeState.tabs}
        />
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <BrowserViewportHost activeUrl={activeState.activeUrl ?? ''} hostRef={hostRef} />
        <BrowserInspectOverlay inspectMode={inspectMode} />
      </div>
    </>
  )
}
