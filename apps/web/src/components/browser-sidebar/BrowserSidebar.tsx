import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import type {
  DesktopBrowserBounds,
  DesktopBrowserBridge,
  DesktopBrowserState,
} from '@orxa-code/contracts'
import { readNativeApi } from '~/nativeApi'
import { useBrowserAnnotations } from './browserSidebar.annotations'
import {
  BrowserErrorState,
  BrowserSidebarHeader,
  BrowserSidebarLoadedBody,
  BrowserUnavailableState,
} from './BrowserSidebar.parts'
import {
  BrowserAnnotationsPanel,
} from './BrowserSidebarInspect'

const EMPTY_BROWSER_STATE: DesktopBrowserState = {
  tabs: [],
  activeTabId: null,
  activeUrl: null,
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  bounds: null,
}

function getBrowserApi(): DesktopBrowserBridge | null {
  const api = readNativeApi()
  return api?.browser ?? null
}

function normalizeUrlInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}


function useBrowserViewportReporter(
  hostRef: RefObject<HTMLDivElement | null>,
  browserApi: DesktopBrowserBridge | null,
  activeTabId: string | null,
  onBoundsReported?: (bounds: DesktopBrowserBounds) => void
) {
  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || !browserApi || !activeTabId) return

    let frameId: number | null = null
    let transitionFrameId: number | null = null
    let transitionEndAt = 0
    const reportBounds = () => {
      const rect = host.getBoundingClientRect()
      const nextBounds = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      } satisfies DesktopBrowserBounds
      onBoundsReported?.(nextBounds)
      void browserApi.setBounds(nextBounds)
    }
    const scheduleReport = () => {
      if (frameId !== null) return
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        reportBounds()
      })
    }
    const pollDuringTransition = () => {
      reportBounds()
      if (Date.now() < transitionEndAt) {
        transitionFrameId = window.requestAnimationFrame(pollDuringTransition)
      } else {
        transitionFrameId = null
      }
    }
    const handleTransitionStart = () => {
      transitionEndAt = Date.now() + 450
      if (transitionFrameId === null) {
        transitionFrameId = window.requestAnimationFrame(pollDuringTransition)
      }
    }

    reportBounds()
    window.requestAnimationFrame(reportBounds)

    const resizeObserver =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleReport) : null
    resizeObserver?.observe(host)
    window.addEventListener('resize', scheduleReport)
    window.addEventListener('scroll', scheduleReport, true)
    const workspace = host.closest('.workspace')
    workspace?.addEventListener('transitionstart', handleTransitionStart)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleReport)
      window.removeEventListener('scroll', scheduleReport, true)
      workspace?.removeEventListener('transitionstart', handleTransitionStart)
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      if (transitionFrameId !== null) window.cancelAnimationFrame(transitionFrameId)
      void browserApi.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
  }, [activeTabId, browserApi, hostRef, onBoundsReported])
}

export interface BrowserSidebarProps {
  onClose: () => void
}

function useBrowserSidebarState() {
  const browserApi = useMemo(() => getBrowserApi(), [])
  const ensuredInitialTabRef = useRef(false)
  const [actionPending, setActionPending] = useState(false)
  const stateQuery = useQuery({
    queryKey: ['browser-sidebar-state'],
    queryFn: async () => {
      if (!browserApi) return EMPTY_BROWSER_STATE
      return browserApi.getState()
    },
    enabled: browserApi !== null,
    initialData: EMPTY_BROWSER_STATE,
    refetchInterval: query => (query.state.data?.isLoading ? 500 : false),
  })
  const runAction = useCallback(
    async (action: () => Promise<unknown>) => {
      if (!browserApi) return
      setActionPending(true)
      try {
        await action()
      } finally {
        setActionPending(false)
        await stateQuery.refetch()
      }
    },
    [browserApi, stateQuery]
  )
  useEffect(() => {
    if (!browserApi || ensuredInitialTabRef.current) return
    if (stateQuery.isPending || stateQuery.isError) return
    if ((stateQuery.data?.tabs.length ?? 0) > 0) {
      ensuredInitialTabRef.current = true
      return
    }
    ensuredInitialTabRef.current = true
    void runAction(() => browserApi.openTab())
  }, [browserApi, runAction, stateQuery.data?.tabs.length, stateQuery.isError, stateQuery.isPending])
  return { browserApi, stateQuery, actionPending, runAction }
}

