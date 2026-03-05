import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Archive, ChevronsUpDown, Copy, Ellipsis, Fingerprint, GitCommitHorizontal, LayoutDashboard, Pencil, Pin, PinOff, Play, Plus, Send, Trash2, X } from "lucide-react";
import type { ProjectData } from "../hooks/useDashboards";
import type { CommitNextStep, GitDiffStats } from "../hooks/useGitPanel";
import { IconButton } from "./IconButton";

type OpenTargetOption = {
  id: "cursor" | "antigravity" | "finder" | "terminal" | "ghostty" | "xcode" | "zed";
  label: string;
  logo: string;
};

export type CustomRunCommandPreset = {
  id: string;
  title: string;
  commands: string;
  updatedAt: number;
};

export type CustomRunCommandInput = {
  id?: string;
  title: string;
  commands: string;
};

type ContentTopBarProps = {
  projectsPaneVisible: boolean;
  toggleProjectsPane: () => void;
  showGitPane: boolean;
  setGitPaneVisible: (visible: boolean) => void;
  gitDiffStats: GitDiffStats;
  contentPaneTitle: string;
  showingProjectDashboard: boolean;
  activeProjectDir: string | null;
  projectData: ProjectData | null;
  terminalOpen: boolean;
  toggleTerminal: () => Promise<void>;
  artifactsOpen: boolean;
  onToggleArtifacts: () => void;
  titleMenuOpen: boolean;
  openMenuOpen: boolean;
  setOpenMenuOpen: (open: boolean) => void;
  commitMenuOpen: boolean;
  setCommitMenuOpen: (open: boolean) => void;
  setTitleMenuOpen: (open: boolean) => void;
  hasActiveSession: boolean;
  isActiveSessionPinned: boolean;
  onTogglePinSession: () => void;
  onRenameSession: () => void;
  onArchiveSession: () => void;
  onViewWorkspace: () => void;
  onCopyPath: () => void;
  onCopySessionId: () => void;
  activeOpenTarget: OpenTargetOption;
  openTargets: OpenTargetOption[];
  onSelectOpenTarget: (targetID: OpenTargetOption["id"]) => void;
  openDirectoryInTarget: (targetID: OpenTargetOption["id"]) => Promise<void>;
  openCommitModal: (nextStep?: CommitNextStep) => void;
  pendingPrUrl: string | null;
  onOpenPendingPullRequest: () => void;
  commitNextStepOptions: Array<{ id: CommitNextStep; label: string; icon: ReactNode }>;
  setCommitNextStep: (nextStep: CommitNextStep) => void;
  customRunCommands: CustomRunCommandPreset[];
  onUpsertCustomRunCommand: (input: CustomRunCommandInput) => CustomRunCommandPreset;
  onRunCustomRunCommand: (command: CustomRunCommandPreset) => Promise<void>;
  onDeleteCustomRunCommand: (id: string) => void;
};

