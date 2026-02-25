import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Session } from "@opencode-ai/sdk/v2/client";
import type { SkillEntry } from "@shared/ipc";
import { GlobalModalsHost, type GlobalModalsHostProps } from "./GlobalModalsHost";

function createSession(overrides?: Partial<Session>): Session {
  const now = Date.now();
  return {
    id: "session-1",
    title: "Session 1",
    slug: "session-1",
    projectID: "project-1",
    directory: "/tmp/project",
    version: "1",
    parentID: undefined,
    time: { created: now, updated: now },
    ...overrides,
  };
}

function buildProps(overrides?: Partial<GlobalModalsHostProps>): GlobalModalsHostProps {
  return {
    activeProjectDir: "/tmp/project",
    dependencyReport: null,
    dependencyModalOpen: false,
    setDependencyModalOpen: vi.fn(),
    onCheckDependencies: vi.fn(),
    permissionRequest: null,
    permissionDecisionInFlight: false,
    replyPermission: vi.fn(),
    questionRequest: null,
    replyQuestion: vi.fn(),
    rejectQuestion: vi.fn(),
    allSessionsModalOpen: false,
    setAllSessionsModalOpen: vi.fn(),
    sessions: [],
    getSessionStatusType: () => "idle",
    activeSessionID: undefined,
    openSession: vi.fn(),
    jobRunViewer: null,
    closeJobRunViewer: vi.fn(),
    projects: [],
    jobRunViewerLoading: false,
    jobRunViewerMessages: [],
    branchCreateModalOpen: false,
    setBranchCreateModalOpen: vi.fn(),
    branchCreateName: "",
    setBranchCreateName: vi.fn(),
    branchCreateError: null,
    setBranchCreateError: vi.fn(),
    submitBranchCreate: vi.fn(async () => undefined),
    branchSwitching: false,
    commitModalOpen: false,
    setCommitModalOpen: vi.fn(),
    commitSummary: null,
    commitSummaryLoading: false,
    commitIncludeUnstaged: false,
    setCommitIncludeUnstaged: vi.fn(),
    commitMessageDraft: "",
    setCommitMessageDraft: vi.fn(),
    commitNextStepOptions: [],
    commitNextStep: "commit",
    setCommitNextStep: vi.fn(),
    commitSubmitting: false,
    submitCommit: vi.fn(async () => undefined),
    jobEditorOpen: false,
    jobDraft: {} as GlobalModalsHostProps["jobDraft"],
    closeJobEditor: vi.fn(),
    updateJobEditor: vi.fn(),
    saveJobEditor: vi.fn(async () => undefined),
    addProjectDirectory: vi.fn(async () => undefined),
    skillUseModal: null,
    setSkillUseModal: vi.fn(),
    applySkillToProject: vi.fn(async () => undefined),
    profileModalOpen: false,
    setProfileModalOpen: vi.fn(),
    profiles: [],
    runtime: { status: "disconnected", managedServer: false },
    onSaveProfile: vi.fn(async () => undefined),
    onDeleteProfile: vi.fn(async () => undefined),
    onAttachProfile: vi.fn(async () => undefined),
    onStartLocalProfile: vi.fn(async () => undefined),
    onStopLocalProfile: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("GlobalModalsHost", () => {
  it("allows approving or rejecting permission requests when not pending", () => {
    const replyPermission = vi.fn();
    render(
      <GlobalModalsHost
        {...buildProps({
          permissionRequest: {
            id: "perm-1",
            sessionID: "session-1",
            permission: "bash",
            patterns: ["echo test"],
            metadata: {},
            always: [],
          },
          replyPermission,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow session" }));
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(replyPermission).toHaveBeenCalledTimes(3);
    expect(replyPermission).toHaveBeenNthCalledWith(1, "once");
    expect(replyPermission).toHaveBeenNthCalledWith(2, "always");
    expect(replyPermission).toHaveBeenNthCalledWith(3, "reject");
    expect(screen.getByText("OpenCode is requesting access to run: echo test")).toBeInTheDocument();
  });

  it("shows a yellow attention indicator for permission-blocked sessions", () => {
    const { container } = render(
      <GlobalModalsHost
        {...buildProps({
          allSessionsModalOpen: true,
          sessions: [createSession()],
          getSessionStatusType: () => "permission",
        })}
      />,
    );

    const indicator = container.querySelector(".session-status-indicator.attention");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toBe("!");
  });

  it("asks whether to use current or new session before preparing a skill prompt", async () => {
    const skill: SkillEntry = {
      id: "frontend-design",
      name: "frontend-design",
      description: "Design beautiful frontend interfaces.",
      path: "/tmp/skills/frontend-design",
    };
    const applySkillToProject = vi.fn(async () => undefined);
    render(
      <GlobalModalsHost
        {...buildProps({
          projects: [{ id: "project-1", source: "local", worktree: "/tmp/project", name: "Project" }],
          skillUseModal: { skill, projectDir: "/tmp/project" },
          applySkillToProject,
        })}
      />,
    );

    expect(screen.getByRole("button", { name: "Add new workspace" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prepare prompt" }));
    expect(screen.getByText("Add this prepared prompt to:")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Current session" }));
    expect(applySkillToProject).toHaveBeenCalledWith(skill, "/tmp/project", "current");
  });
});