function useBrowserInspectSession(
  browserApi: DesktopBrowserBridge,
  inspectMode: boolean,
  addAnnotation: (annotation: import('@orxa-code/contracts').DesktopBrowserAnnotationCandidate) => void
) {
  useEffect(() => {
    if (!inspectMode) return
    let cancelled = false
    let timerId: number | null = null

    const poll = async () => {
      if (cancelled) return
      try {
        const annotation = await browserApi.pollInspectAnnotation()
        if (!cancelled && annotation) {
          addAnnotation(annotation)
        }
      } finally {
        if (!cancelled) {
          timerId = window.setTimeout(() => void poll(), 150)
        }
      }
    }

    void browserApi.enableInspect().then(() => {
      if (!cancelled) void poll()
    })

    return () => {
      cancelled = true
      if (timerId !== null) window.clearTimeout(timerId)
      void browserApi.disableInspect()
    }
  }, [addAnnotation, browserApi, inspectMode])
}

function BrowserSidebarErrorView(props: {
  error: unknown
  isRefreshing: boolean
  onClose: () => void
  onRefresh: () => void
}) {
  return (
    <>
      <BrowserSidebarHeader
        isRefreshing={props.isRefreshing}
        onRefresh={props.onRefresh}
        onClose={props.onClose}
      />
      <BrowserErrorState
        message={props.error instanceof Error ? props.error.message : 'Unknown error'}
      />
    </>
  )
}

function BrowserSidebarContent(props: {
  browserApi: DesktopBrowserBridge
  onClose: () => void
  runAction: (action: () => Promise<unknown>) => void
  stateQuery: UseQueryResult<DesktopBrowserState>
  actionPending: boolean
}) {
  const { browserApi, onClose, runAction, stateQuery, actionPending } = props
  const viewportHostRef = useRef<HTMLDivElement | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [inspectMode, setInspectMode] = useState(false)
  const {
    annotations,
    copied,
    addAnnotation,
    removeAnnotation,
    updateAnnotationComment,
    clearAnnotations,
    copyAnnotationsPrompt,
  } = useBrowserAnnotations(stateQuery.data?.activeUrl ?? null)

  useEffect(() => {
    setUrlInput(stateQuery.data?.activeUrl ?? '')
  }, [stateQuery.data?.activeUrl])

  const submitNavigation = useCallback(() => {
    const normalized = normalizeUrlInput(urlInput)
    if (!normalized || !browserApi) return
    setUrlInput(normalized)
    void runAction(() => browserApi.navigate(normalized))
  }, [browserApi, runAction, urlInput])

  const activeState = stateQuery.data ?? EMPTY_BROWSER_STATE
  const isRefreshing = actionPending || stateQuery.isFetching
  useBrowserViewportReporter(viewportHostRef, browserApi, activeState.activeTabId)
  useBrowserInspectSession(browserApi, inspectMode, addAnnotation)

  if (stateQuery.isError) {
    return (
      <BrowserSidebarErrorView
        error={stateQuery.error}
        isRefreshing={isRefreshing}
        onClose={onClose}
        onRefresh={() => void stateQuery.refetch()}
      />
    )
  }

  return (
    <>
      <BrowserSidebarHeader
        isRefreshing={isRefreshing}
        onRefresh={() => void stateQuery.refetch()}
        onClose={onClose}
      />
      <BrowserSidebarLoadedBody
        activeState={activeState}
        browserApi={browserApi}
        hostRef={viewportHostRef}
        isRefreshing={isRefreshing}
        inspectMode={inspectMode}
        onToggleInspectMode={() => setInspectMode(current => !current)}
        runAction={runAction}
        submitNavigation={submitNavigation}
        urlInput={urlInput}
        setUrlInput={setUrlInput}
      />
      <BrowserAnnotationsPanel
        annotations={annotations}
        copied={copied}
        onClear={clearAnnotations}
        onCopyPrompt={copyAnnotationsPrompt}
        onRemove={removeAnnotation}
        onUpdateComment={updateAnnotationComment}
      />
    </>
  )
}

export function BrowserSidebar({ onClose }: BrowserSidebarProps) {
  const { browserApi, stateQuery, actionPending, runAction } = useBrowserSidebarState()
  if (!browserApi) {
    return (
      <div className="flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background">
        <BrowserSidebarHeader isRefreshing={false} onRefresh={() => undefined} onClose={onClose} />
        <BrowserUnavailableState />
      </div>
    )
  }

  return (
    <div className="flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background">
      <BrowserSidebarContent
        browserApi={browserApi}
        onClose={onClose}
        runAction={runAction}
        stateQuery={stateQuery}
        actionPending={actionPending}
      />
    </div>
  )
}
