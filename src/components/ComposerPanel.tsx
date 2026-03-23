import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Bot, Check, ChevronDown, Compass, GitBranch, Plus, Search as SearchIcon, Shield, X, Zap } from "lucide-react";
import type { Attachment } from "../hooks/useComposerState";
import type { ModelOption } from "../lib/models";
import type { PermissionMode } from "../types/app";
import { TodoDock } from "./chat/TodoDock";
import type { TodoItem } from "./chat/TodoDock";
import { ReviewChangesDock } from "./chat/ReviewChangesDock";
import type { ReviewChangeItem } from "./chat/ReviewChangesDock";
import { QuestionDock } from "./chat/QuestionDock";
import type { AgentQuestion } from "./chat/QuestionDock";
import { PermissionDock } from "./chat/PermissionDock";
import { PlanDock } from "./chat/PlanDock";
import { FollowupDock } from "./chat/FollowupDock";
import { QueuedMessagesDock } from "./chat/QueuedMessagesDock";
import { BackgroundAgentsPanel } from "./chat/BackgroundAgentsPanel";
import type { QueuedMessage } from "./chat/QueuedMessagesDock";
import type { UnifiedBackgroundAgentSummary } from "../lib/session-presentation";
import { useDismissibleLayer } from "./composer/useDismissibleLayer";
import { useComposerResize } from "./composer/useComposerResize";
import { useAttachmentPreview } from "./composer/useAttachmentPreview";

type AgentOption = {
  name: string;
  mode: "primary" | "subagent" | "all";
  description?: string;
};
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
  addComposerAttachments: (attachments: Attachment[]) => void;
  sendPrompt: () => void | Promise<void>;
  abortActiveSession: () => void | Promise<void>;
  isSessionBusy: boolean;
  isSendingPrompt: boolean;
  pickImageAttachment: () => void | Promise<void>;
  hasActiveSession: boolean;
  isPlanMode: boolean;
  hasPlanAgent: boolean;
  togglePlanMode: (enabled: boolean) => void;
  browserModeEnabled: boolean;
  setBrowserModeEnabled: (enabled: boolean) => void;
  hideBrowserToggle?: boolean;
  hidePlanToggle?: boolean;
  agentOptions: AgentOption[];
  selectedAgent?: string;
  onAgentChange: (name: string) => void;
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
  branchActionError: string | null;
  clearBranchActionError: () => void;
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
  /** When true, always use the compact dropdown model selector instead of the full modal picker.
   *  When omitted/false, auto-decides: ≤10 models → dropdown, >10 → modal. */
  simpleModelPicker?: boolean;
  todoItems?: TodoItem[];
  todoOpen?: boolean;
  onTodoToggle?: () => void;
  reviewChangesFiles?: ReviewChangeItem[];
  onOpenReviewChange?: (path: string) => void;
  backgroundAgents?: UnifiedBackgroundAgentSummary[];
  selectedBackgroundAgentId?: string | null;
  onOpenBackgroundAgent?: (id: string) => void;
  onCloseBackgroundAgent?: () => void;
  onArchiveBackgroundAgent?: (agent: UnifiedBackgroundAgentSummary) => void;
  backgroundAgentDetail?: ReactNode;
  backgroundAgentTaskText?: string | null;
  backgroundAgentDetailLoading?: boolean;
  backgroundAgentDetailError?: string | null;
  backgroundAgentTaggingHint?: string | null;
  pendingPlan?: {
    onAccept: () => void;
    onSubmitChanges: (changes: string) => void;
    onDismiss: () => void;
  } | null;
  pendingQuestion?: {
    questions: AgentQuestion[];
    onSubmit: (answers: Record<string, string | string[]>) => void;
    onReject: () => void;
  } | null;
  pendingPermission?: {
    description: string;
    filePattern?: string;
    command?: string[];
    onDecide: (decision: "allow_once" | "allow_always" | "reject") => void;
  } | null;
  followupSuggestions?: string[];
  onFollowupSelect?: (text: string) => void;
  onFollowupDismiss?: () => void;
  queuedMessages?: QueuedMessage[];
  sendingQueuedId?: string;
  onQueueMessage?: (text: string) => void;
  queuedActionKind?: "send" | "steer";
  onPrimaryQueuedAction?: (id: string) => void;
  onEditQueued?: (id: string) => void;
  onRemoveQueued?: (id: string) => void;
};

