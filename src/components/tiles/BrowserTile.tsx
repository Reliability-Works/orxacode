import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Globe, Lock, RefreshCw } from "lucide-react";
import type { CanvasTile, CanvasTheme } from "../../types/canvas";
import { CanvasTileComponent } from "../CanvasTile";

interface BrowserTileProps {
  tile: CanvasTile;
  canvasTheme: CanvasTheme;
  onUpdate: (id: string, patch: Partial<CanvasTile>) => void;
  onRemove: (id: string) => void;
  onBringToFront: (id: string) => void;
  snapToGrid?: boolean;
  gridSize?: number;
  allTiles?: CanvasTile[];
}

const DEFAULT_URL = "about:blank";

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "about:blank") return trimmed || DEFAULT_URL;
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    // No protocol — try adding https://
    const withProtocol = `https://${trimmed}`;
    try {
      new URL(withProtocol);
      return withProtocol;
    } catch {
      return trimmed;
    }
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
}: BrowserTileProps) {
  const currentUrl =
    typeof tile.meta.url === "string" ? tile.meta.url : DEFAULT_URL;

  const [inputValue, setInputValue] = useState(currentUrl);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [displayUrl, setDisplayUrl] = useState(currentUrl);
  const webviewRef = useRef<HTMLElement | null>(null);

  // Attach webview event listeners after it mounts
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const onStartLoading = () => setIsLoading(true);
    const onStopLoading = () => setIsLoading(false);
    const onNavigate = (event: Event) => {
      const url = (event as CustomEvent & { url?: string }).url ?? "";
      if (url) {
        setDisplayUrl(url);
        setInputValue(url);
        onUpdate(tile.id, { meta: { ...tile.meta, url } });
      }
      // Update nav state
      const webview = wv as unknown as { canGoBack: () => boolean; canGoForward: () => boolean };
      if (typeof webview.canGoBack === "function") {
        setCanGoBack(webview.canGoBack());
        setCanGoForward(webview.canGoForward());
      }
    };

    wv.addEventListener("did-start-loading", onStartLoading);
    wv.addEventListener("did-stop-loading", onStopLoading);
    wv.addEventListener("did-navigate", onNavigate);
    wv.addEventListener("did-navigate-in-page", onNavigate);

    return () => {
      wv.removeEventListener("did-start-loading", onStartLoading);
      wv.removeEventListener("did-stop-loading", onStopLoading);
      wv.removeEventListener("did-navigate", onNavigate);
      wv.removeEventListener("did-navigate-in-page", onNavigate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNavigate = useCallback(
    (rawUrl: string) => {
      const url = normalizeUrl(rawUrl);
      setInputValue(url);
      setDisplayUrl(url);
      onUpdate(tile.id, { meta: { ...tile.meta, url } });
      const wv = webviewRef.current as unknown as { loadURL?: (u: string) => void };
      if (wv?.loadURL) {
        wv.loadURL(url);
      }
    },
    [tile.id, tile.meta, onUpdate],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        handleNavigate(inputValue);
      }
    },
    [inputValue, handleNavigate],
  );

  const handleRefresh = useCallback(() => {
    const wv = webviewRef.current as unknown as { reload?: () => void };
    if (wv?.reload) {
      wv.reload();
    }
  }, []);

  const handleBack = useCallback(() => {
    const wv = webviewRef.current as unknown as { goBack?: () => void };
    if (wv?.goBack) wv.goBack();
  }, []);

  const handleForward = useCallback(() => {
    const wv = webviewRef.current as unknown as { goForward?: () => void };
    if (wv?.goForward) wv.goForward();
  }, []);

  const displayMeta =
    displayUrl === "about:blank"
      ? "about:blank"
      : (() => {
          try {
            return new URL(displayUrl).hostname || displayUrl;
          } catch {
            return displayUrl;
          }
        })();

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
    >
      <div className="browser-tile-body">
        <div className="browser-tile-url-bar">
          <button
            className="browser-tile-nav-btn"
            onClick={handleBack}
            disabled={!canGoBack}
            title="Back"
            tabIndex={-1}
          >
            <ArrowLeft size={11} />
          </button>
          <button
            className="browser-tile-nav-btn"
            onClick={handleForward}
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
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            aria-label="URL"
          />
          <button
            className={`browser-tile-url-refresh${isLoading ? " loading" : ""}`}
            onClick={handleRefresh}
            title="Refresh"
            tabIndex={-1}
          >
            <RefreshCw size={11} />
          </button>
        </div>
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
  );
}
