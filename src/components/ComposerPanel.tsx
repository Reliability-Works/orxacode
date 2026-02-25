import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";
import { Check, ChevronDown, GitBranch, Plus, Search as SearchIcon, Shield, Zap } from "lucide-react";
import type { Attachment } from "../hooks/useComposerState";
import type { ModelOption } from "../lib/models";
import type { PermissionMode } from "../types/app";
import { IconButton } from "./IconButton";

type Command = {
  name: string;
  description?: string;
};

type ComposerPanelProps = {
  placeholder: string;
  composer: string;
  setComposer: (value: string) => void;
  composerAttachments: Attachment[];
  removeAttachment: (url: string) => void;
  slashMenuOpen: boolean;
  filteredSlashCommands: Command[];
  slashSelectedIndex: number;
  insertSlashCommand: (name: string) => void;
  handleSlashKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  sendPrompt: () => void | Promise<void>;
  abortActiveSession: () => void | Promise<void>;
  isSessionBusy: boolean;
  isSendingPrompt: boolean;
  pickImageAttachment: () => void | Promise<void>;
  hasActiveSession: boolean;
  isPlanMode: boolean;
  hasPlanAgent: boolean;
  togglePlanMode: (enabled: boolean) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  compactionProgress: number;
  compactionHint: string;
  compactionCompacted: boolean;
  branchMenuOpen: boolean;
  setBranchMenuOpen: (updater: (value: boolean) => boolean) => void;
  branchControlWidthCh: number;
  branchLoading: boolean;
  branchSwitching: boolean;
  hasActiveProject: boolean;
  branchCurrent?: string;
  branchDisplayValue: string;
  branchSearchInputRef: RefObject<HTMLInputElement | null>;
  branchQuery: string;
  setBranchQuery: (value: string) => void;
  checkoutBranch: (name: string) => void | Promise<void>;
  filteredBranches: string[];
  openBranchCreateModal: () => void | Promise<void>;
  modelSelectOptions: ModelOption[];
  selectedModel?: string;
  setSelectedModel: (value: string | undefined) => void;
  selectedVariant?: string;
  setSelectedVariant: (value: string | undefined) => void;
  variantOptions: string[];
  onLayoutHeightChange?: (height: number) => void;
};

const COMPOSER_MIN_HEIGHT = 96;
const COMPOSER_MAX_HEIGHT = 360;
const COMPOSER_DEFAULT_HEIGHT = 118;

