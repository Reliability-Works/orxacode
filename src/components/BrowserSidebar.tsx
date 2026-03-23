import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ClipboardCopy, Crosshair, PanelRightClose, Plus, RefreshCw, Trash2, X } from "lucide-react";
import type { McpDevToolsServerState } from "@shared/ipc";
import type { BrowserSidebarStateView } from "../lib/app-session-utils";
import { McpStatusIndicator } from "./McpStatusIndicator";

export interface BrowserAnnotation {
  id: string;
  /** Human-readable name like 'button "Save"' */
  element: string;
  /** CSS selector path */
  selector: string;
  /** User's note (editable) */
  comment: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  computedStyles?: string;
  timestamp: number;
}

type BrowserSidebarProps = {
  browserState: BrowserSidebarStateView;
  onBrowserOpenTab?: () => Promise<void> | void;
  onBrowserCloseTab?: (tabID: string) => Promise<void> | void;
  onBrowserNavigate: (url: string) => Promise<void> | void;
  onBrowserGoBack: () => Promise<void> | void;
  onBrowserGoForward: () => Promise<void> | void;
  onBrowserReload: () => Promise<void> | void;
  onBrowserSelectTab: (tabID: string) => Promise<void> | void;
  onBrowserSelectHistory: (url: string) => Promise<void> | void;
  onBrowserReportViewportBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<void> | void;
  onBrowserTakeControl: () => Promise<void> | void;
  onBrowserHandBack: () => Promise<void> | void;
  onBrowserStop: () => Promise<void> | void;
  onCollapse?: () => void;
  onStatusChange: (message: string) => void;
  onSendAnnotations?: (text: string) => void;
  mcpDevToolsState?: McpDevToolsServerState;
};

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
  const [browserUrlInput, setBrowserUrlInput] = useState("");
  const [browserHistoryValue, setBrowserHistoryValue] = useState("");
  const browserViewportHostRef = useRef<HTMLDivElement | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menubarRef = useRef<HTMLElement | null>(null);
  const [inspectMode, setInspectMode] = useState(false);
  const [annotations, setAnnotations] = useState<BrowserAnnotation[]>([]);

  // Listen for annotation events from the main process
  useEffect(() => {
    if (!window.orxa?.events?.subscribe) return;
    const unsubscribe = window.orxa.events.subscribe((event: { type: string; payload: unknown }) => {
      if (event.type === "browser.inspect.annotation" && inspectMode) {
        const payload = event.payload as {
          element: string;
          selector: string;
          boundingBox?: { x: number; y: number; width: number; height: number };
          computedStyles?: string;
        };
        setAnnotations((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            element: payload.element,
            selector: payload.selector,
            comment: "",
            boundingBox: payload.boundingBox,
            computedStyles: payload.computedStyles,
            timestamp: Date.now(),
          },
        ]);
      }
    });
    return unsubscribe;
  }, [inspectMode]);

  const closeMenu = useCallback(() => setOpenMenu(null), []);

  const updateAnnotationComment = useCallback((id: string, comment: string) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, comment } : a)));
  }, []);

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAnnotations = useCallback(() => {
    setAnnotations([]);
  }, []);

  const formatAnnotationsMarkdown = useCallback((): string => {
    const lines = ["## Browser Annotations", ""];
    if (browserState.activeUrl) {
      lines.push(`**URL:** ${browserState.activeUrl}`, "");
    }
    for (const a of annotations) {
      lines.push(`- **${a.element}**`);
      lines.push(`  - Selector: \`${a.selector}\``);
      if (a.comment) {
        lines.push(`  - Note: ${a.comment}`);
      }
      if (a.boundingBox) {
        const { x, y, width, height } = a.boundingBox;
        lines.push(`  - Bounds: ${width}x${height} at (${x}, ${y})`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }, [annotations, browserState.activeUrl]);

  const [copied, setCopied] = useState(false);

  const copyAnnotationsPrompt = useCallback(() => {
    if (annotations.length === 0) return;
    const prompt = formatAnnotationsMarkdown() + "\nPlease review these annotated elements and address the notes above.";
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [annotations, formatAnnotationsMarkdown]);

  useEffect(() => {
    if (!openMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menubarRef.current && !menubarRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [openMenu, closeMenu]);

  const runBrowserAction = (action: () => void | Promise<void>) => {
    void Promise.resolve(action()).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(message);
    });
  };

  useEffect(() => {
    setBrowserUrlInput(browserState.activeUrl);
  }, [browserState.activeUrl]);

  useEffect(() => {
    setBrowserHistoryValue("");
  }, [browserState.history, browserState.activeTabID]);

  useLayoutEffect(() => {
    const host = browserViewportHostRef.current;
    if (!host) {
      return;
    }
    let frameID: number | null = null;
    const report = () => {
      const rect = host.getBoundingClientRect();
      void onBrowserReportViewportBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    const schedule = () => {
      if (frameID !== null) {
        window.cancelAnimationFrame(frameID);
      }
      frameID = window.requestAnimationFrame(() => {
        frameID = null;
        report();
      });
    };

    report();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);

    // Re-report during CSS transitions (e.g. sidebar open/close shifts position)
    let transitionFrameId: number | null = null;
    let transitionEnd = 0;
    const pollDuringTransition = () => {
      report();
      if (Date.now() < transitionEnd) {
        transitionFrameId = window.requestAnimationFrame(pollDuringTransition);
      } else {
        transitionFrameId = null;
      }
    };
    const handleTransitionStart = () => {
      transitionEnd = Date.now() + 400; // cover 340ms transition + buffer
      if (transitionFrameId === null) {
        transitionFrameId = window.requestAnimationFrame(pollDuringTransition);
      }
    };
    // Listen on the workspace element for grid column transitions
    const workspace = host.closest(".workspace");
    workspace?.addEventListener("transitionstart", handleTransitionStart);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        schedule();
      });
      observer.observe(host);
    }
    return () => {
      observer?.disconnect();
      workspace?.removeEventListener("transitionstart", handleTransitionStart);
      if (transitionFrameId !== null) window.cancelAnimationFrame(transitionFrameId);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (frameID !== null) {
        window.cancelAnimationFrame(frameID);
      }
    };
  }, [onBrowserReportViewportBounds, browserState.activeTabID, browserState.activeUrl]);

  const submitBrowserNavigation = () => {
    const rawValue = browserUrlInput.trim();
    if (!rawValue) {
      return;
    }
    const normalized = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
    setBrowserUrlInput(normalized);
    runBrowserAction(() => onBrowserNavigate(normalized));
  };

  return (
    <aside className="sidebar browser-sidebar">
      <div className="browser-sidebar-header">
        <nav ref={menubarRef} className="browser-menubar" aria-label="Browser menu bar">
          {/* File */}
          <div className="browser-menu-wrap">
            <button
              type="button"
              className={`browser-menubar-item ${openMenu === "file" ? "is-open" : ""}`.trim()}
              onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}
              onMouseEnter={() => openMenu && setOpenMenu("file")}
            >
              File
            </button>
            {openMenu === "file" ? (
              <div className="browser-menu-dropdown" role="menu">
                <button type="button" role="menuitem" onClick={() => { closeMenu(); void onBrowserOpenTab?.(); }}>
                  New Tab
                </button>
                {browserState.activeTabID && onBrowserCloseTab ? (
                  <button type="button" role="menuitem" onClick={() => { closeMenu(); void onBrowserCloseTab(browserState.activeTabID!); }}>
                    Close Tab
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Edit */}
          <div className="browser-menu-wrap">
            <button
              type="button"
              className={`browser-menubar-item ${openMenu === "edit" ? "is-open" : ""}`.trim()}
              onClick={() => setOpenMenu(openMenu === "edit" ? null : "edit")}
              onMouseEnter={() => openMenu && setOpenMenu("edit")}
            >
              Edit
            </button>
            {openMenu === "edit" ? (
              <div className="browser-menu-dropdown" role="menu">
                <button type="button" role="menuitem" onClick={() => { closeMenu(); document.execCommand("copy"); }}>
                  Copy URL
                </button>
                <button type="button" role="menuitem" onClick={() => {
                  closeMenu();
                  void navigator.clipboard.readText().then((text) => {
                    if (text.trim()) {
                      setBrowserUrlInput(text.trim());
                    }
                  });
                }}>
                  Paste URL
                </button>
              </div>
            ) : null}
          </div>

          {/* View */}
          <div className="browser-menu-wrap">
            <button
              type="button"
              className={`browser-menubar-item ${openMenu === "view" ? "is-open" : ""}`.trim()}
              onClick={() => setOpenMenu(openMenu === "view" ? null : "view")}
              onMouseEnter={() => openMenu && setOpenMenu("view")}
            >
              View
            </button>
            {openMenu === "view" ? (
              <div className="browser-menu-dropdown" role="menu">
                <button type="button" role="menuitem" onClick={() => { closeMenu(); runBrowserAction(onBrowserReload); }}>
                  Reload
                </button>
                <button type="button" role="menuitem" onClick={() => { closeMenu(); runBrowserAction(onBrowserStop); }}>
                  Stop
                </button>
              </div>
            ) : null}
          </div>

          {/* History */}
          <div className="browser-menu-wrap">
            <button
              type="button"
              className={`browser-menubar-item ${openMenu === "history" ? "is-open" : ""}`.trim()}
              onClick={() => setOpenMenu(openMenu === "history" ? null : "history")}
              onMouseEnter={() => openMenu && setOpenMenu("history")}
            >
              History
            </button>
            {openMenu === "history" ? (
              <div className="browser-menu-dropdown" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={!browserState.canGoBack}
                  onClick={() => { closeMenu(); runBrowserAction(onBrowserGoBack); }}
                >
                  Back
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!browserState.canGoForward}
                  onClick={() => { closeMenu(); runBrowserAction(onBrowserGoForward); }}
                >
                  Forward
                </button>
                {browserState.history.length > 0 ? (
                  <>
                    <div className="browser-menu-separator" />
                    {browserState.history.slice(0, 10).map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        role="menuitem"
                        onClick={() => { closeMenu(); runBrowserAction(() => onBrowserSelectHistory(entry.url)); }}
                        title={entry.url}
                      >
                        {entry.label}
                      </button>
                    ))}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </nav>

        {onCollapse ? (
          <button
            type="button"
            className="browser-sidebar-collapse"
            onClick={onCollapse}
            aria-label="Collapse browser sidebar"
            title="Collapse browser sidebar"
          >
            <PanelRightClose size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <section className="ops-section ops-section-fill browser-pane">
        <div className="browser-tab-strip" role="tablist" aria-label="Browser tabs">
          {browserState.tabs.length === 0 ? (
            <span className="browser-tab-empty">No tabs</span>
          ) : (
            browserState.tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.isActive}
                className={`browser-tab ${tab.isActive ? "active" : ""}`.trim()}
                onClick={() => runBrowserAction(() => onBrowserSelectTab(tab.id))}
                title={tab.url || tab.title}
              >
                <span className="browser-tab-title">{tab.title || tab.url || "Untitled"}</span>
                {onBrowserCloseTab ? (
                  <span
                    role="button"
                    tabIndex={0}
                    className="browser-tab-close"
                    aria-label={`Close ${tab.title || tab.url || "tab"}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      runBrowserAction(() => onBrowserCloseTab(tab.id));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        runBrowserAction(() => onBrowserCloseTab(tab.id));
                      }
                    }}
                  >
                    <X size={11} />
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
              title={browserState.isLoading ? "Loading..." : "Reload"}
            >
              <RefreshCw size={13} className={browserState.isLoading ? "spin" : ""} />
            </button>
          </div>
          <form
            className="browser-url-form"
            onSubmit={(event) => {
              event.preventDefault();
              submitBrowserNavigation();
            }}
          >
            <input
              type="text"
              className="browser-url-input"
              value={browserUrlInput}
              placeholder="Search or enter URL"
              onChange={(event) => setBrowserUrlInput(event.target.value)}
              aria-label="Browser URL"
            />
            <button type="submit" className="browser-url-go" aria-label="Navigate" tabIndex={-1}>Go</button>
          </form>
        </div>

        {/* History select preserved for onBrowserSelectHistory but hidden from view */}
        <select
          className="browser-history-select"
          value={browserHistoryValue}
          onChange={(event) => {
            const selected = event.target.value;
            setBrowserHistoryValue(selected);
            if (selected) {
              runBrowserAction(() => onBrowserSelectHistory(selected));
            }
          }}
          aria-label="Browser history"
          hidden
        >
          <option value="">History</option>
          {browserState.history.map((entry) => (
            <option key={entry.id} value={entry.url}>
              {entry.label}
            </option>
          ))}
        </select>

        <div className="browser-control-strip">
          <span className={`browser-owner-chip owner-${browserState.controlOwner}`.trim()}>
            {browserState.controlOwner === "human" ? "human" : "agent"}
          </span>
          {mcpDevToolsState ? <McpStatusIndicator state={mcpDevToolsState} /> : null}
          <div className="browser-control-actions">
            <button
              type="button"
              className={`browser-control-btn ${inspectMode ? "active" : ""}`.trim()}
              onClick={() => {
                const next = !inspectMode;
                setInspectMode(next);
                if (next) {
                  void window.orxa?.browser?.inspectEnable?.();
                } else {
                  void window.orxa?.browser?.inspectDisable?.();
                }
              }}
              aria-label="Toggle inspect mode"
              title={inspectMode ? "Exit inspect mode" : "Inspect elements"}
            >
              <Crosshair size={12} />
              inspect
            </button>
            <button
              type="button"
              className="browser-control-btn"
              onClick={() => runBrowserAction(browserState.controlOwner === "human" ? onBrowserHandBack : onBrowserTakeControl)}
            >
              {browserState.controlOwner === "human" ? "hand back" : "take control"}
            </button>
            <button
              type="button"
              className="browser-control-btn danger"
              onClick={() => runBrowserAction(onBrowserStop)}
              disabled={!(browserState.canStop ?? browserState.actionRunning)}
            >
              stop
            </button>
          </div>
        </div>

        {annotations.length > 0 ? (
          <div className="browser-annotations-panel">
            <div className="browser-annotations-header">
              <span className="browser-annotations-title">
                Annotations ({annotations.length})
              </span>
            </div>
            <div className="browser-annotations-list">
              {annotations.map((annotation) => (
                <div key={annotation.id} className="browser-annotation-row">
                  <div className="browser-annotation-info">
                    <span className="browser-annotation-element" title={annotation.element}>
                      {annotation.element}
                    </span>
                    <span className="browser-annotation-selector" title={annotation.selector}>
                      {annotation.selector}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="browser-annotation-delete"
                    onClick={() => removeAnnotation(annotation.id)}
                    aria-label={`Remove annotation for ${annotation.element}`}
                    title="Remove annotation"
                  >
                    <X size={11} />
                  </button>
                  <input
                    type="text"
                    className="browser-annotation-comment"
                    value={annotation.comment}
                    onChange={(e) => updateAnnotationComment(annotation.id, e.target.value)}
                    placeholder="Add a note..."
                    aria-label={`Note for ${annotation.element}`}
                  />
                </div>
              ))}
            </div>
            <div className="browser-annotations-actions">
              <button
                type="button"
                className="browser-control-btn"
                onClick={copyAnnotationsPrompt}
                disabled={annotations.length === 0}
                title="Copy annotations as a prompt to clipboard"
              >
                {copied ? <Check size={11} /> : <ClipboardCopy size={11} />}
                {copied ? "Copied!" : "Copy prompt"}
              </button>
              <button
                type="button"
                className="browser-control-btn danger"
                onClick={clearAnnotations}
                title="Clear all annotations"
              >
                <Trash2 size={11} />
                Clear all
              </button>
            </div>
          </div>
        ) : null}

        {!browserState.modeEnabled ? (
          <p className="browser-mode-note">browser mode disabled</p>
        ) : null}

        <div className="browser-viewport-pane">
          <div ref={browserViewportHostRef} className="browser-viewport-host">
            <span className="browser-viewport-label">Renderer viewport host</span>
            <span className="browser-viewport-url">{browserState.activeUrl || "No active URL"}</span>
          </div>
        </div>
      </section>
    </aside>
  );
}
