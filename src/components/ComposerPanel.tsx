import type { KeyboardEvent, RefObject } from "react";
import { Check, ChevronDown, GitBranch, Plus, Search as SearchIcon } from "lucide-react";
import type { Attachment } from "../hooks/useComposerState";
import type { ModelOption } from "../lib/models";
import { IconButton } from "./IconButton";

type Command = {
  name: string;
  description?: string;
};

type ComposerPanelProps = {
  composer: string;
  setComposer: (value: string) => void;
  composerAttachments: Attachment[];
  removeAttachment: (url: string) => void;
  slashMenuOpen: boolean;
  filteredSlashCommands: Command[];
  slashSelectedIndex: number;
  insertSlashCommand: (name: string) => void;
  handleSlashKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  sendPrompt: () => void | Promise<void>;
  abortActiveSession: () => void | Promise<void>;
  isSessionBusy: boolean;
  pickImageAttachment: () => void | Promise<void>;
  hasActiveSession: boolean;
  isPlanMode: boolean;
  hasPlanAgent: boolean;
  togglePlanMode: (enabled: boolean) => void;
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
  modelSelectWidthCh: number;
  selectedVariant?: string;
  setSelectedVariant: (value: string | undefined) => void;
  variantOptions: string[];
  variantSelectWidthCh: number;
};

export function ComposerPanel(props: ComposerPanelProps) {
  const {
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
    pickImageAttachment,
    hasActiveSession,
    isPlanMode,
    hasPlanAgent,
    togglePlanMode,
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
    modelSelectWidthCh,
    selectedVariant,
    setSelectedVariant,
    variantOptions,
    variantSelectWidthCh,
  } = props;

  return (
    <section className="composer-zone">
      <div className="composer-input-wrap">
        <textarea
          placeholder="Send message to Orxa"
          value={composer}
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
              } else {
                void sendPrompt();
              }
            }
          }}
        />
        <div className="composer-input-actions">
          <IconButton icon="image" label="Attach image" onClick={() => void pickImageAttachment()} />
          <IconButton
            icon={isSessionBusy ? "stop" : "send"}
            label={isSessionBusy ? "Stop" : "Send prompt"}
            onClick={() => (isSessionBusy ? void abortActiveSession() : void sendPrompt())}
            disabled={!hasActiveSession}
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

      <div className="composer-divider" />

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
        <select
          className="composer-select composer-model-select"
          aria-label="Model"
          value={selectedModel ?? ""}
          style={{ width: `${modelSelectWidthCh}ch` }}
          onChange={(event) => setSelectedModel(event.target.value || undefined)}
        >
          {modelSelectOptions.map((model) => (
            <option key={model.key} value={model.key}>
              {model.providerName}/{model.modelName}
            </option>
          ))}
        </select>
        <select
          className="composer-select composer-variant-select"
          aria-label="Variant"
          value={selectedVariant ?? ""}
          style={{ width: `${variantSelectWidthCh}ch` }}
          onChange={(event) => setSelectedVariant(event.target.value || undefined)}
        >
          <option value="">(default)</option>
          {variantOptions.map((variant) => (
            <option key={variant} value={variant}>
              {variant}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}

export type { Command, ComposerPanelProps };
