import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BashTool } from "./BashTool";
import { EditTool } from "./EditTool";
import { ContextToolGroup } from "./ContextToolGroup";
import { ToolPart } from "./ToolPart";
import { MessagePartRenderer } from "./MessagePartRenderer";
import { stripAnsi } from "../../lib/ansi";

// ─── stripAnsi ────────────────────────────────────────────────────

describe("stripAnsi", () => {
  it("strips basic colour codes", () => {
    expect(stripAnsi("\x1b[32mhello\x1b[0m")).toBe("hello");
  });

  it("strips bold codes", () => {
    expect(stripAnsi("\x1b[1mbold\x1b[0m")).toBe("bold");
  });

  it("passes plain text unchanged", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });

  it("strips multi-param codes like 38;5;200", () => {
    expect(stripAnsi("\x1b[38;5;200mcolor\x1b[0m")).toBe("color");
  });
});

// ─── BashTool ─────────────────────────────────────────────────────

describe("BashTool", () => {
  it("renders the command as title", () => {
    render(<BashTool command="ls -la" status="completed" />);
    expect(screen.getByText("ls -la")).toBeInTheDocument();
  });

  it("strips ANSI codes from output", () => {
    render(
      <BashTool
        command="echo hi"
        output="\x1b[32mhello\x1b[0m"
        status="completed"
        exitCode={0}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    const pre = document.querySelector(".command-output-body");
    expect(pre).toBeTruthy();
    expect(pre?.textContent).not.toContain("\x1b");
    expect(pre?.textContent).toContain("hello");
  });

  it("shows exit code in CommandOutput", () => {
    render(
      <BashTool command="false" output="err" exitCode={1} status="completed" />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("[1]")).toBeInTheDocument();
  });

  it("shows status dot with correct class", () => {
    render(<BashTool command="ls" status="running" />);
    expect(document.querySelector(".tool-call-card-status--running")).toBeTruthy();
  });

  it("falls back to 'pending' for unknown status", () => {
    render(<BashTool command="ls" status="unknown-xyz" />);
    expect(document.querySelector(".tool-call-card-status--pending")).toBeTruthy();
  });

  it("renders without output or error and stays collapsed", () => {
    render(<BashTool command="sleep 1" status="running" />);
    // No body rendered when there is nothing to show
    expect(document.querySelector(".command-output")).not.toBeInTheDocument();
  });
});

// ─── EditTool ─────────────────────────────────────────────────────

describe("EditTool", () => {
  it("renders file path as title", () => {
    render(<EditTool path="src/index.ts" status="completed" />);
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
  });

  it("renders +/- stats in subtitle", () => {
    render(
      <EditTool path="src/index.ts" status="completed" insertions={5} deletions={2} />,
    );
    const subtitle = document.querySelector(".tool-call-card-subtitle");
    expect(subtitle).toBeTruthy();
    expect(subtitle?.textContent).toContain("+5");
    expect(subtitle?.textContent).toContain("-2");
  });

  it("renders only insertions when deletions absent", () => {
    render(<EditTool path="src/a.ts" status="completed" insertions={3} />);
    expect(screen.getByText("+3")).toBeInTheDocument();
  });

  it("renders DiffBlock when diff is provided", () => {
    const diff = "+const x = 1;\n-const x = 0;";
    render(
      <EditTool path="src/b.ts" status="completed" diff={diff} insertions={1} deletions={1} />,
    );
    // The ToolCallCard wraps a DiffBlock — expand the card first
    const header = screen.getAllByRole("button")[0];
    fireEvent.click(header);
    // DiffBlock renders its own header with the path
    const pathElements = screen.getAllByText("src/b.ts");
    expect(pathElements.length).toBeGreaterThan(0);
  });

  it("shows status dot with correct class", () => {
    render(<EditTool path="src/c.ts" status="error" />);
    expect(document.querySelector(".tool-call-card-status--error")).toBeTruthy();
  });
});

// ─── ContextToolGroup ─────────────────────────────────────────────

describe("ContextToolGroup", () => {
  it("renders nothing when items is empty", () => {
    const { container } = render(<ContextToolGroup items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders single item without a collapsible header", () => {
    render(
      <ContextToolGroup
        items={[{ toolName: "read", title: "src/index.ts", status: "completed" }]}
      />,
    );
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders single item with the correct tool label", () => {
    render(
      <ContextToolGroup
        items={[{ toolName: "read", title: "src/index.ts", status: "completed" }]}
      />,
    );
    expect(screen.getByText("Read")).toBeInTheDocument();
  });

  it("renders multi-item group with summary label", () => {
    render(
      <ContextToolGroup
        items={[
          { toolName: "read", title: "a.ts", status: "completed" },
          { toolName: "grep", title: "b.ts", status: "completed" },
          { toolName: "list", title: "src/", status: "completed" },
        ]}
      />,
    );
    expect(screen.getByText("3 files explored")).toBeInTheDocument();
  });

  it("multi-item group is collapsed by default", () => {
    render(
      <ContextToolGroup
        items={[
          { toolName: "read", title: "a.ts", status: "completed" },
          { toolName: "read", title: "b.ts", status: "completed" },
        ]}
      />,
    );
    expect(screen.queryByText("a.ts")).not.toBeInTheDocument();
  });

  it("expands multi-item group on click", () => {
    render(
      <ContextToolGroup
        items={[
          { toolName: "read", title: "a.ts", status: "completed" },
          { toolName: "read", title: "b.ts", status: "completed" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("b.ts")).toBeInTheDocument();
  });

  it("group status is 'running' when any item is running", () => {
    render(
      <ContextToolGroup
        items={[
          { toolName: "read", title: "a.ts", status: "completed" },
          { toolName: "read", title: "b.ts", status: "running" },
        ]}
      />,
    );
    expect(document.querySelector(".context-tool-status--running")).toBeTruthy();
  });

  it("group status is 'error' when any item has error", () => {
    render(
      <ContextToolGroup
        items={[
          { toolName: "read", title: "a.ts", status: "completed" },
          { toolName: "read", title: "b.ts", status: "error" },
        ]}
      />,
    );
    expect(document.querySelector(".context-tool-status--error")).toBeTruthy();
  });

  it("renders detail text when provided", () => {
    render(
      <ContextToolGroup
        items={[{ toolName: "read", title: "file.ts", status: "completed", detail: "120 chars" }]}
      />,
    );
    expect(screen.getByText("120 chars")).toBeInTheDocument();
  });
});

// ─── ToolPart routing ─────────────────────────────────────────────

describe("ToolPart", () => {
  it("routes bash to BashTool — renders command", () => {
    render(
      <ToolPart
        toolName="bash"
        status="completed"
        command="ls -la"
        output="total 0"
      />,
    );
    expect(document.querySelector(".bash-tool")).toBeInTheDocument();
    // Command appears in both card title and CommandOutput prompt — check title
    const title = document.querySelector(".tool-call-card-title");
    expect(title?.textContent).toBe("ls -la");
  });

  it("routes shell to BashTool", () => {
    render(<ToolPart toolName="shell" status="completed" command="echo hi" />);
    expect(document.querySelector(".bash-tool")).toBeInTheDocument();
  });

  it("routes command to BashTool", () => {
    render(<ToolPart toolName="command" status="running" command="make build" />);
    expect(document.querySelector(".bash-tool")).toBeInTheDocument();
  });

  it("extracts command from input when command prop absent", () => {
    render(
      <ToolPart
        toolName="bash"
        status="completed"
        input={{ command: "npm test" }}
      />,
    );
    expect(screen.getByText("npm test")).toBeInTheDocument();
  });

  it("routes edit to EditTool", () => {
    render(
      <ToolPart
        toolName="edit"
        status="completed"
        input={{ path: "src/app.ts", insertions: 2, deletions: 1 }}
      />,
    );
    expect(document.querySelector(".edit-tool")).toBeInTheDocument();
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
  });

  it("routes write to EditTool", () => {
    render(
      <ToolPart
        toolName="write"
        status="completed"
        input={{ path: "src/new.ts" }}
      />,
    );
    expect(document.querySelector(".edit-tool")).toBeInTheDocument();
  });

  it("routes apply_patch with changes array to stacked EditTools", () => {
    render(
      <ToolPart
        toolName="apply_patch"
        status="completed"
        changes={[
          { path: "a.ts", insertions: 1 },
          { path: "b.ts", deletions: 2 },
        ]}
      />,
    );
    expect(document.querySelectorAll(".edit-tool").length).toBe(2);
  });

  it("routes read to ContextToolGroup", () => {
    render(
      <ToolPart
        toolName="read"
        status="completed"
        input={{ path: "src/utils.ts" }}
      />,
    );
    expect(document.querySelector(".context-tool-group")).toBeInTheDocument();
    expect(screen.getByText("src/utils.ts")).toBeInTheDocument();
  });

  it("routes glob to ContextToolGroup", () => {
    render(
      <ToolPart
        toolName="glob"
        status="completed"
        input={{ pattern: "**/*.ts" }}
      />,
    );
    expect(document.querySelector(".context-tool-group")).toBeInTheDocument();
  });

  it("routes grep to ContextToolGroup", () => {
    render(
      <ToolPart
        toolName="grep"
        status="completed"
        input={{ pattern: "useState" }}
      />,
    );
    expect(document.querySelector(".context-tool-group")).toBeInTheDocument();
  });

  it("routes webfetch to ContextToolGroup", () => {
    render(
      <ToolPart
        toolName="webfetch"
        status="completed"
        input={{ url: "https://example.com" }}
      />,
    );
    expect(document.querySelector(".context-tool-group")).toBeInTheDocument();
  });

  it("routes todowrite to checklist", () => {
    render(
      <ToolPart
        toolName="todowrite"
        status="completed"
        input={{
          todos: [
            { content: "Task one", status: "completed" },
            { content: "Task two", status: "pending" },
          ],
        }}
      />,
    );
    expect(document.querySelector(".todo-checklist")).toBeInTheDocument();
    expect(screen.getByText("Task one")).toBeInTheDocument();
    expect(screen.getByText("Task two")).toBeInTheDocument();
  });

  it("todowrite marks completed items with checkmark", () => {
    render(
      <ToolPart
        toolName="todowrite"
        status="completed"
        input={{ todos: [{ content: "Done item", status: "completed" }] }}
      />,
    );
    expect(document.querySelector(".todo-checklist-item--done")).toBeInTheDocument();
    expect(screen.getByText("✓")).toBeInTheDocument();
  });

  it("routes question to inline question display", () => {
    render(
      <ToolPart
        toolName="question"
        status="completed"
        input={{ question: "What is the meaning of life?" }}
      />,
    );
    expect(document.querySelector(".question-display")).toBeInTheDocument();
    expect(screen.getByText("What is the meaning of life?")).toBeInTheDocument();
  });

  it("routes task to task card", () => {
    render(
      <ToolPart
        toolName="task"
        status="completed"
        input={{ description: "Build the UI" }}
      />,
    );
    expect(document.querySelector(".task-card")).toBeInTheDocument();
    expect(screen.getByText("Build the UI")).toBeInTheDocument();
  });

  it("falls back to generic ToolCallCard for unknown tool", () => {
    render(
      <ToolPart
        toolName="my_custom_tool"
        status="completed"
        title="Custom Tool"
        output="some output"
      />,
    );
    expect(document.querySelector(".tool-call-card")).toBeInTheDocument();
    expect(screen.getByText("Custom Tool")).toBeInTheDocument();
  });
});

// ─── MessagePartRenderer integration ─────────────────────────────

describe("MessagePartRenderer tool integration", () => {
  it("renders BashTool for bash tool parts", () => {
    render(
      <MessagePartRenderer
        part={{
          type: "tool",
          toolName: "bash",
          status: "completed",
          command: "ls",
          output: "file.ts",
        }}
        role="assistant"
      />,
    );
    expect(document.querySelector(".bash-tool")).toBeInTheDocument();
  });

  it("renders EditTool for edit tool parts", () => {
    render(
      <MessagePartRenderer
        part={{
          type: "tool",
          toolName: "edit",
          status: "completed",
          input: { path: "src/main.ts" },
        }}
        role="assistant"
      />,
    );
    expect(document.querySelector(".edit-tool")).toBeInTheDocument();
  });

  it("renders ContextToolGroup for read tool parts", () => {
    render(
      <MessagePartRenderer
        part={{
          type: "tool",
          toolName: "read",
          status: "completed",
          input: { path: "README.md" },
        }}
        role="assistant"
      />,
    );
    expect(document.querySelector(".context-tool-group")).toBeInTheDocument();
  });

  it("no longer renders tool-part-placeholder", () => {
    render(
      <MessagePartRenderer
        part={{
          type: "tool",
          toolName: "read",
          status: "completed",
        }}
        role="assistant"
      />,
    );
    expect(document.querySelector(".tool-part-placeholder")).not.toBeInTheDocument();
  });
});