export function ComposerPanel(props: ComposerPanelProps) {
  const {
    placeholder,
    composer,
    setComposer,
    composerAttachments,
    removeAttachment,
    slashMenuOpen,
    filteredSlashCommands,
    slashSelectedIndex,
    insertSlashCommand,
    handleSlashKeyDown,
    sendPrompt,
    abortActiveSession,
    isSessionBusy,
    isSendingPrompt,
    pickImageAttachment,
    hasActiveSession,
    isPlanMode,
    hasPlanAgent,
    togglePlanMode,
    permissionMode,
    onPermissionModeChange,
    compactionProgress,
    compactionHint,
    compactionCompacted,
    branchMenuOpen,
    setBranchMenuOpen,
    branchControlWidthCh,
    branchLoading,
    branchSwitching,
    hasActiveProject,
    branchCurrent,
    branchDisplayValue,
    branchSearchInputRef,
    branchQuery,
    setBranchQuery,
    checkoutBranch,
    filteredBranches,
    openBranchCreateModal,
    modelSelectOptions,
    selectedModel,
    setSelectedModel,
    selectedVariant,
    setSelectedVariant,
    variantOptions,
    onLayoutHeightChange,
  } = props;
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [composerHeight, setComposerHeight] = useState(COMPOSER_DEFAULT_HEIGHT);
  const [composerResizeActive, setComposerResizeActive] = useState(false);
  const permissionMenuRef = useRef<HTMLDivElement | null>(null);
  const composerZoneRef = useRef<HTMLElement | null>(null);
  const composerResizeRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const clampedCompactionProgress = Math.max(0, Math.min(1, compactionProgress));
  const compactionProgressStyle = useMemo(
    () =>
      ({
        "--compaction-progress": `${Math.round(clampedCompactionProgress * 100)}%`,
      }) as CSSProperties,
    [clampedCompactionProgress],
  );
  const permissionLabel = permissionMode === "yolo-write" ? "Yolo Mode" : "Default Permissions";

  useEffect(() => {
    if (!permissionMenuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (permissionMenuRef.current?.contains(target)) {
        return;
      }
      setPermissionMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setPermissionMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [permissionMenuOpen]);

  useEffect(() => {
    if (!composerResizeActive) {
      return;
    }
    const onPointerMove = (event: MouseEvent) => {
      const state = composerResizeRef.current;
      if (!state) {
        return;
      }
      const nextHeight = Math.max(COMPOSER_MIN_HEIGHT, Math.min(COMPOSER_MAX_HEIGHT, state.startHeight + (state.startY - event.clientY)));
      setComposerHeight(nextHeight);
    };
    const onPointerUp = () => {
      setComposerResizeActive(false);
      composerResizeRef.current = null;
    };
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    document.body.style.userSelect = "none";
    document.body.style.cursor = "ns-resize";
    return () => {
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [composerResizeActive]);

  const startComposerResize = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    composerResizeRef.current = {
      startY: event.clientY,
      startHeight: composerHeight,
    };
    setComposerResizeActive(true);
  }, [composerHeight]);

  useLayoutEffect(() => {
    if (!onLayoutHeightChange) {
      return;
    }
    const element = composerZoneRef.current;
    if (!element) {
      return;
    }
    let frameId: number | null = null;
    const report = () => {
      const nextHeight = Math.max(0, Math.round(element.getBoundingClientRect().height));
      onLayoutHeightChange(nextHeight);
    };
    const scheduleReport = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        report();
      });
    };

    report();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleReport);
      return () => {
        window.removeEventListener("resize", scheduleReport);
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
        }
      };
    }
    const observer = new ResizeObserver(() => {
      scheduleReport();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [onLayoutHeightChange]);

  return (
    <section ref={composerZoneRef} className="composer-zone">
      <div className="composer-input-wrap">
        <button
          type="button"
          className={`composer-resize-handle ${composerResizeActive ? "is-active" : ""}`.trim()}
          aria-label="Resize composer"
          onMouseDown={startComposerResize}
        />
        <textarea
          placeholder={placeholder}
          value={composer}
          style={{ height: `${composerHeight}px` }}
          onChange={(event) => setComposer(event.target.value)}
          onKeyDown={(event) => {
            if (slashMenuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Tab" || event.key === "Escape")) {
              handleSlashKeyDown(event);
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (slashMenuOpen) {
                const command = filteredSlashCommands[slashSelectedIndex];
                if (command) {
                  insertSlashCommand(command.name);
                }
                return;
              }
              if (isSessionBusy) {
                void abortActiveSession();
              } else if (isSendingPrompt) {
                return;
              } else {
                void sendPrompt();
              }
            }
          }}
        />
        <div className="composer-input-actions">
          <IconButton icon="plus" className="composer-attach-button" label="Add attachment" onClick={() => void pickImageAttachment()} />
          <IconButton
            icon={isSessionBusy ? "stop" : "send"}
            className={isSessionBusy ? "composer-send-button composer-stop-button" : "composer-send-button"}
            label={isSessionBusy ? "Stop" : "Send prompt"}
            onClick={() => (isSessionBusy ? void abortActiveSession() : void sendPrompt())}
            disabled={isSessionBusy ? false : !hasActiveSession}
          />
        </div>
      </div>

      {slashMenuOpen && filteredSlashCommands.length > 0 ? (
        <div className="slash-command-menu">
          <small>Commands</small>
          <div className="slash-command-list">
            {filteredSlashCommands.map((command, index) => (
              <button
                key={command.name}
                type="button"
                className={index === slashSelectedIndex ? "active" : ""}
                onClick={() => insertSlashCommand(command.name)}
              >
                <span className="slash-command-name">/{command.name}</span>
                <span className="slash-command-desc">{command.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {composerAttachments.length > 0 ? (
        <div className="composer-attachments">
          {composerAttachments.map((attachment) => (
            <button
              key={attachment.url}
              type="button"
              className="attachment-chip"
              onClick={() => removeAttachment(attachment.url)}
              title={`Remove ${attachment.filename}`}
            >
              {attachment.filename}
            </button>
          ))}
        </div>
      ) : null}

      <div className="composer-controls">
        <label className="agent-mode-toggle plan-toggle-inline">
          <input
            type="checkbox"
            checked={isPlanMode}
            disabled={!hasPlanAgent}
            onChange={(event) => togglePlanMode(event.target.checked)}
          />
          Plan mode
        </label>
        <div ref={permissionMenuRef} className={`composer-permission-wrap ${permissionMenuOpen ? "open" : ""}`.trim()}>
          <button
            type="button"
            className="composer-permission-control"
            title="Permission mode"
            onClick={() => setPermissionMenuOpen((value) => !value)}
            aria-expanded={permissionMenuOpen}
            aria-haspopup="menu"
          >
            {permissionMode === "yolo-write" ? <Zap size={13} aria-hidden="true" /> : <Shield size={13} aria-hidden="true" />}
            <span className="composer-permission-label">{permissionLabel}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {permissionMenuOpen ? (
            <div className="composer-permission-menu" role="menu" aria-label="Permission mode">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={permissionMode === "ask-write"}
                className={permissionMode === "ask-write" ? "active" : ""}
                onClick={() => {
                  onPermissionModeChange("ask-write");
                  setPermissionMenuOpen(false);
                }}
              >
                <span className="composer-permission-option-main">
                  <Shield size={13} aria-hidden="true" />
                  <span>Default Permissions</span>
                </span>
                {permissionMode === "ask-write" ? <Check size={13} aria-hidden="true" /> : null}
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={permissionMode === "yolo-write"}
                className={permissionMode === "yolo-write" ? "active" : ""}
                onClick={() => {
                  onPermissionModeChange("yolo-write");
                  setPermissionMenuOpen(false);
                }}
              >
                <span className="composer-permission-option-main">
                  <Zap size={13} aria-hidden="true" />
                  <span>Yolo Mode</span>
                </span>
                {permissionMode === "yolo-write" ? <Check size={13} aria-hidden="true" /> : null}
              </button>
            </div>
          ) : null}
        </div>
        <div className={`composer-branch-wrap ${branchMenuOpen ? "open" : ""}`.trim()}>
          <button
            type="button"
            className="composer-branch-control"
            style={{ width: `${branchControlWidthCh}ch` }}
            disabled={branchLoading || branchSwitching || !hasActiveProject}
            onClick={() => {
              setBranchMenuOpen((value) => {
                const next = !value;
                if (next) {
                  setBranchQuery("");
                }
                return next;
              });
            }}
            title={branchCurrent || "Branch"}
          >
            <span className="composer-branch-leading">
              <GitBranch size={14} aria-hidden="true" />
              <span className="composer-branch-label">{branchDisplayValue}</span>
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {branchMenuOpen ? (
            <div className="composer-branch-menu">
              <div className="composer-branch-search">
                <SearchIcon size={13} aria-hidden="true" />
                <input
                  ref={branchSearchInputRef}
                  value={branchQuery}
                  onChange={(event) => setBranchQuery(event.target.value)}
                  placeholder="Search branches"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void checkoutBranch(branchQuery);
                    }
                  }}
                />
              </div>
              <small>Branches</small>
              <div className="composer-branch-list">
                {filteredBranches.length === 0 ? (
                  <p>No branches found</p>
                ) : (
                  filteredBranches.map((branch) => (
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
              <button
                type="button"
                className="composer-branch-create"
                disabled={branchLoading || branchSwitching}
                onClick={() => void openBranchCreateModal()}
              >
                <Plus size={14} aria-hidden="true" />
                Create and checkout new branch...
              </button>
            </div>
          ) : null}
        </div>
        <ModelPicker
          modelSelectOptions={modelSelectOptions}
          selectedModel={selectedModel}
          setSelectedModel={setSelectedModel}
          selectedVariant={selectedVariant}
          setSelectedVariant={setSelectedVariant}
          variantOptions={variantOptions}
        />
        <div
          className={`composer-compaction-indicator composer-compaction-indicator-inline ${compactionCompacted ? "compacted" : ""}`.trim()}
          title={compactionHint}
          aria-label={compactionHint}
        >
          <span className="composer-compaction-glyph" style={compactionProgressStyle} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

type ModelPickerProps = {
  modelSelectOptions: ModelOption[];
  selectedModel: string | undefined;
  setSelectedModel: (value: string | undefined) => void;
  selectedVariant: string | undefined;
  setSelectedVariant: (value: string | undefined) => void;
  variantOptions: string[];
};

function ModelPicker({ modelSelectOptions, selectedModel, setSelectedModel, selectedVariant, setSelectedVariant, variantOptions }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(
    () => modelSelectOptions.find((m) => m.key === selectedModel),
    [modelSelectOptions, selectedModel],
  );

  const providerGroups = useMemo(() => {
    const filtered = query.trim()
      ? modelSelectOptions.filter(
          (m) =>
            m.modelName.toLowerCase().includes(query.toLowerCase()) ||
            m.providerName.toLowerCase().includes(query.toLowerCase()),
        )
      : modelSelectOptions;

    const map = new Map<string, { id: string; name: string; models: ModelOption[] }>();
    for (const m of filtered) {
      if (!map.has(m.providerID)) {
        map.set(m.providerID, { id: m.providerID, name: m.providerName, models: [] });
      }
      map.get(m.providerID)!.models.push(m);
    }
    return [...map.values()];
  }, [modelSelectOptions, query]);

  const handleSelect = useCallback(
    (key: string) => {
      setSelectedModel(key);
      setOpen(false);
      setQuery("");
    },
    [setSelectedModel],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open]);

  const displayLabel = selectedOption
    ? `${selectedOption.providerName}/${selectedOption.modelName}`
    : "Select model";

  return (
    <div className="model-picker-wrap">
      <button
        type="button"
        className="composer-select composer-model-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Select model"
        title={displayLabel}
      >
        <span className="model-btn-label">{displayLabel}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>

      {variantOptions.length > 0 ? (
        <select
          className="composer-select composer-variant-select"
          aria-label="Variant"
          value={selectedVariant ?? ""}
          onChange={(event) => setSelectedVariant(event.target.value || undefined)}
        >
          <option value="">(default)</option>
          {variantOptions.map((variant) => (
            <option key={variant} value={variant}>
              {variant}
            </option>
          ))}
        </select>
      ) : null}

      {open ? (
        <div className="model-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setOpen(false); setQuery(""); } }}>
          <div className="model-modal">
            <div className="model-modal-header">
              <h3>Select Model</h3>
              <div className="model-modal-search">
                <SearchIcon size={14} aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models..."
                />
              </div>
              <button type="button" className="model-modal-close" onClick={() => { setOpen(false); setQuery(""); }}>Close</button>
            </div>
            <div className="model-modal-body">
              {providerGroups.length === 0 ? (
                <p className="model-picker-empty">No models found</p>
              ) : (
                <div className="model-modal-columns">
                  {providerGroups.map((group) => (
                    <div key={group.id} className="model-modal-column">
                      <div className="model-modal-provider">{group.name}</div>
                      {group.models.map((m) => (
                        <button
                          key={m.key}
                          type="button"
                          className={`model-modal-item${selectedModel === m.key ? " active" : ""}`}
                          onClick={() => handleSelect(m.key)}
                        >
                          {selectedModel === m.key ? <Check size={12} aria-hidden="true" /> : null}
                          <span>{m.modelName}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { Command, ComposerPanelProps };
