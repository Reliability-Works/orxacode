import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CopyButton } from "./CopyButton";
import { TextPart } from "./TextPart";
import { ReasoningPart } from "./ReasoningPart";
import { MessagePartRenderer } from "./MessagePartRenderer";
import { MessageHeader } from "./MessageHeader";
import { FollowupDock } from "./FollowupDock";
import { MessageTurn } from "./MessageTurn";

// ─── CopyButton ───────────────────────────────────────────────────

describe("CopyButton", () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders with clipboard icon by default", () => {
    render(<CopyButton text="hello" />);
    const btn = screen.getByRole("button", { name: "Copy" });
    expect(btn).toBeInTheDocument();
  });

  it("copies text to clipboard on click", async () => {
    render(<CopyButton text="copy me" />);
    const btn = screen.getByRole("button", { name: "Copy" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("copy me");
  });

  it("shows Copied label after clicking", async () => {
    render(<CopyButton text="hello" />);
    const btn = screen.getByRole("button", { name: "Copy" });
    await act(async () => {
      fireEvent.click(btn);
    });
    // After click, label should switch to "Copied"
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("reverts to Copy label after 2 seconds", async () => {
    vi.useFakeTimers();
    render(<CopyButton text="hello" />);
    const btn = screen.getByRole("button", { name: "Copy" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2001);
    });
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("accepts custom className", () => {
    render(<CopyButton text="test" className="my-class" />);
    const btn = screen.getByRole("button", { name: "Copy" });
    expect(btn.className).toContain("my-class");
    expect(btn.className).toContain("copy-button");
  });
});

// ─── TextPart ─────────────────────────────────────────────────────

describe("TextPart", () => {
  it("renders plain text content", () => {
    render(<TextPart content="Hello world" />);
    expect(document.querySelector(".text-part")).toBeInTheDocument();
    expect(document.querySelector(".text-part-body")).toBeInTheDocument();
  });

  it("renders markdown bold as <strong>", () => {
    render(<TextPart content="**bold text**" />);
    const body = document.querySelector(".text-part-body");
    expect(body?.innerHTML).toContain("<strong>bold text</strong>");
  });

  it("renders markdown inline code", () => {
    render(<TextPart content="`some code`" />);
    const body = document.querySelector(".text-part-body");
    expect(body?.innerHTML).toContain("<code");
  });

  it("does not show copy button when showCopy is false", () => {
    render(<TextPart content="hello" showCopy={false} />);
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("shows copy button when showCopy is true", () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<TextPart content="hello" showCopy={true} />);
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });

  it("applies role modifier class", () => {
    render(<TextPart content="msg" role="assistant" />);
    expect(document.querySelector(".text-part--assistant")).toBeInTheDocument();
  });
});

// ─── ReasoningPart ────────────────────────────────────────────────

describe("ReasoningPart", () => {
  it("renders collapsed by default with fallback label", () => {
    render(<ReasoningPart content="The answer is 42." />);
    const header = screen.getByRole("button");
    expect(header).toBeInTheDocument();
    expect(header.textContent).toContain("Reasoning...");
    // Body should not be visible when collapsed
    expect(screen.queryByText("The answer is 42.")).not.toBeInTheDocument();
  });

  it("renders custom summary as label", () => {
    render(<ReasoningPart content="detail" summary="My reasoning" />);
    const header = screen.getByRole("button");
    expect(header.textContent).toContain("My reasoning");
  });

  it("expands on click to show content", () => {
    render(<ReasoningPart content="Deep thought." />);
    const header = screen.getByRole("button");
    fireEvent.click(header);
    expect(document.querySelector(".reasoning-part-body")).toBeInTheDocument();
  });

  it("collapses again on second click", () => {
    render(<ReasoningPart content="Thought." />);
    const header = screen.getByRole("button");
    fireEvent.click(header);
    expect(document.querySelector(".reasoning-part-body")).toBeInTheDocument();
    fireEvent.click(header);
    expect(document.querySelector(".reasoning-part-body")).not.toBeInTheDocument();
  });

  it("starts expanded when defaultExpanded is true", () => {
    render(<ReasoningPart content="Already shown." defaultExpanded />);
    expect(document.querySelector(".reasoning-part-body")).toBeInTheDocument();
  });

  it("has aria-expanded attribute reflecting state", () => {
    render(<ReasoningPart content="content" />);
    const header = screen.getByRole("button");
    expect(header.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
  });
});

// ─── MessagePartRenderer ──────────────────────────────────────────

describe("MessagePartRenderer", () => {
  it("renders TextPart for text type", () => {
    render(<MessagePartRenderer part={{ type: "text", content: "Hello" }} role="assistant" />);
    expect(document.querySelector(".text-part")).toBeInTheDocument();
  });

  it("renders ReasoningPart for reasoning type", () => {
    render(
      <MessagePartRenderer
        part={{ type: "reasoning", content: "I thought about it." }}
        role="assistant"
      />,
    );
    expect(document.querySelector(".reasoning-part")).toBeInTheDocument();
  });

  it("renders ThinkingShimmer for thinking type", () => {
    render(<MessagePartRenderer part={{ type: "thinking" }} role="assistant" />);
    expect(document.querySelector(".thinking-shimmer")).toBeInTheDocument();
  });

  it("renders compaction divider for compaction type", () => {
    render(<MessagePartRenderer part={{ type: "compaction" }} role="assistant" />);
    expect(document.querySelector(".compaction-divider")).toBeInTheDocument();
    expect(screen.getByText("Conversation compacted")).toBeInTheDocument();
  });

  it("renders file attachment for file type", () => {
    render(
      <MessagePartRenderer
        part={{ type: "file", filename: "report.pdf" }}
        role="user"
      />,
    );
    expect(document.querySelector(".file-attachment")).toBeInTheDocument();
    expect(screen.getByText("report.pdf")).toBeInTheDocument();
  });

  it("renders file attachment with url fallback", () => {
    render(
      <MessagePartRenderer
        part={{ type: "file", url: "https://example.com/doc.pdf" }}
        role="user"
      />,
    );
    expect(screen.getByText("https://example.com/doc.pdf")).toBeInTheDocument();
  });

  it("renders tool part for tool type (fallback to generic card)", () => {
    render(
      <MessagePartRenderer
        part={{ type: "tool", toolName: "read_file", status: "completed" }}
        role="assistant"
      />,
    );
    // Unknown tools fall back to ToolCallCard
    expect(document.querySelector(".tool-call-card")).toBeInTheDocument();
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("uses tool title when provided", () => {
    render(
      <MessagePartRenderer
        part={{ type: "tool", toolName: "run_command", status: "running", title: "Running ls" }}
        role="assistant"
      />,
    );
    expect(screen.getByText("Running ls")).toBeInTheDocument();
  });

  it("passes showCopy to TextPart", () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(
      <MessagePartRenderer
        part={{ type: "text", content: "copy me" }}
        role="assistant"
        showCopy={true}
      />,
    );
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  });
});

// ─── MessageHeader ────────────────────────────────────────────────

describe("MessageHeader", () => {
  it("renders assistant role with > icon", () => {
    render(<MessageHeader role="assistant" />);
    expect(screen.getByText(">")).toBeInTheDocument();
    expect(screen.getByText("Assistant")).toBeInTheDocument();
  });

  it("renders user role without > icon", () => {
    render(<MessageHeader role="user" />);
    expect(screen.queryByText(">")).not.toBeInTheDocument();
    expect(screen.getByText("User")).toBeInTheDocument();
  });

  it("renders custom label", () => {
    render(<MessageHeader role="assistant" label="Codex" />);
    expect(screen.getByText("Codex")).toBeInTheDocument();
  });

  it("renders formatted timestamp", () => {
    // Use a fixed timestamp for deterministic output
    const ts = new Date("2024-01-01T14:30:00").getTime();
    render(<MessageHeader role="assistant" timestamp={ts} />);
    // The rendered text should contain a time string — just check .message-time exists
    expect(document.querySelector(".message-time")).toBeInTheDocument();
  });

  it("renders metadata string with agent, model, and duration", () => {
    render(<MessageHeader role="assistant" agent="builder" model="gpt-4" durationMs={3200} />);
    const meta = document.querySelector(".message-header-meta");
    expect(meta).toBeInTheDocument();
    expect(meta?.textContent).toContain("builder");
    expect(meta?.textContent).toContain("gpt-4");
    expect(meta?.textContent).toContain("3s");
  });

  it("does not render metadata when none provided", () => {
    render(<MessageHeader role="user" />);
    expect(document.querySelector(".message-header-meta")).not.toBeInTheDocument();
  });

  it("applies role modifier class to header", () => {
    render(<MessageHeader role="user" />);
    expect(document.querySelector(".message-header--user")).toBeInTheDocument();
  });

  it("formats duration over 60 seconds correctly", () => {
    render(<MessageHeader role="assistant" durationMs={90000} />);
    const meta = document.querySelector(".message-header-meta");
    expect(meta?.textContent).toContain("1m 30s");
  });
});

// ─── FollowupDock ──────────────────────────────────────────────────

describe("FollowupDock", () => {
  it("renders suggestion chips", () => {
    render(
      <FollowupDock
        suggestions={["Fix the bug", "Add tests", "Refactor this"]}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText("Fix the bug")).toBeInTheDocument();
    expect(screen.getByText("Add tests")).toBeInTheDocument();
    expect(screen.getByText("Refactor this")).toBeInTheDocument();
  });

  it("calls onSelect with suggestion text when chip is clicked", () => {
    const onSelect = vi.fn();
    render(
      <FollowupDock
        suggestions={["Fix the bug", "Add tests"]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("Fix the bug"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("Fix the bug");
  });

  it("calls onSelect with correct suggestion when multiple chips are present", () => {
    const onSelect = vi.fn();
    render(
      <FollowupDock
        suggestions={["First option", "Second option"]}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByText("Second option"));
    expect(onSelect).toHaveBeenCalledWith("Second option");
  });

  it("renders dismiss button when onDismiss is provided", () => {
    render(
      <FollowupDock
        suggestions={["hello"]}
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Dismiss suggestions" })).toBeInTheDocument();
  });

  it("does not render dismiss button when onDismiss is not provided", () => {
    render(
      <FollowupDock suggestions={["hello"]} onSelect={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: "Dismiss suggestions" })).not.toBeInTheDocument();
  });

  it("calls onDismiss when dismiss button is clicked", () => {
    const onDismiss = vi.fn();
    render(
      <FollowupDock
        suggestions={["hello"]}
        onSelect={() => {}}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss suggestions" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when suggestions array is empty", () => {
    const { container } = render(
      <FollowupDock suggestions={[]} onSelect={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("truncates long suggestion text in chip display", () => {
    const longText = "A".repeat(100);
    render(<FollowupDock suggestions={[longText]} onSelect={() => {}} />);
    // Chip text should be truncated (not the full 100 chars)
    const chip = document.querySelector(".followup-chip");
    expect(chip).toBeTruthy();
    expect(chip?.textContent?.length).toBeLessThan(100);
  });

  it("applies .followup-dock class to container", () => {
    render(<FollowupDock suggestions={["hint"]} onSelect={() => {}} />);
    expect(document.querySelector(".followup-dock")).toBeInTheDocument();
  });

  it("applies .followup-chip class to each chip", () => {
    render(
      <FollowupDock suggestions={["one", "two", "three"]} onSelect={() => {}} />,
    );
    expect(document.querySelectorAll(".followup-chip")).toHaveLength(3);
  });
});

// ─── MessageTurn ───────────────────────────────────────────────────

describe("MessageTurn", () => {
  it("renders children", () => {
    render(
      <MessageTurn>
        <p>Turn content here</p>
      </MessageTurn>,
    );
    expect(screen.getByText("Turn content here")).toBeInTheDocument();
  });

  it("does not render interruption divider by default", () => {
    render(
      <MessageTurn>
        <p>content</p>
      </MessageTurn>,
    );
    expect(document.querySelector(".message-turn-divider")).not.toBeInTheDocument();
  });

  it("renders interruption divider when interrupted is true", () => {
    render(
      <MessageTurn interrupted>
        <p>content</p>
      </MessageTurn>,
    );
    expect(document.querySelector(".message-turn-divider")).toBeInTheDocument();
  });

  it("does not render divider when interrupted is false", () => {
    render(
      <MessageTurn interrupted={false}>
        <p>content</p>
      </MessageTurn>,
    );
    expect(document.querySelector(".message-turn-divider")).not.toBeInTheDocument();
  });

  it("applies .message-turn class to wrapper", () => {
    render(
      <MessageTurn>
        <span>child</span>
      </MessageTurn>,
    );
    expect(document.querySelector(".message-turn")).toBeInTheDocument();
  });
});
