import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DockSurface } from "./DockSurface";
import { TodoDock } from "./TodoDock";
import type { TodoItem } from "./TodoDock";
import { QuestionDock } from "./QuestionDock";
import type { AgentQuestion } from "./QuestionDock";
import { PermissionDock } from "./PermissionDock";
import { QueuedMessagesDock } from "./QueuedMessagesDock";
import type { QueuedMessage } from "./QueuedMessagesDock";

// ─── DockSurface ─────────────────────────────────────────────────────────────

describe("DockSurface", () => {
  it("renders children", () => {
    render(
      <DockSurface>
        <span>dock body content</span>
      </DockSurface>,
    );
    expect(screen.getByText("dock body content")).toBeInTheDocument();
  });

  it("renders title when provided", () => {
    render(
      <DockSurface title="My Dock">
        <span>body</span>
      </DockSurface>,
    );
    expect(screen.getByText("My Dock")).toBeInTheDocument();
  });

  it("renders close button and calls onClose when clicked", () => {
    const onClose = vi.fn();
    render(
      <DockSurface title="Closeable" onClose={onClose}>
        <span>body</span>
      </DockSurface>,
    );
    const closeBtn = screen.getByRole("button", { name: "Close" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render close button when onClose is not provided", () => {
    render(
      <DockSurface title="No close">
        <span>body</span>
      </DockSurface>,
    );
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("renders footer when provided", () => {
    render(
      <DockSurface footer={<span>footer content</span>}>
        <span>body</span>
      </DockSurface>,
    );
    expect(screen.getByText("footer content")).toBeInTheDocument();
  });

  it("does not render header when no header props are provided", () => {
    render(
      <DockSurface>
        <span>body only</span>
      </DockSurface>,
    );
    expect(document.querySelector(".dock-surface-header")).toBeNull();
  });

  it("applies dock-surface class", () => {
    render(
      <DockSurface>
        <span>body</span>
      </DockSurface>,
    );
    expect(document.querySelector(".dock-surface")).toBeTruthy();
  });
});

// ─── TodoDock ─────────────────────────────────────────────────────────────────

const makeTodos = (): TodoItem[] => [
  { id: "1", content: "Write tests", status: "completed" },
  { id: "2", content: "Fix bug", status: "in_progress" },
  { id: "3", content: "Deploy app", status: "pending" },
  { id: "4", content: "Old task", status: "cancelled" },
];

describe("TodoDock", () => {
  it("renders progress counter with correct done/total", () => {
    render(<TodoDock items={makeTodos()} open={false} onToggle={() => {}} />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("tasks")).toBeInTheDocument();
  });

  it("does not render list when collapsed", () => {
    render(<TodoDock items={makeTodos()} open={false} onToggle={() => {}} />);
    expect(screen.queryByText("Write tests")).toBeNull();
  });

  it("renders list items when open", () => {
    render(<TodoDock items={makeTodos()} open={true} onToggle={() => {}} />);
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    expect(screen.getByText("Fix bug")).toBeInTheDocument();
    expect(screen.getByText("Deploy app")).toBeInTheDocument();
    expect(screen.getByText("Old task")).toBeInTheDocument();
  });

  it("applies correct status class to each item", () => {
    render(<TodoDock items={makeTodos()} open={true} onToggle={() => {}} />);
    expect(document.querySelector(".todo-item--completed")).toBeTruthy();
    expect(document.querySelector(".todo-item--in_progress")).toBeTruthy();
    expect(document.querySelector(".todo-item--pending")).toBeTruthy();
    expect(document.querySelector(".todo-item--cancelled")).toBeTruthy();
  });

  it("calls onToggle when header button is clicked", () => {
    const onToggle = vi.fn();
    render(<TodoDock items={makeTodos()} open={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("sets aria-expanded based on open prop", () => {
    const { rerender } = render(<TodoDock items={makeTodos()} open={false} onToggle={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");
    rerender(<TodoDock items={makeTodos()} open={true} onToggle={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("marks in_progress item with data-status attribute", () => {
    render(<TodoDock items={makeTodos()} open={true} onToggle={() => {}} />);
    const item = document.querySelector('[data-status="in_progress"]');
    expect(item).toBeTruthy();
  });
});

// ─── QuestionDock ─────────────────────────────────────────────────────────────

const makeQuestions = (): AgentQuestion[] => [
  {
    id: "q1",
    text: "Which framework do you prefer?",
    options: [
      { label: "React", value: "react" },
      { label: "Vue", value: "vue" },
      { label: "Svelte", value: "svelte" },
    ],
  },
];

const makeMultiQuestion = (): AgentQuestion[] => [
  {
    id: "q1",
    text: "Select all that apply:",
    multiSelect: true,
    options: [
      { label: "TypeScript", value: "ts" },
      { label: "ESLint", value: "eslint" },
      { label: "Prettier", value: "prettier" },
    ],
  },
];

describe("QuestionDock", () => {
  it("renders question text", () => {
    render(<QuestionDock questions={makeQuestions()} onSubmit={() => {}} onReject={() => {}} />);
    expect(screen.getByText("Which framework do you prefer?")).toBeInTheDocument();
  });

  it("renders option buttons", () => {
    render(<QuestionDock questions={makeQuestions()} onSubmit={() => {}} onReject={() => {}} />);
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("Vue")).toBeInTheDocument();
    expect(screen.getByText("Svelte")).toBeInTheDocument();
  });

  it("selects option on click", () => {
    render(<QuestionDock questions={makeQuestions()} onSubmit={() => {}} onReject={() => {}} />);
    const reactBtn = screen.getByRole("radio", { name: /React/i });
    fireEvent.click(reactBtn);
    expect(reactBtn).toHaveAttribute("aria-checked", "true");
    expect(reactBtn.closest(".question-option")).toHaveClass("question-option--selected");
  });

  it("deselects previously selected option in single-select", () => {
    render(<QuestionDock questions={makeQuestions()} onSubmit={() => {}} onReject={() => {}} />);
    const reactBtn = screen.getByRole("radio", { name: /React/i });
    const vueBtn = screen.getByRole("radio", { name: /Vue/i });
    fireEvent.click(reactBtn);
    fireEvent.click(vueBtn);
    expect(reactBtn).toHaveAttribute("aria-checked", "false");
    expect(vueBtn).toHaveAttribute("aria-checked", "true");
  });

  it("toggles multiple options in multi-select", () => {
    render(<QuestionDock questions={makeMultiQuestion()} onSubmit={() => {}} onReject={() => {}} />);
    const tsBtn = screen.getByRole("checkbox", { name: /TypeScript/i });
    const eslintBtn = screen.getByRole("checkbox", { name: /ESLint/i });
    fireEvent.click(tsBtn);
    fireEvent.click(eslintBtn);
    expect(tsBtn).toHaveAttribute("aria-checked", "true");
    expect(eslintBtn).toHaveAttribute("aria-checked", "true");
    // deselect one
    fireEvent.click(tsBtn);
    expect(tsBtn).toHaveAttribute("aria-checked", "false");
    expect(eslintBtn).toHaveAttribute("aria-checked", "true");
  });

  it("calls onReject when dismiss button is clicked", () => {
    const onReject = vi.fn();
    render(<QuestionDock questions={makeQuestions()} onSubmit={() => {}} onReject={onReject} />);
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it("calls onSubmit with answers when continue button clicked on last question", () => {
    const onSubmit = vi.fn();
    render(<QuestionDock questions={makeQuestions()} onSubmit={onSubmit} onReject={() => {}} />);
    // Select React option (role=radio, text includes "React")
    const reactBtn = screen.getByRole("radio", { name: /React/i });
    fireEvent.click(reactBtn);
    // Click Continue button
    fireEvent.click(screen.getByRole("button", { name: /Continue/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ q1: "react" });
  });

  it("shows progress dots container when multiple questions", () => {
    const twoQuestions: AgentQuestion[] = [
      { id: "q1", text: "First question?", options: [{ label: "Yes", value: "yes" }] },
      { id: "q2", text: "Second question?", options: [{ label: "No", value: "no" }] },
    ];
    render(<QuestionDock questions={twoQuestions} onSubmit={() => {}} onReject={() => {}} />);
    expect(document.querySelector(".question-dots")).toBeTruthy();
    expect(document.querySelectorAll(".question-dot")).toHaveLength(2);
  });

  it("does not show progress dots for single question", () => {
    render(<QuestionDock questions={makeQuestions()} onSubmit={() => {}} onReject={() => {}} />);
    expect(document.querySelector(".question-dots")).toBeNull();
  });

  it("renders textarea when question has no options", () => {
    const noOpts: AgentQuestion[] = [{ id: "q1", text: "Describe your issue:" }];
    render(<QuestionDock questions={noOpts} onSubmit={() => {}} onReject={() => {}} />);
    expect(screen.getByPlaceholderText("Type your answer...")).toBeInTheDocument();
  });

  it("navigates to next question when Next question nav button clicked", () => {
    const twoQuestions: AgentQuestion[] = [
      { id: "q1", text: "First question?", options: [{ label: "Yes", value: "yes" }] },
      { id: "q2", text: "Second question?", options: [{ label: "No", value: "no" }] },
    ];
    render(<QuestionDock questions={twoQuestions} onSubmit={() => {}} onReject={() => {}} />);
    expect(screen.getByText("First question?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next question" }));
    expect(screen.getByText("Second question?")).toBeInTheDocument();
  });

  it("shows Previous question nav button enabled on second question", () => {
    const twoQuestions: AgentQuestion[] = [
      { id: "q1", text: "First question?", options: [{ label: "Yes", value: "yes" }] },
      { id: "q2", text: "Second question?", options: [{ label: "No", value: "no" }] },
    ];
    render(<QuestionDock questions={twoQuestions} onSubmit={() => {}} onReject={() => {}} />);
    // Navigate to second question using the forward nav arrow
    const nextNav = screen.getByRole("button", { name: "Next question" });
    fireEvent.click(nextNav);
    // Previous nav button should now be enabled
    const prevNav = screen.getByRole("button", { name: "Previous question" });
    expect(prevNav).not.toBeDisabled();
  });
});

// ─── PermissionDock ───────────────────────────────────────────────────────────

describe("PermissionDock", () => {
  it("renders description text", () => {
    render(
      <PermissionDock
        description="The agent wants to write to the filesystem."
        onDecide={() => {}}
      />,
    );
    expect(screen.getByText("The agent wants to write to the filesystem.")).toBeInTheDocument();
  });

  it("renders file pattern when provided", () => {
    render(
      <PermissionDock
        description="Permission needed"
        filePattern="src/**/*.ts"
        onDecide={() => {}}
      />,
    );
    expect(screen.getByText("src/**/*.ts")).toBeInTheDocument();
  });

  it("renders command preview when provided", () => {
    render(
      <PermissionDock
        description="Permission needed"
        command={["git", "push", "origin", "main"]}
        onDecide={() => {}}
      />,
    );
    expect(screen.getByText(/git push origin main/)).toBeInTheDocument();
  });

  it("renders three action buttons", () => {
    render(
      <PermissionDock description="Permission needed" onDecide={() => {}} />,
    );
    expect(screen.getByText("Allow once")).toBeInTheDocument();
    expect(screen.getByText("Always allow")).toBeInTheDocument();
    expect(screen.getByText("Reject")).toBeInTheDocument();
  });

  it("calls onDecide with 'allow_once' when Allow once clicked", () => {
    const onDecide = vi.fn();
    render(<PermissionDock description="Permission needed" onDecide={onDecide} />);
    fireEvent.click(screen.getByText("Allow once"));
    expect(onDecide).toHaveBeenCalledWith("allow_once");
  });

  it("calls onDecide with 'allow_always' when Always allow clicked", () => {
    const onDecide = vi.fn();
    render(<PermissionDock description="Permission needed" onDecide={onDecide} />);
    fireEvent.click(screen.getByText("Always allow"));
    expect(onDecide).toHaveBeenCalledWith("allow_always");
  });

  it("calls onDecide with 'reject' when Reject clicked", () => {
    const onDecide = vi.fn();
    render(<PermissionDock description="Permission needed" onDecide={onDecide} />);
    fireEvent.click(screen.getByText("Reject"));
    expect(onDecide).toHaveBeenCalledWith("reject");
  });

  it("does not render file pattern section when filePattern is not provided", () => {
    render(<PermissionDock description="Permission needed" onDecide={() => {}} />);
    expect(document.querySelector(".permission-preview--file")).toBeNull();
  });

  it("does not render command section when command is not provided", () => {
    render(<PermissionDock description="Permission needed" onDecide={() => {}} />);
    expect(document.querySelector(".permission-preview--command")).toBeNull();
  });
});

// ─── QueuedMessagesDock ───────────────────────────────────────────────────────

const makeQueuedMessages = (): QueuedMessage[] => [
  { id: "q1", text: "First queued message", timestamp: 1700000000000 },
  { id: "q2", text: "Second queued message", timestamp: 1700000060000 },
];

describe("QueuedMessagesDock", () => {
  it("renders nothing when messages array is empty", () => {
    const { container } = render(
      <QueuedMessagesDock
        messages={[]}
        onSendNow={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders header with count for single message", () => {
    render(
      <QueuedMessagesDock
        messages={[makeQueuedMessages()[0]]}
        onSendNow={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("1 followup message queued")).toBeInTheDocument();
  });

  it("renders header with plural count for multiple messages", () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onSendNow={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("2 followup messages queued")).toBeInTheDocument();
  });

  it("renders message text for each queued item", () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onSendNow={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("First queued message")).toBeInTheDocument();
    expect(screen.getByText("Second queued message")).toBeInTheDocument();
  });

  it("truncates long message text at 60 chars", () => {
    const longText = "A".repeat(70);
    render(
      <QueuedMessagesDock
        messages={[{ id: "q1", text: longText, timestamp: Date.now() }]}
        onSendNow={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />,
    );
    const displayed = screen.getByText(/A+\u2026/);
    expect(displayed).toBeInTheDocument();
    expect(displayed.textContent?.length).toBeLessThanOrEqual(61);
  });

  it("calls onSendNow with the correct id when Send now is clicked", () => {
    const onSendNow = vi.fn();
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onSendNow={onSendNow}
        onEdit={() => {}}
        onRemove={() => {}}
      />,
    );
    const sendButtons = screen.getAllByRole("button", { name: "Send now" });
    fireEvent.click(sendButtons[0]);
    expect(onSendNow).toHaveBeenCalledWith("q1");
  });

  it("calls onEdit with the correct id when Edit is clicked", () => {
    const onEdit = vi.fn();
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onSendNow={() => {}}
        onEdit={onEdit}
        onRemove={() => {}}
      />,
    );
    const editButtons = screen.getAllByRole("button", { name: "Edit message" });
    fireEvent.click(editButtons[1]);
    expect(onEdit).toHaveBeenCalledWith("q2");
  });

  it("calls onRemove with the correct id when remove button is clicked", () => {
    const onRemove = vi.fn();
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onSendNow={() => {}}
        onEdit={() => {}}
        onRemove={onRemove}
      />,
    );
    const removeButtons = screen.getAllByRole("button", { name: "Remove from queue" });
    fireEvent.click(removeButtons[0]);
    expect(onRemove).toHaveBeenCalledWith("q1");
  });

  it("disables Send now buttons while sendingId is set", () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        sendingId="q1"
        onSendNow={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />,
    );
    const sendButtons = screen.getAllByRole("button", { name: /Send now|Sending/ });
    for (const btn of sendButtons) {
      expect(btn).toBeDisabled();
    }
  });

  it("shows 'Sending' label on the in-flight item", () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        sendingId="q1"
        onSendNow={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("Sending")).toBeInTheDocument();
  });

  it("renders queued-messages-dock class", () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onSendNow={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(document.querySelector(".queued-messages-dock")).toBeTruthy();
  });

  it("renders one queued-message-item per message", () => {
    render(
      <QueuedMessagesDock
        messages={makeQueuedMessages()}
        onSendNow={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(document.querySelectorAll(".queued-message-item")).toHaveLength(2);
  });
});
