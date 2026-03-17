import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Zap } from "lucide-react";
import { useCodexSession } from "../hooks/useCodexSession";
import { agentColorForId } from "../hooks/useCodexSession";
import { ComposerPanel } from "./ComposerPanel";
import { ToolCallCard } from "./chat/ToolCallCard";
import { CommandOutput } from "./chat/CommandOutput";
import { DiffBlock } from "./chat/DiffBlock";
import { ThinkingShimmer } from "./chat/ThinkingShimmer";
import { MessageHeader } from "./chat/MessageHeader";
import { TextPart } from "./chat/TextPart";
import { ReasoningPart } from "./chat/ReasoningPart";
import { ContextToolGroup } from "./chat/ContextToolGroup";
import { BackgroundAgentsPanel } from "./chat/BackgroundAgentsPanel";
import { SubagentThreadView } from "./chat/SubagentThreadView";
import { PlanConfirmationOverlay } from "./chat/PlanConfirmationOverlay";
import type { ModelOption } from "../lib/models";
import type { PermissionMode } from "../types/app";
import type { CodexCollaborationMode } from "@shared/ipc";
import type { CodexMessageItem } from "../hooks/useCodexSession";

interface Props {
  directory: string;
  onExit: () => void;
  onFirstMessage?: () => void;
  onTitleChange?: (title: string) => void;
  notifyOnAwaitingInput?: boolean;
  subagentSystemNotificationsEnabled?: boolean;
  onAwaitingChange?: (awaiting: boolean) => void;
  // Branch props (forwarded to ComposerPanel)
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
}

const CODEX_PROVIDER_ID = "codex";
const CODEX_PROVIDER_NAME = "Codex";

function codexModelsToOptions(models: { id: string; model: string; name: string; isDefault: boolean }[]): ModelOption[] {
  return models.map((m) => ({
    key: `${CODEX_PROVIDER_ID}/${m.model}`,
    providerID: CODEX_PROVIDER_ID,
    modelID: m.model,
    providerName: CODEX_PROVIDER_NAME,
    modelName: m.name,
    variants: [],
  }));
}

// Derive a human-readable label for collab tool calls
function deriveCollabLabel(title: string, status: string): string {
  const raw = title.toLowerCase();
  if (raw.includes("spawn")) return status === "completed" ? "Agent spawned" : "Spawning agent...";
  if (raw.includes("send")) return status === "completed" ? "Sent to agent" : "Sending to agent...";
  if (raw.includes("wait")) return status === "completed" ? "Agent responded" : "Waiting for agent...";
  if (raw.includes("close")) return status === "completed" ? "Agent closed" : "Closing agent...";
  return title;
}

function CodexMessageRenderer({ item, isStreaming }: { item: CodexMessageItem; isStreaming: boolean }) {
  if (item.kind === "thinking") {
    return (
      <article className="message-card message-assistant">
        <div className="message-thinking"><ThinkingShimmer /></div>
      </article>
    );
  }

  if (item.kind === "message") {
    const isLastStreaming =
      isStreaming && item.role === "assistant" && !item.content;
    const role = item.role === "user" ? "user" : "assistant";
    return (
      <article className={`message-card message-${role}`}>
        <MessageHeader
          role={role}
          label={role === "user" ? "User" : "Codex"}
          timestamp={item.timestamp}
        />
        <section className="message-part">
          {item.content ? (
            <TextPart content={item.content} role={role} />
          ) : isLastStreaming ? (
            <div
              className="part-text"
              dangerouslySetInnerHTML={{ __html: "\u2588" }}
            />
          ) : null}
        </section>
      </article>
    );
  }

  if (item.kind === "tool") {
    // Enhanced rendering for collab/task tool calls
    if (item.toolType === "task") {
      const collabLabel = deriveCollabLabel(item.title, item.status);
      // Build a subtitle with agent name (colored) and diff stats
      const agentName = item.collabReceivers?.[0]?.nickname ?? item.collabSender?.nickname;
      const subtitle = agentName ?? undefined;
      return (
        <article className="message-card message-assistant">
          <ToolCallCard
            title={collabLabel}
            subtitle={subtitle}
            status={item.status}
            defaultExpanded={item.status === "error"}
          >
            {item.collabStatuses && item.collabStatuses.length > 0 ? (
              <div className="collab-statuses">
                {item.collabStatuses.map((cs) => (
                  <div key={cs.threadId} className="collab-status-row">
                    <span className="collab-status-name" style={{ color: agentColorForId(cs.threadId) }}>
                      {cs.nickname ?? cs.threadId.slice(0, 8)}
                    </span>
                    {cs.role ? <span className="collab-status-role">({cs.role})</span> : null}
                    <span className="collab-status-text">{cs.status}</span>
                  </div>
                ))}
              </div>
            ) : item.output ? (
              <pre className="tool-call-card-output">{item.output}</pre>
            ) : null}
          </ToolCallCard>
        </article>
      );
    }

    return (
      <article className="message-card message-assistant">
        <ToolCallCard
          title={item.title}
          status={item.status}
          defaultExpanded={item.status === "error"}
        >
          {item.command !== undefined ? (
            <CommandOutput
              command={item.command}
              output={item.output ?? ""}
              exitCode={item.exitCode}
            />
          ) : item.output ? (
            <pre className="tool-call-card-output">{item.output}</pre>
          ) : null}
        </ToolCallCard>
      </article>
    );
  }

  if (item.kind === "diff") {
    return (
      <article className="message-card message-assistant">
        <DiffBlock
          path={item.path}
          type={item.type}
          diff={item.diff}
          insertions={item.insertions}
          deletions={item.deletions}
        />
      </article>
    );
  }

  if (item.kind === "reasoning") {
    return (
      <article className="message-card message-assistant">
        <ReasoningPart
          content={item.content}
          summary={item.summary || undefined}
        />
      </article>
    );
  }

  if (item.kind === "context") {
    return (
      <article className="message-card message-assistant">
        <ContextToolGroup
          items={[
            {
              toolName: item.toolType,
              title: item.title,
              status: item.status,
              detail: item.detail,
            },
          ]}
        />
      </article>
    );
  }

  if (item.kind === "compaction") {
    return (
      <div className="compaction-divider" role="separator" aria-label="context compacted">
        <span className="compaction-divider-line" />
        <span className="compaction-divider-label">context compacted</span>
        <span className="compaction-divider-line" />
      </div>
    );
  }

  return null;
}

