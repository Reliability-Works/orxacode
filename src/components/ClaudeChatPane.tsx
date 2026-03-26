import { useEffect, useMemo, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { useClaudeChatSession, type ClaudeChatMessageItem } from "../hooks/useClaudeChatSession";
import type { Attachment } from "../hooks/useComposerState";
import { deriveSessionTitleFromPrompt } from "../lib/app-session-utils";
import { ComposerPanel } from "./ComposerPanel";
import { VirtualizedTimeline } from "./chat/VirtualizedTimeline";
import { UnifiedTimelineRowView } from "./chat/UnifiedTimelineRow";
import { estimateUnifiedTimelineRowHeight } from "./chat/unified-timeline-model";
import { ClaudeTraitsPicker } from "./ClaudeTraitsPicker";
import { applyClaudePromptEffortPrefix, isClaudeUltrathinkPrompt } from "../lib/claude-models";
import { projectClaudeChatProjectedSessionPresentation } from "../lib/claude-chat-session-presentation";
import type { PermissionMode } from "../types/app";
import type { AgentQuestion } from "./chat/QuestionDock";
import type { ClaudeChatEffort } from "@shared/ipc";
import { buildClaudeChatBackgroundAgents } from "../lib/session-presentation";

interface Props {
  directory: string;
  sessionStorageKey: string;
  onFirstMessage?: () => void;
  onTitleChange?: (title: string) => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
  branchMenuOpen: boolean;
  setBranchMenuOpen: (updater: (value: boolean) => boolean) => void;
  branchControlWidthCh: number;
  branchLoading: boolean;
  branchSwitching: boolean;
  hasActiveProject: boolean;
  branchCurrent?: string;
  branchDisplayValue: string;
  branchSearchInputRef: React.RefObject<HTMLInputElement | null>;
  branchQuery: string;
  setBranchQuery: (value: string) => void;
  branchActionError: string | null;
  clearBranchActionError: () => void;
  checkoutBranch: (name: string) => void | Promise<void>;
  filteredBranches: string[];
  openBranchCreateModal: () => void | Promise<void>;
  browserModeEnabled?: boolean;
  setBrowserModeEnabled?: (enabled: boolean) => void;
}

function historyToMessageItems(messages: Awaited<ReturnType<ReturnType<typeof useClaudeChatSession>["loadSubagentMessages"]>>): ClaudeChatMessageItem[] {
  return messages.map((message) => ({
    id: message.id,
    kind: "message" as const,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
  }));
}

function addClaudeComposerAttachments(
  current: Attachment[],
  attachments: Attachment[],
) {
  if (attachments.length === 0) {
    return current;
  }
  const seen = new Set(current.map((item) => item.url));
  const next: Attachment[] = [];
  for (const attachment of attachments) {
    if (!attachment.url || seen.has(attachment.url)) {
      continue;
    }
    seen.add(attachment.url);
    next.push(attachment);
  }
  return next.length > 0 ? [...current, ...next] : current;
}

function buildClaudeDisplayPrompt(prompt: string, attachmentCount: number) {
  if (attachmentCount <= 0) {
    return prompt;
  }
  const attachmentLabel = attachmentCount === 1 ? "[image]" : `[image x${attachmentCount}]`;
  return prompt.trim().length > 0 ? `${attachmentLabel} ${prompt}` : attachmentLabel;
}

export function ClaudeChatPane({
  directory,
  sessionStorageKey,
  onFirstMessage,
  onTitleChange,
  permissionMode,
  onPermissionModeChange,
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
  browserModeEnabled = false,
  setBrowserModeEnabled = () => {},
}: Props) {
  const {
    messages,
    pendingApproval,
    pendingUserInput,
    isStreaming,
    subagents,
    modelOptions,
    startTurn,
    interruptTurn,
    approveAction,
    respondToUserInput,
    archiveProviderSession,
    loadSubagentMessages,
  } = useClaudeChatSession(directory, sessionStorageKey);
  const [composer, setComposer] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<Attachment[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [effort, setEffort] = useState<ClaudeChatEffort | undefined>(undefined);
  const [isPlanMode, setIsPlanMode] = useState(false);
  const [thinking, setThinking] = useState(true);
  const [fastMode, setFastMode] = useState(false);
  const [selectedBackgroundAgentId, setSelectedBackgroundAgentId] = useState<string | null>(null);
  const [archivedBackgroundAgentIds, setArchivedBackgroundAgentIds] = useState<string[]>([]);
  const [subagentMessages, setSubagentMessages] = useState<Record<string, ClaudeChatMessageItem[]>>({});
  const [subagentLoading, setSubagentLoading] = useState<Record<string, boolean>>({});
  const [subagentErrors, setSubagentErrors] = useState<Record<string, string | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeSessionPresentation = useMemo(
    () => projectClaudeChatProjectedSessionPresentation(messages, isStreaming),
    [isStreaming, messages],
  );

  useEffect(() => {
    if (!selectedModel && modelOptions.length > 0) {
      setSelectedModel(modelOptions[0]?.key);
    }
  }, [modelOptions, selectedModel]);

  const selectedModelId = useMemo(
    () => selectedModel?.split("/")[1] ?? undefined,
    [selectedModel],
  );
  const addComposerAttachments = (attachments: Attachment[]) => {
    setComposerAttachments((current) => addClaudeComposerAttachments(current, attachments));
  };
  const removeAttachment = (url: string) => {
    setComposerAttachments((current) => current.filter((item) => item.url !== url));
  };
  const pickImageAttachment = async () => {
    try {
      const selection = await window.orxa.opencode.pickImage();
      if (!selection) {
        return;
      }
      addComposerAttachments([selection]);
    } catch {
      // Keep Claude composer behavior silent for now; picker failures are non-fatal.
    }
  };
  const promptEffort = useMemo(
    () => (effort === "ultrathink" && !isClaudeUltrathinkPrompt(composer) ? applyClaudePromptEffortPrefix(composer, effort) : composer),
    [composer, effort],
  );
  const hasUserMessages = useMemo(
    () => messages.some((item) => item.kind === "message" && item.role === "user"),
    [messages],
  );

  const activeSubagent = useMemo(
    () => subagents.find((agent) => agent.id === selectedBackgroundAgentId) ?? null,
    [selectedBackgroundAgentId, subagents],
  );
  const backgroundAgents = useMemo(
    () => buildClaudeChatBackgroundAgents(subagents),
    [subagents],
  );
  const visibleBackgroundAgents = useMemo(
    () => backgroundAgents.filter((agent) => !archivedBackgroundAgentIds.includes(agent.id) && !(agent.sessionID && archivedBackgroundAgentIds.includes(agent.sessionID))),
    [archivedBackgroundAgentIds, backgroundAgents],
  );
  const hasLoadedSelectedSubagentMessages = useMemo(
    () => (activeSubagent ? Boolean(subagentMessages[activeSubagent.id]) : false),
    [activeSubagent, subagentMessages],
  );

  useEffect(() => {
    setArchivedBackgroundAgentIds((current) =>
      current.filter((id) => backgroundAgents.some((agent) => agent.id === id || agent.sessionID === id)),
    );
  }, [backgroundAgents]);

  useEffect(() => {
    const sessionID = activeSubagent?.sessionID;
    if (!sessionID) {
      return;
    }
    let cancelled = false;
    let timer: number | null = null;
    const shouldShowLoading = !hasLoadedSelectedSubagentMessages;

    const load = async (showLoading: boolean) => {
      if (showLoading) {
        setSubagentLoading((prev) => ({ ...prev, [activeSubagent.id]: true }));
      }
      setSubagentErrors((prev) => ({ ...prev, [activeSubagent.id]: null }));
      try {
        const history = await loadSubagentMessages(sessionID);
        if (cancelled) {
          return;
        }
        setSubagentMessages((prev) => ({ ...prev, [activeSubagent.id]: historyToMessageItems(history) }));
      } catch (error) {
        if (!cancelled) {
          setSubagentErrors((prev) => ({ ...prev, [activeSubagent.id]: error instanceof Error ? error.message : String(error) }));
        }
      } finally {
        if (!cancelled && showLoading) {
          setSubagentLoading((prev) => ({ ...prev, [activeSubagent.id]: false }));
        }
      }
    };

    void load(shouldShowLoading);
    timer = window.setInterval(() => {
      void load(false);
    }, 1300);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [activeSubagent, hasLoadedSelectedSubagentMessages, loadSubagentMessages]);

  const subagentDetailPresentation = useMemo(() => {
    if (!activeSubagent) {
      return null;
    }
    const detailMessages = subagentMessages[activeSubagent.id] ?? [];
    return projectClaudeChatProjectedSessionPresentation(detailMessages, false).rows;
  }, [activeSubagent, subagentMessages]);

  const pendingQuestion = useMemo(() => {
    if (!pendingUserInput) {
      return null;
    }
    const questions: AgentQuestion[] = [
        {
          id: pendingUserInput.elicitationId ?? pendingUserInput.id,
          header: pendingUserInput.server,
          text: pendingUserInput.message,
          options: pendingUserInput.options?.map((option) => ({ label: option.label, value: option.value })),
        },
      ];
    return {
      questions,
      onSubmit: (answers: Record<string, string | string[]>) => {
        const firstValue = Object.values(answers)[0];
        const response = Array.isArray(firstValue) ? firstValue.join(", ") : (firstValue ?? "").toString();
        void respondToUserInput(pendingUserInput.id, response);
      },
      onReject: () => {
        void respondToUserInput(pendingUserInput.id, "");
      },
    };
  }, [pendingUserInput, respondToUserInput]);

  const pendingPermission = useMemo(() => {
    if (!pendingApproval) {
      return null;
    }
    return {
      description: pendingApproval.reason,
      command: pendingApproval.command ? [pendingApproval.command] : undefined,
      onDecide: (decision: "allow_once" | "allow_always" | "reject") => {
        const mapped = decision === "allow_once" ? "accept" : decision === "allow_always" ? "acceptForSession" : "decline";
        void approveAction(pendingApproval.id, mapped);
      },
    };
  }, [approveAction, pendingApproval]);

  return (
    <>
      <VirtualizedTimeline
        rows={activeSessionPresentation.rows}
        scrollRef={scrollContainerRef}
        className="messages-scroll codex-messages"
        ariaLabel="claude conversation"
        estimateSize={estimateUnifiedTimelineRowHeight}
        virtualize={false}
        sessionId={sessionStorageKey}
        emptyState={(
          <div className="center-pane-rail">
            <div className="codex-empty">
              <Bot size={24} color="var(--text-muted)" />
              <span>Send a prompt to start chatting with Claude.</span>
            </div>
          </div>
        )}
        renderRow={(row) => (
          <div className="center-pane-rail center-pane-rail--row">
            <UnifiedTimelineRowView key={row.id} row={row} />
          </div>
        )}
        footer={(
          <div className="center-pane-rail center-pane-rail--row">
            <div ref={messagesEndRef} />
          </div>
        )}
      />
      <div className="codex-composer-area">
      <div className="center-pane-rail center-pane-rail--composer">
          <ComposerPanel
            placeholder="Send to Claude..."
            composer={composer}
            setComposer={setComposer}
            composerAttachments={composerAttachments}
            removeAttachment={removeAttachment}
            slashMenuOpen={false}
            filteredSlashCommands={[]}
            slashSelectedIndex={0}
            insertSlashCommand={() => {}}
            handleSlashKeyDown={() => {}}
            addComposerAttachments={addComposerAttachments}
            sendPrompt={async () => {
              const trimmed = composer.trim();
              if (!trimmed && composerAttachments.length === 0) {
                return;
              }
              onFirstMessage?.();
              if (!hasUserMessages && trimmed) {
                onTitleChange?.(deriveSessionTitleFromPrompt(trimmed));
              }
              const attachmentsToSend = [...composerAttachments];
              setComposer("");
              setComposerAttachments([]);
              try {
                await startTurn(promptEffort, {
                  model: selectedModelId,
                  permissionMode: isPlanMode ? "plan" : permissionMode,
                  effort,
                  fastMode,
                  thinking,
                  attachments: attachmentsToSend,
                  displayPrompt: buildClaudeDisplayPrompt(trimmed, attachmentsToSend.length),
                });
              } catch {
                setComposer(trimmed);
                setComposerAttachments(attachmentsToSend);
              }
            }}
            abortActiveSession={() => void interruptTurn()}
            isSessionBusy={isStreaming}
            isSendingPrompt={false}
            pickImageAttachment={pickImageAttachment}
            hasActiveSession={true}
            isPlanMode={isPlanMode}
            hasPlanAgent
            togglePlanMode={setIsPlanMode}
            browserModeEnabled={browserModeEnabled}
            setBrowserModeEnabled={setBrowserModeEnabled}
            agentOptions={[]}
            onAgentChange={() => {}}
            permissionMode={permissionMode}
            onPermissionModeChange={onPermissionModeChange}
            compactionProgress={0}
            compactionHint="Context usage"
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
            modelSelectOptions={modelOptions}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            selectedVariant={undefined}
            setSelectedVariant={() => {}}
            variantOptions={[]}
            customControls={(
              <ClaudeTraitsPicker
                model={selectedModelId}
                effort={effort}
                thinking={thinking}
                fastMode={fastMode}
                onEffortChange={setEffort}
                onThinkingChange={setThinking}
                onFastModeChange={setFastMode}
              />
            )}
            backgroundAgents={visibleBackgroundAgents}
            selectedBackgroundAgentId={selectedBackgroundAgentId}
            onOpenBackgroundAgent={(id) => setSelectedBackgroundAgentId(id)}
            onCloseBackgroundAgent={() => setSelectedBackgroundAgentId(null)}
            onArchiveBackgroundAgent={async (agent) => {
              const sessionID = agent.sessionID;
              if (sessionID) {
                await archiveProviderSession(sessionID);
              }
              setArchivedBackgroundAgentIds((current) => {
                const next = new Set(current);
                next.add(agent.id);
                if (sessionID) {
                  next.add(sessionID);
                }
                return [...next];
              });
              if (selectedBackgroundAgentId === agent.id) {
                setSelectedBackgroundAgentId(null);
              }
            }}
            backgroundAgentDetail={
              subagentDetailPresentation
                ? subagentDetailPresentation.map((row) => <UnifiedTimelineRowView key={row.id} row={row} />)
                : null
            }
            backgroundAgentTaskText={activeSubagent?.taskText ?? null}
            backgroundAgentDetailLoading={activeSubagent ? (subagentLoading[activeSubagent.id] ?? false) : false}
            backgroundAgentDetailError={activeSubagent ? (subagentErrors[activeSubagent.id] ?? null) : null}
            pendingQuestion={pendingQuestion}
            pendingPermission={pendingPermission}
          />
        </div>
      </div>
    </>
  );
}
