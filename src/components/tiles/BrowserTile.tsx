import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Globe, Lock, RefreshCw } from 'lucide-react'
import type { McpDevToolsServerState } from '@shared/ipc'
import { CanvasTileComponent } from '../CanvasTile'
import { McpStatusIndicator } from '../McpStatusIndicator'
import type { CanvasTileComponentProps } from './tile-shared'

interface BrowserTileProps extends CanvasTileComponentProps {
  mcpDevToolsState?: McpDevToolsServerState
}

const DEFAULT_URL = 'about:blank'

function normalizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'about:blank') return trimmed || DEFAULT_URL
  try {
    new URL(trimmed)
    return trimmed
  } catch {
    // No protocol — try adding https://
    const withProtocol = `https://${trimmed}`
    try {
      new URL(withProtocol)
      return withProtocol
    } catch {
      return trimmed
    }
  }
}

type BrowserTileToolbarProps = {
  canGoBack: boolean
  canGoForward: boolean
  inputValue: string
  isLoading: boolean
  mcpDevToolsState?: McpDevToolsServerState
  onBack: () => void
  onForward: () => void
  onInputChange: (value: string) => void
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onRefresh: () => void
}

function BrowserTileToolbar({
  canGoBack,
  canGoForward,
  inputValue,
  isLoading,
  mcpDevToolsState,
  onBack,
  onForward,
  onInputChange,
  onInputKeyDown,
  onRefresh,
}: BrowserTileToolbarProps) {
  return (
    <div className="browser-tile-url-bar">
      <button className="browser-tile-nav-btn" onClick={onBack} disabled={!canGoBack} title="Back" tabIndex={-1}>
        <ArrowLeft size={11} />
      </button>
      <button
        className="browser-tile-nav-btn"
        onClick={onForward}
        disabled={!canGoForward}
        title="Forward"
        tabIndex={-1}
      >
        <ArrowRight size={11} />
      </button>
      <Lock size={11} className="browser-tile-url-lock" />
      <input
        className="browser-tile-url-input"
        type="text"
        value={inputValue}
        onChange={event => onInputChange(event.target.value)}
        onKeyDown={onInputKeyDown}
        spellCheck={false}
        aria-label="URL"
      />
      <button
        className={`browser-tile-url-refresh${isLoading ? ' loading' : ''}`}
        onClick={onRefresh}
        title="Refresh"
        tabIndex={-1}
      >
        <RefreshCw size={11} />
      </button>
      {mcpDevToolsState ? <McpStatusIndicator state={mcpDevToolsState} /> : null}
    </div>
  )
}

function useBrowserTileNavigation(tile: BrowserTileProps['tile'], onUpdate: BrowserTileProps['onUpdate']) {
  const currentUrl = typeof tile.meta.url === 'string' ? tile.meta.url : DEFAULT_URL

  const [inputValue, setInputValue] = useState(currentUrl)
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [displayUrl, setDisplayUrl] = useState(currentUrl)
  const webviewRef = useRef<HTMLElement | null>(null)

  // Attach webview event listeners after it mounts
  useEffect(() => {
    const wv = webviewRef.current
    if (!wv) return

    const onStartLoading = () => setIsLoading(true)
    const onStopLoading = () => setIsLoading(false)
    const onNavigate = (event: Event) => {
      const url = (event as CustomEvent & { url?: string }).url ?? ''
      if (url) {
        setDisplayUrl(url)
        setInputValue(url)
        onUpdate(tile.id, { meta: { ...tile.meta, url } })
      }
      // Update nav state
      const webview = wv as unknown as { canGoBack: () => boolean; canGoForward: () => boolean }
      if (typeof webview.canGoBack === 'function') {
        setCanGoBack(webview.canGoBack())
        setCanGoForward(webview.canGoForward())
      }
    }

    wv.addEventListener('did-start-loading', onStartLoading)
    wv.addEventListener('did-stop-loading', onStopLoading)
    wv.addEventListener('did-navigate', onNavigate)
    wv.addEventListener('did-navigate-in-page', onNavigate)

    return () => {
      wv.removeEventListener('did-start-loading', onStartLoading)
      wv.removeEventListener('did-stop-loading', onStopLoading)
      wv.removeEventListener('did-navigate', onNavigate)
      wv.removeEventListener('did-navigate-in-page', onNavigate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleNavigate = useCallback(
    (rawUrl: string) => {
      const url = normalizeUrl(rawUrl)
      setInputValue(url)
      setDisplayUrl(url)
      onUpdate(tile.id, { meta: { ...tile.meta, url } })
      const wv = webviewRef.current as unknown as { loadURL?: (u: string) => void }
      if (wv?.loadURL) {
        wv.loadURL(url)
      }
    },
    [tile.id, tile.meta, onUpdate]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleNavigate(inputValue)
      }
    },
    [inputValue, handleNavigate]
  )

  const handleRefresh = useCallback(() => {
    const wv = webviewRef.current as unknown as { reload?: () => void }
    if (wv?.reload) {
      wv.reload()
    }
  }, [])

  const handleBack = useCallback(() => {
    const wv = webviewRef.current as unknown as { goBack?: () => void }
    if (wv?.goBack) wv.goBack()
  }, [])

  const handleForward = useCallback(() => {
    const wv = webviewRef.current as unknown as { goForward?: () => void }
    if (wv?.goForward) wv.goForward()
  }, [])

  return {
    currentUrl,
    inputValue,
    canGoBack,
    canGoForward,
    isLoading,
    displayUrl,
    webviewRef,
    handleKeyDown,
    handleRefresh,
    handleBack,
    handleForward,
    setInputValue,
  }
}

export function BrowserTile({
  tile,
  canvasTheme,
  onUpdate,
  onRemove,
  onBringToFront,
  snapToGrid,
  gridSize,
  allTiles,
  canvasOffsetX,
  canvasOffsetY,
  viewportScale,
  mcpDevToolsState,
}: BrowserTileProps) {
  const {
    currentUrl,
    inputValue,
    canGoBack,
    canGoForward,
    isLoading,
    displayUrl,
    webviewRef,
    handleKeyDown,
    handleRefresh,
    handleBack,
    handleForward,
    setInputValue,
  } = useBrowserTileNavigation(tile, onUpdate)
  const displayMeta =
    displayUrl === 'about:blank'
      ? 'about:blank'
      : (() => {
          try {
            return new URL(displayUrl).hostname || displayUrl
          } catch {
            return displayUrl
          }
        })()

  return (
    <CanvasTileComponent
      tile={tile}
      canvasTheme={canvasTheme}
      onUpdate={onUpdate}
      onRemove={onRemove}
      onBringToFront={onBringToFront}
      icon={<Globe size={12} />}
      label="browser"
      iconColor="#3B82F6"
      metadata={displayMeta}
      snapToGrid={snapToGrid}
      gridSize={gridSize}
      allTiles={allTiles}
      canvasOffsetX={canvasOffsetX}
      canvasOffsetY={canvasOffsetY}
      viewportScale={viewportScale}
    >
      <div className="browser-tile-body">
        <BrowserTileToolbar
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          inputValue={inputValue}
          isLoading={isLoading}
          mcpDevToolsState={mcpDevToolsState}
          onBack={handleBack}
          onForward={handleForward}
          onInputChange={setInputValue}
          onInputKeyDown={handleKeyDown}
          onRefresh={handleRefresh}
        />
        <div className="browser-tile-frame-wrapper">
          <webview
            ref={webviewRef}
            className="browser-tile-iframe"
            src={currentUrl}
            partition="persist:canvas-browser"
          />
        </div>
      </div>
    </CanvasTileComponent>
  )
}