export function CodexPane({
  directory,
  onFirstMessage,
  onTitleChange,
  notifyOnAwaitingInput,
  subagentSystemNotificationsEnabled,
  onAwaitingChange,
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
}: Props) {
  const {
    connectionStatus,
    thread,
    messages,
    pendingApproval,
    pendingUserInput,
    isStreaming,
    lastError,
    threadName,
    planItems,
    connect,
    startThread,
    sendMessage,
    approveAction,
    denyAction,
    respondToUserInput,
    rejectUserInput,
    planReady,
    interruptTurn,
    acceptPlan,
    submitPlanChanges,
    dismissPlan,
    isSubagentThread,
    subagents,
    activeSubagentThreadId,
    subagentMessages,
    openSubagentThread,
    closeSubagentThread,
  } = useCodexSession(directory);

  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [modelSelectOptions, setModelSelectOptions] = useState<ModelOption[]>([]);
  const [isPlanMode, setIsPlanMode] = useState(false);
  const [browserModeEnabled, setBrowserModeEnabled] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("ask-write");
  const [todoOpen, setTodoOpen] = useState(false);
  const [codexQueue, setCodexQueue] = useState<Array<{ id: string; text: string; timestamp: number }>>([]);
  const [codexSendingId, setCodexSendingId] = useState<string | undefined>();
  const [collaborationModes, setCollaborationModes] = useState<CodexCollaborationMode[]>([]);
  const [selectedCollabMode, setSelectedCollabMode] = useState<string | undefined>(undefined);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Track when the current turn started for notification delay
  const turnStartedAt = useRef<number>(0);

  // Auto-connect on mount (handles React 18 StrictMode double-mount)
  useEffect(() => {
    let cancelled = false;
    const autoConnect = async () => {
      // Small delay to survive StrictMode unmount/remount cycle
      await new Promise((r) => setTimeout(r, 50));
      if (cancelled) return;
      void connect();
    };
    void autoConnect();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start thread when connected and no thread exists
  useEffect(() => {
    if (connectionStatus === "connected" && !thread) {
      void startThread({ title: "Orxa Code Session" });
    }
  }, [connectionStatus, thread, startThread]);

  // Load models and collaboration modes when connected
  useEffect(() => {
    if (connectionStatus === "connected" && window.orxa?.codex) {
      void window.orxa.codex.listModels().then((rawModels) => {
        const options = codexModelsToOptions(rawModels);
        setModelSelectOptions(options);
        // Pre-select default or first model if none selected
        if (!selectedModel && options.length > 0) {
          const defaultModel = rawModels.find((m) => m.isDefault);
          const defaultKey = defaultModel ? `${CODEX_PROVIDER_ID}/${defaultModel.model}` : options[0].key;
          setSelectedModel(defaultKey);
        }
      });
      // Load collaboration modes
      void window.orxa.codex.listCollaborationModes().then((modes) => {
        setCollaborationModes(modes);
      }).catch(() => {
        // Non-fatal — server may not support this
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [messages]);

  // Thread name -> sidebar title
  useEffect(() => {
    if (threadName && onTitleChange) {
      onTitleChange(threadName);
    }
  }, [threadName, onTitleChange]);

  // Report awaiting state to parent for sidebar indicator
  const isAwaiting = Boolean(pendingApproval || pendingUserInput || (planReady && !isStreaming));
  useEffect(() => {
    onAwaitingChange?.(isAwaiting);
  }, [isAwaiting, onAwaitingChange]);

  // Notifications for codex awaiting states (filtered for subagent threads + 60s delay)
  useEffect(() => {
    if (!notifyOnAwaitingInput || document.hasFocus()) return;
    if (pendingApproval || pendingUserInput || planReady) {
      // Skip notifications if subagent notifications are disabled and this is a subagent event
      if (!subagentSystemNotificationsEnabled) {
        const eventThreadId = pendingApproval?.threadId ?? pendingUserInput?.threadId;
        if (eventThreadId && isSubagentThread(eventThreadId)) return;
      }
      // Only notify if agent has been working > 60s
      const MIN_WORKING_DURATION_MS = 60_000;
      if (turnStartedAt.current > 0 && Date.now() - turnStartedAt.current < MIN_WORKING_DURATION_MS) return;

      const body = planReady ? "Plan is ready for review" : pendingUserInput ? "Agent is asking a question" : "Agent needs permission to continue";
      new Notification("Orxa Code", { body, silent: false }).onclick = () => window.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingApproval, pendingUserInput, planReady]);

  const queueCodexMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const id = `cq:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
    setCodexQueue((current) => [...current, { id, text: trimmed, timestamp: Date.now() }]);
    setInput("");
  }, []);

  const removeCodexQueued = useCallback((id: string) => {
    setCodexQueue((current) => current.filter((item) => item.id !== id));
  }, []);

  const editCodexQueued = useCallback((id: string) => {
    setCodexQueue((current) => {
      const item = current.find((m) => m.id === id);
      if (item) {
        setInput(item.text);
      }
      return current.filter((m) => m.id !== id);
    });
  }, []);

  const hasSetTitle = useRef(false);
  const sendPrompt = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    onFirstMessage?.();
    // Derive session title from first user prompt (fallback if no thread/name/updated arrives)
    if (!hasSetTitle.current && onTitleChange && !threadName) {
      hasSetTitle.current = true;
      const title = trimmed.length > 56 ? `${trimmed.slice(0, 53).trimEnd()}...` : trimmed;
      onTitleChange(title);
    }
    // Extract just the model ID (strip provider prefix)
    const modelID = selectedModel
      ? selectedModel.startsWith(`${CODEX_PROVIDER_ID}/`)
        ? selectedModel.slice(CODEX_PROVIDER_ID.length + 1)
        : selectedModel
      : undefined;
    const opts: { model?: string; collaborationMode?: string } = {};
    if (modelID) opts.model = modelID;
    if (selectedCollabMode) opts.collaborationMode = selectedCollabMode;
    turnStartedAt.current = Date.now();
    await sendMessage(trimmed, Object.keys(opts).length > 0 ? opts : undefined);
  }, [input, isStreaming, onFirstMessage, onTitleChange, selectedModel, selectedCollabMode, sendMessage, threadName]);

  const abortActiveSession = useCallback(async () => {
    await interruptTurn();
  }, [interruptTurn]);

  // Map pendingApproval -> PermissionDock props
  const permissionDockProps = pendingApproval
    ? {
        description: pendingApproval.reason || "Approval required",
        filePattern: pendingApproval.changes?.map((c) => c.path).join(", "),
        command: pendingApproval.command,
        onDecide: (decision: "allow_once" | "allow_always" | "reject") => {
          if (decision === "allow_once") {
            void approveAction("accept");
          } else if (decision === "allow_always") {
            void approveAction("acceptForSession");
          } else {
            void denyAction();
          }
        },
      }
    : null;

  // Map pendingUserInput -> QuestionDock props
  const questionDockProps = pendingUserInput
    ? {
        questions: [
          {
            id: pendingUserInput.itemId || "user-input-q",
            text: pendingUserInput.message || "The agent is requesting your input.",
          },
        ],
        onSubmit: (answers: Record<string, string | string[]>) => {
          const firstAnswer = Object.values(answers)[0];
          const response = Array.isArray(firstAnswer) ? firstAnswer.join(", ") : (firstAnswer ?? "");
          void respondToUserInput(response);
        },
        onReject: () => {
          void rejectUserInput();
        },
      }
    : null;

  const composerPlaceholder =
    connectionStatus === "error"
      ? (lastError ?? "Error connecting to Codex. Click to retry.")
      : connectionStatus !== "connected"
        ? "Connecting to Codex..."
        : !thread
          ? "Starting thread..."
          : "Send a message...";

  // -- Unavailable state --
  if (!window.orxa?.codex) {
    return (
      <div className="codex-pane">
        <div className="codex-unavailable">
          <Zap size={32} color="var(--text-muted)" />
          <span>Codex is not available. Make sure the codex CLI is installed.</span>
        </div>
      </div>
    );
  }

  // Find the active subagent for thread view
  const activeSubagent = activeSubagentThreadId
    ? subagents.find((a) => a.threadId === activeSubagentThreadId)
    : null;

  return (
    <div className="codex-pane">
      {/* Subagent thread view — replaces main messages when viewing a subagent */}
      {activeSubagent ? (
        <SubagentThreadView
          agent={activeSubagent}
          messages={subagentMessages}
          onBack={closeSubagentThread}
          renderItem={(item) => <CodexMessageRenderer item={item} isStreaming={false} />}
        />
      ) : (
        <>
          {/* Messages */}
          <div className="messages-scroll codex-messages" role="log" aria-label="codex conversation">
            {messages.length === 0 && connectionStatus === "connected" && thread ? (
              <div className="codex-empty">
                <Zap size={24} color="var(--text-muted)" />
                <span>Send a prompt to start coding with Codex.</span>
              </div>
            ) : null}

            {messages.map((msg) => (
              <CodexMessageRenderer key={msg.id} item={msg} isStreaming={isStreaming} />
            ))}

            {/* Background agents panel — in the chat feed, not sidebar */}
            {subagents.length > 0 ? (
              <BackgroundAgentsPanel
                agents={subagents}
                onOpenAgent={openSubagentThread}
              />
            ) : null}

            <div ref={messagesEndRef} />
          </div>
        </>
      )}

      {/* Collaboration mode selector */}
      {collaborationModes.length > 0 ? (
        <div className="codex-collab-mode-bar">
          <label className="codex-collab-mode-label">
            <span>Mode</span>
            <select
              className="codex-collab-mode-select"
              value={selectedCollabMode ?? ""}
              onChange={(e) => setSelectedCollabMode(e.target.value || undefined)}
            >
              <option value="">(default)</option>
              {collaborationModes.map((m) => (
                <option key={m.id} value={m.id}>{m.label || m.id}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {/* Composer area — with plan confirmation overlay */}
      <div className="codex-composer-area">
        {planReady && !isStreaming ? (
          <PlanConfirmationOverlay
            onAccept={() => void acceptPlan()}
            onSubmitChanges={(changes) => void submitPlanChanges(changes)}
            onDismiss={dismissPlan}
          />
        ) : (
          <ComposerPanel
            composer={input}
            setComposer={setInput}
            composerAttachments={[]}
            removeAttachment={() => undefined}
            slashMenuOpen={false}
            filteredSlashCommands={[]}
            slashSelectedIndex={0}
            insertSlashCommand={() => undefined}
            handleSlashKeyDown={() => undefined}
            addComposerAttachments={() => undefined}
            sendPrompt={sendPrompt}
            abortActiveSession={abortActiveSession}
            isSessionBusy={isStreaming}
            isSendingPrompt={false}
            pickImageAttachment={() => undefined}
            hasActiveSession={connectionStatus === "connected" && thread !== null}
            isPlanMode={isPlanMode}
            hasPlanAgent={true}
            togglePlanMode={(enabled) => setIsPlanMode(enabled)}
            browserModeEnabled={browserModeEnabled}
            setBrowserModeEnabled={setBrowserModeEnabled}
            agentOptions={[]}
            onAgentChange={() => undefined}
            permissionMode={permissionMode}
            onPermissionModeChange={setPermissionMode}
            compactionProgress={0}
            compactionHint=""
            compactionCompacted={false}
            branchMenuOpen={branchMenuOpen}
            setBranchMenuOpen={setBranchMenuOpen}
            branchControlWidthCh={branchControlWidthCh}
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
            modelSelectOptions={modelSelectOptions}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            selectedVariant={undefined}
            setSelectedVariant={() => undefined}
            variantOptions={[]}
            placeholder={composerPlaceholder}
            simpleModelPicker
            pendingPermission={permissionDockProps}
            pendingQuestion={questionDockProps}
            todoItems={planItems.length > 0 ? planItems : undefined}
            todoOpen={todoOpen}
            onTodoToggle={() => setTodoOpen((v) => !v)}
            queuedMessages={codexQueue}
            sendingQueuedId={codexSendingId}
            onQueueMessage={queueCodexMessage}
            onSendQueuedNow={(id) => {
              const item = codexQueue.find((m) => m.id === id);
              if (!item || codexSendingId) return;
              setCodexSendingId(id);
              setCodexQueue((current) => current.filter((m) => m.id !== id));
              setInput(item.text);
            }}
            onEditQueued={editCodexQueued}
            onRemoveQueued={removeCodexQueued}
          />
        )}
      </div>
    </div>
  );
}