export function ContentTopBar({
  projectsPaneVisible,
  toggleProjectsPane,
  showGitPane,
  setGitPaneVisible,
  gitDiffStats,
  contentPaneTitle,
  showingProjectDashboard,
  activeProjectDir,
  projectData,
  terminalOpen,
  toggleTerminal,
  artifactsOpen,
  onToggleArtifacts,
  titleMenuOpen,
  openMenuOpen,
  setOpenMenuOpen,
  commitMenuOpen,
  setCommitMenuOpen,
  setTitleMenuOpen,
  hasActiveSession,
  isActiveSessionPinned,
  onTogglePinSession,
  onRenameSession,
  onArchiveSession,
  onViewWorkspace,
  onCopyPath,
  onCopySessionId,
  activeOpenTarget,
  openTargets,
  onSelectOpenTarget,
  openDirectoryInTarget,
  openCommitModal,
  pendingPrUrl,
  onOpenPendingPullRequest,
  commitNextStepOptions,
  setCommitNextStep,
  customRunCommands,
  onUpsertCustomRunCommand,
  onRunCustomRunCommand,
  onDeleteCustomRunCommand,
}: ContentTopBarProps) {
  const hasProjectContext = Boolean(activeProjectDir ?? projectData?.directory);
  const runMenuRootRef = useRef<HTMLDivElement | null>(null);
  const runTitleInputRef = useRef<HTMLInputElement | null>(null);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [runEditorOpen, setRunEditorOpen] = useState(false);
  const [runEditorTitle, setRunEditorTitle] = useState("");
  const [runEditorCommands, setRunEditorCommands] = useState("");
  const [runEditorEditingId, setRunEditorEditingId] = useState<string | undefined>();
  const [runEditorError, setRunEditorError] = useState<string | null>(null);
  const [runEditorSaving, setRunEditorSaving] = useState(false);

  const sortedRunCommands = useMemo(() => {
    return [...customRunCommands].sort((a, b) => {
      const byUpdated = b.updatedAt - a.updatedAt;
      if (byUpdated !== 0) {
        return byUpdated;
      }
      return a.title.localeCompare(b.title);
    });
  }, [customRunCommands]);

  const runEditorModal = runEditorOpen
    ? createPortal(
        <div
          className="run-command-modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setRunEditorOpen(false);
              setRunEditorError(null);
            }
          }}
        >
          <section className="run-command-modal" role="dialog" aria-modal="true" aria-labelledby="custom-run-command-title">
            <header className="run-command-modal-header">
              <span className="run-command-modal-icon" aria-hidden="true">
                <Play size={14} />
              </span>
              <button
                type="button"
                className="run-command-modal-close"
                aria-label="Close custom run command modal"
                onClick={() => {
                  setRunEditorOpen(false);
                  setRunEditorError(null);
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </header>
            <h3 id="custom-run-command-title">Run</h3>
            <p>Save a reusable command set. Enter one command per line.</p>
            <label className="run-command-modal-field">
              <span>Name</span>
              <input
                ref={runTitleInputRef}
                type="text"
                value={runEditorTitle}
                onChange={(event) => setRunEditorTitle(event.target.value)}
                placeholder="Install and start"
              />
            </label>
            <label className="run-command-modal-field">
              <span>Command to run</span>
              <textarea
                value={runEditorCommands}
                onChange={(event) => setRunEditorCommands(event.target.value)}
                rows={8}
                placeholder={"eg:\nnpm install\nnpm run dev"}
              />
            </label>
            {runEditorError ? <p className="run-command-modal-error">{runEditorError}</p> : null}
            <footer className="run-command-modal-actions">
              <button type="button" className="ghost" onClick={() => void saveRunEditor(false)} disabled={runEditorSaving}>
                Save
              </button>
              <button type="button" onClick={() => void saveRunEditor(true)} disabled={runEditorSaving}>
                Save and run
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      )
    : null;

  useEffect(() => {
    if (!runMenuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && runMenuRootRef.current?.contains(target)) {
        return;
      }
      setRunMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [runMenuOpen]);

  useEffect(() => {
    if (!runEditorOpen) {
      return;
    }
    window.setTimeout(() => {
      runTitleInputRef.current?.focus();
      runTitleInputRef.current?.select();
    }, 0);
  }, [runEditorOpen]);

  useEffect(() => {
    if (!runEditorOpen && !runMenuOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (runEditorOpen) {
        setRunEditorOpen(false);
        setRunEditorError(null);
        return;
      }
      setRunMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [runEditorOpen, runMenuOpen]);

  const openRunEditor = (preset?: CustomRunCommandPreset) => {
    setRunEditorEditingId(preset?.id);
    setRunEditorTitle(preset?.title ?? "");
    setRunEditorCommands(preset?.commands ?? "");
    setRunEditorError(null);
    setRunEditorOpen(true);
    setRunMenuOpen(false);
    setOpenMenuOpen(false);
    setCommitMenuOpen(false);
    setTitleMenuOpen(false);
  };

  const toggleRunMenu = () => {
    setOpenMenuOpen(false);
    setCommitMenuOpen(false);
    setTitleMenuOpen(false);
    if (sortedRunCommands.length === 0) {
      openRunEditor();
      return;
    }
    setRunMenuOpen((current) => !current);
  };

  const runCommandPreset = async (preset: CustomRunCommandPreset) => {
    setRunMenuOpen(false);
    await onRunCustomRunCommand(preset);
  };

  const deleteCommandPreset = (preset: CustomRunCommandPreset) => {
    const confirmed = window.confirm(`Delete custom run command "${preset.title}"?`);
    if (!confirmed) {
      return;
    }
    onDeleteCustomRunCommand(preset.id);
  };

  const saveRunEditor = async (runAfterSave: boolean) => {
    const title = runEditorTitle.trim();
    const commands = runEditorCommands
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    if (!title) {
      setRunEditorError("Name is required.");
      return;
    }
    if (!commands) {
      setRunEditorError("Add at least one command.");
      return;
    }

    setRunEditorSaving(true);
    setRunEditorError(null);
    try {
      const saved = onUpsertCustomRunCommand({
        id: runEditorEditingId,
        title,
        commands,
      });
      if (runAfterSave) {
        await onRunCustomRunCommand(saved);
      }
      setRunEditorOpen(false);
    } catch (error) {
      setRunEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunEditorSaving(false);
    }
  };

  const summarizeCommands = (commands: string) => {
    const lines = commands
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return "No commands";
    }
    if (lines.length === 1) {
      return lines[0]!;
    }
    return `${lines[0]!} (+${lines.length - 1} more)`;
  };

  return (
    <div className="content-edge-controls">
      <IconButton
        icon="panelLeft"
        label="Toggle left sidebar"
        className={`workspace-left-toggle titlebar-toggle ${projectsPaneVisible ? "expanded" : "collapsed"}`.trim()}
        onClick={toggleProjectsPane}
      />
      <div className="content-topbar-title-wrap">
        <h2 className="content-topbar-title" title={contentPaneTitle}>
          {contentPaneTitle}
        </h2>
        {!showingProjectDashboard ? (
          <>
            <button
              type="button"
              className="title-overflow-button"
              aria-label="Session and workspace actions"
              title="Session actions"
              onClick={() => {
                setTitleMenuOpen(!titleMenuOpen);
                setOpenMenuOpen(false);
                setCommitMenuOpen(false);
              }}
            >
              <Ellipsis size={16} aria-hidden="true" />
            </button>
            {titleMenuOpen ? (
              <div className="title-overflow-menu">
                <button type="button" disabled={!hasActiveSession} onClick={onTogglePinSession}>
                  <span className="menu-item-logo">{isActiveSessionPinned ? <PinOff size={14} aria-hidden="true" /> : <Pin size={14} aria-hidden="true" />}</span>
                  <span>{isActiveSessionPinned ? "Unpin session" : "Pin session"}</span>
                </button>
                <button type="button" disabled={!hasActiveSession} onClick={onRenameSession}>
                  <span className="menu-item-logo">
                    <Pencil size={14} aria-hidden="true" />
                  </span>
                  <span>Rename session</span>
                </button>
                <button type="button" disabled={!hasActiveSession} onClick={onArchiveSession}>
                  <span className="menu-item-logo">
                    <Archive size={14} aria-hidden="true" />
                  </span>
                  <span>Archive session</span>
                </button>
                <button type="button" onClick={onViewWorkspace}>
                  <span className="menu-item-logo">
                    <LayoutDashboard size={14} aria-hidden="true" />
                  </span>
                  <span>View workspace</span>
                </button>
                <div className="menu-separator" />
                <button type="button" onClick={onCopyPath}>
                  <span className="menu-item-logo">
                    <Copy size={14} aria-hidden="true" />
                  </span>
                  <span>Copy path</span>
                </button>
                <button type="button" disabled={!hasActiveSession} onClick={onCopySessionId}>
                  <span className="menu-item-logo">
                    <Fingerprint size={14} aria-hidden="true" />
                  </span>
                  <span>Copy session id</span>
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        <IconButton
          icon="terminal"
          label="Toggle terminal"
          className={`titlebar-toggle titlebar-toggle-terminal ${terminalOpen ? "active" : ""}`.trim()}
          onClick={() => void toggleTerminal()}
        />
        <IconButton
          icon="image"
          label="Toggle artifacts"
          className={`titlebar-toggle titlebar-toggle-artifacts ${artifactsOpen ? "active" : ""}`.trim()}
          onClick={onToggleArtifacts}
        />
      </div>
      <div className="content-edge-right-actions">
        <div ref={runMenuRootRef} className={`titlebar-run-wrap ${runMenuOpen ? "open" : ""}`.trim()}>
          <button
            type="button"
            className="titlebar-run-trigger"
            onClick={toggleRunMenu}
            aria-label="Custom run command"
            title="Custom run command"
            disabled={!hasProjectContext}
          >
            <Play size={13} aria-hidden="true" />
          </button>
          {runMenuOpen ? (
            <div className="titlebar-run-menu" role="menu" aria-label="Custom run commands">
              <small>Custom run commands</small>
              {sortedRunCommands.map((preset) => (
                <div key={preset.id} className="titlebar-run-menu-item">
                  <div className="titlebar-run-menu-item-main">
                    <span className="titlebar-run-menu-item-title">{preset.title}</span>
                    <span className="titlebar-run-menu-item-preview">{summarizeCommands(preset.commands)}</span>
                  </div>
                  <button type="button" aria-label={`Run ${preset.title}`} title={`Run ${preset.title}`} onClick={() => void runCommandPreset(preset)}>
                    <Play size={12} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={`Edit ${preset.title}`} title={`Edit ${preset.title}`} onClick={() => openRunEditor(preset)}>
                    <Pencil size={12} aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={`Delete ${preset.title}`} title={`Delete ${preset.title}`} onClick={() => deleteCommandPreset(preset)}>
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <button type="button" className="titlebar-run-menu-add" onClick={() => openRunEditor()}>
                <Plus size={13} aria-hidden="true" />
                <span>Add new run command</span>
              </button>
            </div>
          ) : null}
        </div>

        <div className={`titlebar-split titlebar-open ${openMenuOpen ? "open" : ""}`.trim()}>
          <button
            type="button"
            className="titlebar-action"
            onClick={() => {
              void openDirectoryInTarget(activeOpenTarget.id);
              setCommitMenuOpen(false);
              setTitleMenuOpen(false);
            }}
            disabled={!hasProjectContext}
          >
            <span className="titlebar-action-logo titlebar-action-logo-app">
              <img src={activeOpenTarget.logo} alt="" aria-hidden="true" />
            </span>
            <span>{activeOpenTarget.label}</span>
          </button>
          <button
            type="button"
            className="titlebar-action-arrow"
            onClick={() => {
              setOpenMenuOpen(!openMenuOpen);
              setCommitMenuOpen(false);
              setTitleMenuOpen(false);
            }}
            aria-label="Open in options"
            title="Open in options"
            disabled={!hasProjectContext}
          >
            <ChevronsUpDown size={12} aria-hidden="true" />
          </button>
          {openMenuOpen ? (
            <div className="titlebar-menu">
              <small>Open in</small>
              {openTargets.map((target) => (
                <button key={target.id} type="button" onClick={() => onSelectOpenTarget(target.id)}>
                  <span className="menu-item-logo menu-item-logo-app">
                    <img src={target.logo} alt="" aria-hidden="true" />
                  </span>
                  <span>{target.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={`titlebar-split titlebar-commit ${commitMenuOpen ? "open" : ""}`.trim()}>
          <button
            type="button"
            className="titlebar-action"
            onClick={() => {
              if (pendingPrUrl) {
                onOpenPendingPullRequest();
              } else {
                openCommitModal();
              }
              setOpenMenuOpen(false);
              setTitleMenuOpen(false);
            }}
            disabled={!hasProjectContext && !pendingPrUrl}
          >
            <span className="titlebar-action-logo">
              {pendingPrUrl ? <Send size={13} aria-hidden="true" /> : <GitCommitHorizontal size={13} aria-hidden="true" />}
            </span>
            <span>{pendingPrUrl ? "View PR" : "Commit"}</span>
          </button>
          <button
            type="button"
            className="titlebar-action-arrow"
            onClick={() => {
              setCommitMenuOpen(!commitMenuOpen);
              setOpenMenuOpen(false);
              setTitleMenuOpen(false);
            }}
            aria-label="Commit options"
            title="Commit options"
            disabled={!hasProjectContext}
          >
            <ChevronsUpDown size={12} aria-hidden="true" />
          </button>
          {commitMenuOpen ? (
            <div className="titlebar-menu">
              <small>Next step</small>
              {commitNextStepOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setCommitNextStep(option.id);
                    openCommitModal(option.id);
                  }}
                >
                  <span className="menu-item-logo">{option.icon}</span>
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={`titlebar-git-toggle-group${gitDiffStats.hasChanges ? " has-changes" : ""}`}>
          {gitDiffStats.hasChanges ? (
            <button
              type="button"
              className="titlebar-action titlebar-git-diff-stats"
              onClick={() => setGitPaneVisible(!showGitPane)}
              aria-label={`Git changes: +${gitDiffStats.additions} -${gitDiffStats.deletions}. Toggle Git sidebar`}
            >
              <span className="added">+{gitDiffStats.additions}</span>
              <span className="removed">-{gitDiffStats.deletions}</span>
            </button>
          ) : null}
          <IconButton
            icon="panelRight"
            label="Toggle Git sidebar"
            className={`titlebar-toggle titlebar-toggle-right ${showGitPane ? "active" : ""}`.trim()}
            onClick={() => setGitPaneVisible(!showGitPane)}
          />
        </div>
      </div>
      {runEditorModal}
    </div>
  );
}