const COMPOSER_MIN_HEIGHT = 96;
const COMPOSER_MAX_HEIGHT = 360;
const COMPOSER_DEFAULT_HEIGHT = 118;

const IMAGE_FILENAME_FALLBACK = "pasted-image.png";

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Failed to read pasted image."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read pasted image."));
    reader.readAsDataURL(file);
  });
}

function isImageAttachment(attachment: Attachment) {
  return attachment.mime.startsWith("image/") || attachment.url.startsWith("data:image/") || attachment.url.startsWith("file:");
}

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
    addComposerAttachments,
    sendPrompt,
    abortActiveSession,
    isSessionBusy,
    isSendingPrompt,
    pickImageAttachment,
    hasActiveSession,
    isPlanMode,
    hasPlanAgent,
    togglePlanMode,
    browserModeEnabled,
    setBrowserModeEnabled,
    hideBrowserToggle,
    hidePlanToggle,
    agentOptions,
    selectedAgent,
    onAgentChange,
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
    branchActionError,
    clearBranchActionError,
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
    simpleModelPicker,
    todoItems,
    todoOpen,
    onTodoToggle,
    reviewChangesFiles,
    onOpenReviewChange,
    backgroundAgents,
    selectedBackgroundAgentId,
    onOpenBackgroundAgent,
    onCloseBackgroundAgent,
    onArchiveBackgroundAgent,
    backgroundAgentDetail,
    backgroundAgentTaskText,
    backgroundAgentDetailLoading,
    backgroundAgentDetailError,
    backgroundAgentTaggingHint,
    pendingPlan,
    pendingQuestion,
    pendingPermission,
    followupSuggestions,
    onFollowupSelect,
    onFollowupDismiss,
    queuedMessages,
    sendingQueuedId,
    onQueueMessage,
    queuedActionKind,
    onPrimaryQueuedAction,
    onEditQueued,
    onRemoveQueued,
  } = props;
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement | null>(null);
  const useDropdownModels = simpleModelPicker || modelSelectOptions.length <= 10;
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  const { composerHeight, composerResizeActive, startComposerResize } = useComposerResize({
    minHeight: COMPOSER_MIN_HEIGHT,
    maxHeight: COMPOSER_MAX_HEIGHT,
    defaultHeight: COMPOSER_DEFAULT_HEIGHT,
  });
  const { previewAttachment, setPreviewAttachment, clearPreviewAttachment } = useAttachmentPreview<Attachment>();
  const permissionMenuRef = useRef<HTMLDivElement | null>(null);
  const composerZoneRef = useRef<HTMLElement | null>(null);
  const clampedCompactionProgress = Math.max(0, Math.min(1, compactionProgress));
  const compactionProgressStyle = useMemo(
    () =>
      ({
        "--compaction-progress": `${Math.round(clampedCompactionProgress * 100)}%`,
      }) as CSSProperties,
    [clampedCompactionProgress],
  );
  const permissionLabel = permissionMode === "yolo-write" ? "yolo mode" : "restricted";

  useDismissibleLayer(permissionMenuOpen, permissionMenuRef, () => setPermissionMenuOpen(false));
  useDismissibleLayer(agentMenuOpen, agentMenuRef, () => setAgentMenuOpen(false));
  useDismissibleLayer(modelDropdownOpen, modelDropdownRef, () => setModelDropdownOpen(false));

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

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageFiles = items
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((item): item is File => Boolean(item));
      if (imageFiles.length === 0) {
        return;
      }
      event.preventDefault();
      void (async () => {
        const timestamp = Date.now();
        const attachments = await Promise.all(
          imageFiles.map(async (file, index) => {
            const dataUrl = await fileToDataUrl(file);
            const filename = file.name?.trim() || `pasted-image-${timestamp}-${index + 1}.png`;
            return {
              url: dataUrl,
              filename: filename || IMAGE_FILENAME_FALLBACK,
              mime: file.type || "image/png",
              path: `clipboard://${filename || IMAGE_FILENAME_FALLBACK}`,
            } satisfies Attachment;
          }),
        );
        addComposerAttachments(attachments);
      })().catch(() => undefined);
    },
    [addComposerAttachments],
  );

  return (
    <section ref={composerZoneRef} className="composer-zone">
      <div className="composer-docks-float">
        {queuedMessages && queuedMessages.length > 0 && onPrimaryQueuedAction && onEditQueued && onRemoveQueued ? (
          <QueuedMessagesDock
            messages={queuedMessages}
            sendingId={sendingQueuedId}
            actionKind={queuedActionKind}
            onPrimaryAction={onPrimaryQueuedAction}
            onEdit={onEditQueued}
            onRemove={onRemoveQueued}
          />
        ) : null}

        {backgroundAgents && backgroundAgents.length > 0 && onOpenBackgroundAgent && onCloseBackgroundAgent ? (
          <BackgroundAgentsPanel
            agents={backgroundAgents}
            selectedAgentId={selectedBackgroundAgentId}
            onOpenAgent={onOpenBackgroundAgent}
            onBack={onCloseBackgroundAgent}
            onArchiveAgent={onArchiveBackgroundAgent}
            detailBody={backgroundAgentDetail}
            detailTaskText={backgroundAgentTaskText}
            detailLoading={backgroundAgentDetailLoading}
            detailError={backgroundAgentDetailError}
            taggingHint={backgroundAgentTaggingHint}
          />
        ) : null}

        {onTodoToggle ? (
          reviewChangesFiles && reviewChangesFiles.length > 0 ? (
            <ReviewChangesDock
              files={reviewChangesFiles}
              open={todoOpen ?? false}
              onToggle={onTodoToggle}
              onOpenPath={onOpenReviewChange}
            />
          ) : todoItems && todoItems.length > 0 ? (
            <TodoDock
              items={todoItems}
              open={todoOpen ?? false}
              onToggle={onTodoToggle}
            />
          ) : null
        ) : null}

        {pendingPlan ? (
          <PlanDock
            onAccept={pendingPlan.onAccept}
            onSubmitChanges={pendingPlan.onSubmitChanges}
            onDismiss={pendingPlan.onDismiss}
          />
        ) : null}

        {pendingQuestion ? (
          <QuestionDock
            questions={pendingQuestion.questions}
            onSubmit={pendingQuestion.onSubmit}
            onReject={pendingQuestion.onReject}
          />
        ) : null}

        {pendingPermission ? (
          <PermissionDock
            description={pendingPermission.description}
            filePattern={pendingPermission.filePattern}
            command={pendingPermission.command}
            onDecide={pendingPermission.onDecide}
          />
        ) : null}

        {followupSuggestions && followupSuggestions.length > 0 && onFollowupSelect ? (
          <FollowupDock
            suggestions={followupSuggestions}
            onSelect={onFollowupSelect}
            onDismiss={onFollowupDismiss}
          />
        ) : null}
      </div>

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
          onPaste={handlePaste}
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
                const trimmed = composer.trim();
                if (trimmed && onQueueMessage) {
                  onQueueMessage(trimmed);
                }
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
          <div
            className={`composer-compaction-inline ${compactionCompacted ? "compacted" : ""}`.trim()}
            title={compactionHint}
          >
            <span className="composer-compaction-glyph" style={compactionProgressStyle} aria-hidden="true" />
            <span className="composer-compaction-label">{Math.round(clampedCompactionProgress * 100)}%</span>
          </div>
          {isSessionBusy ? (
            <IconButton
              icon="stop"
              className="composer-send-button composer-stop-button"
              label="Stop"
              onClick={() => void abortActiveSession()}
            />
          ) : (
            <IconButton
              icon="send"
              className="composer-send-button"
              label="Send prompt"
              onClick={() => void sendPrompt()}
              disabled={!hasActiveSession}
            />
          )}
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
            <div key={attachment.url} className="attachment-chip-wrap">
              <button
                type="button"
                className="attachment-chip attachment-chip-preview"
                onClick={() => {
                  if (isImageAttachment(attachment)) {
                    setPreviewAttachment(attachment);
                  }
                }}
                title={isImageAttachment(attachment) ? `Preview ${attachment.filename}` : attachment.filename}
                aria-label={isImageAttachment(attachment) ? `Preview ${attachment.filename}` : attachment.filename}
              >
                <img src={attachment.url} alt="" className="attachment-chip-thumb" />
                <span className="attachment-chip-name">{attachment.filename}</span>
              </button>
              <button
                type="button"
                className="attachment-chip-remove"
                onClick={() => removeAttachment(attachment.url)}
                title={`Remove ${attachment.filename}`}
                aria-label={`Remove ${attachment.filename}`}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="composer-controls">
        {agentOptions.length > 0 ? (
          <div ref={agentMenuRef} className={`composer-agent-wrap ${agentMenuOpen ? "open" : ""}`.trim()}>
            <button
              type="button"
              className="composer-agent-control"
              title={selectedAgent ? `Agent: ${selectedAgent}` : "Select agent"}
              onClick={() => setAgentMenuOpen((value) => !value)}
              aria-expanded={agentMenuOpen}
              aria-haspopup="menu"
            >
              <Bot size={11} aria-hidden="true" />
              <span className="composer-agent-label">{selectedAgent ?? "agent"}</span>
              <ChevronDown size={10} aria-hidden="true" />
            </button>
            {agentMenuOpen ? (
              <div className="composer-agent-menu" role="menu" aria-label="Select agent">
                {agentOptions.map((agent) => (
                  <button
                    key={agent.name}
                    type="button"
                    role="menuitemradio"
                    aria-checked={agent.name === selectedAgent}
                    className={agent.name === selectedAgent ? "active" : ""}
                    onClick={() => {
                      onAgentChange(agent.name);
                      setAgentMenuOpen(false);
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
        ) : null}
        {!hidePlanToggle ? (
          <button
            type="button"
            className={`plan-toggle-inline${isPlanMode ? " is-active" : ""}`}
            disabled={!hasPlanAgent}
            onClick={() => togglePlanMode(!isPlanMode)}
            aria-pressed={isPlanMode}
            title={isPlanMode ? "Disable plan mode" : "Enable plan mode"}
            aria-label={isPlanMode ? "Disable plan mode" : "Enable plan mode"}
          >
            <span className="plan-toggle-square" aria-hidden="true" />
            plan mode
          </button>
        ) : null}
        {!hideBrowserToggle ? (
          <button
            type="button"
            className={`composer-mode-toggle-icon ${browserModeEnabled ? "is-active" : ""}`.trim()}
            aria-pressed={browserModeEnabled}
            onClick={() => setBrowserModeEnabled(!browserModeEnabled)}
            title={browserModeEnabled ? "Browser mode enabled" : "Browser mode disabled"}
            aria-label={browserModeEnabled ? "Disable Browser mode" : "Enable Browser mode"}
          >
            <Compass size={11} aria-hidden="true" />
            <span className="composer-mode-toggle-label">browser</span>
          </button>
        ) : null}
        <div ref={permissionMenuRef} className={`composer-permission-wrap ${permissionMenuOpen ? "open" : ""}`.trim()}>
          <button
            type="button"
            className="composer-permission-control"
            title="Permission mode"
            onClick={() => setPermissionMenuOpen((value) => !value)}
            aria-expanded={permissionMenuOpen}
            aria-haspopup="menu"
          >
            {permissionMode === "yolo-write" ? <Zap size={11} aria-hidden="true" /> : <Shield size={11} aria-hidden="true" />}
            <span className="composer-permission-label">{permissionLabel}</span>
            <ChevronDown size={10} aria-hidden="true" />
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
                  <span>restricted</span>
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
                  <span>yolo mode</span>
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
                  clearBranchActionError();
                }
                return next;
              });
            }}
            title={branchCurrent || "Branch"}
          >
            <span className="composer-branch-leading">
              <GitBranch size={11} aria-hidden="true" />
              <span className="composer-branch-label">{branchDisplayValue}</span>
            </span>
            <ChevronDown size={10} aria-hidden="true" />
          </button>
          {branchMenuOpen ? (
            <div className="composer-branch-menu">
              <div className="composer-branch-search">
                <SearchIcon size={13} aria-hidden="true" />
                <input
                  ref={branchSearchInputRef}
                  value={branchQuery}
                  onChange={(event) => {
                    clearBranchActionError();
                    setBranchQuery(event.target.value);
                  }}
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
              <div className="composer-branch-error-slot">
                {branchActionError ? <p className="composer-branch-error">{branchActionError}</p> : null}
              </div>
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
                Create new branch
              </button>
            </div>
          ) : null}
        </div>
        {useDropdownModels ? (
          <div ref={modelDropdownRef} className={`composer-model-dropdown-wrap ${modelDropdownOpen ? "open" : ""}`.trim()}>
            <button
              type="button"
              className="composer-select composer-model-btn"
              onClick={() => setModelDropdownOpen((v) => !v)}
              aria-expanded={modelDropdownOpen}
              aria-haspopup="listbox"
              title={selectedModel ?? "Select model"}
            >
              <span className="composer-model-btn-label">
                {(() => {
                  const sel = modelSelectOptions.find((o) => o.key === selectedModel);
                  return sel ? sel.modelName : modelSelectOptions.length === 0 ? "loading..." : "model";
                })()}
              </span>
              <ChevronDown size={10} aria-hidden="true" />
            </button>
            {modelDropdownOpen ? (
              <div className="composer-model-dropdown-menu" role="listbox" aria-label="Select model">
                <small>Models</small>
                <div className="composer-model-dropdown-list">
                  {modelSelectOptions.length === 0 ? (
                    <p>No models available</p>
                  ) : (
                    modelSelectOptions.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        role="option"
                        aria-selected={opt.key === selectedModel}
                        onClick={() => {
                          setSelectedModel(opt.key);
                          setModelDropdownOpen(false);
                        }}
                      >
                        <span className="composer-model-dropdown-item-main">
                          <span>{opt.modelName}</span>
                        </span>
                        {opt.key === selectedModel ? <Check size={13} aria-hidden="true" /> : null}
                      </button>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <ModelPicker
            modelSelectOptions={modelSelectOptions}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            selectedVariant={selectedVariant}
            setSelectedVariant={setSelectedVariant}
            variantOptions={variantOptions}
          />
        )}
        <div style={{ flex: 1 }} aria-hidden="true" />
        <div
          className={`composer-compaction-indicator composer-compaction-indicator-inline ${compactionCompacted ? "compacted" : ""}`.trim()}
          title={compactionHint}
          aria-label={compactionHint}
        >
          <span className="composer-compaction-glyph" style={compactionProgressStyle} aria-hidden="true" />
          <span className="composer-compaction-label">{Math.round(clampedCompactionProgress * 100)}%</span>
        </div>
      </div>
      {previewAttachment ? (
        <div className="composer-image-preview-overlay" onClick={clearPreviewAttachment}>
          <section className="composer-image-preview-modal" role="dialog" aria-label="Attachment preview" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="composer-image-preview-close"
              onClick={clearPreviewAttachment}
              aria-label="Close attachment preview"
            >
              <X size={14} aria-hidden="true" />
            </button>
            <img src={previewAttachment.url} alt={previewAttachment.filename} />
            <p>{previewAttachment.filename}</p>
          </section>
        </div>
      ) : null}
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

export type { AgentOption, Command, ComposerPanelProps };
export type { TodoItem } from "./chat/TodoDock";
export type { AgentQuestion, QuestionOption } from "./chat/QuestionDock";
