import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCallCard } from "./ToolCallCard";
import { CommandOutput } from "./CommandOutput";
import { DiffBlock } from "./DiffBlock";
import { ThinkingShimmer } from "./ThinkingShimmer";
import { ToolGroup } from "./ToolGroup";

describe("ToolCallCard", () => {
  it("renders title", () => {
    render(<ToolCallCard title="read_file" status="completed" />);
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("renders status dot with correct status class", () => {
    render(<ToolCallCard title="run_command" status="running" />);
    const dot = document.querySelector(".tool-call-card-status--running");
    expect(dot).toBeTruthy();
  });

  it("renders subtitle when provided", () => {
    render(<ToolCallCard title="write_file" subtitle="src/index.ts" status="completed" />);
    expect(screen.getByText("src/index.ts")).toBeInTheDocument();
  });

  it("expands on click when output is provided", () => {
    render(
      <ToolCallCard title="run_command" status="completed" output="hello world" />,
    );
    const header = screen.getByRole("button");
    // Starts collapsed (defaultExpanded not set)
    expect(screen.queryByText("hello world")).not.toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("starts expanded when defaultExpanded is true", () => {
    render(
      <ToolCallCard title="run_command" status="error" error="Command failed" defaultExpanded />,
    );
    expect(screen.getByText("Command failed")).toBeInTheDocument();
  });

  it("does not render chevron when no body content", () => {
    render(<ToolCallCard title="no_output" status="pending" />);
    expect(document.querySelector(".tool-call-card-chevron")).toBeNull();
  });

  it("renders children when provided", () => {
    render(
      <ToolCallCard title="tool" status="completed" defaultExpanded>
        <span>custom child content</span>
      </ToolCallCard>,
    );
    expect(screen.getByText("custom child content")).toBeInTheDocument();
  });
});

describe("CommandOutput", () => {
  it("renders command text", () => {
    render(<CommandOutput command="ls -la" output="total 0" />);
    expect(screen.getByText("ls -la")).toBeInTheDocument();
  });

  it("renders output text", () => {
    render(<CommandOutput command="echo hi" output="hi" />);
    expect(screen.getByText("hi")).toBeInTheDocument();
  });

  it("renders exit code when provided", () => {
    render(<CommandOutput command="false" output="" exitCode={1} />);
    expect(screen.getByText("[1]")).toBeInTheDocument();
  });

  it("applies ok class for exit code 0", () => {
    render(<CommandOutput command="true" output="" exitCode={0} />);
    const badge = document.querySelector(".command-output-exit-code--ok");
    expect(badge).toBeTruthy();
  });

  it("applies err class for non-zero exit code", () => {
    render(<CommandOutput command="false" output="" exitCode={2} />);
    const badge = document.querySelector(".command-output-exit-code--err");
    expect(badge).toBeTruthy();
  });

  it("renders green prompt symbol", () => {
    render(<CommandOutput command="ls" output="" />);
    expect(screen.getByText("$")).toBeInTheDocument();
  });
});

describe("DiffBlock", () => {
  it("renders file path", () => {
    render(<DiffBlock path="src/utils.ts" type="modified" />);
    expect(screen.getByText("src/utils.ts")).toBeInTheDocument();
  });

  it("renders insertions stat", () => {
    render(<DiffBlock path="src/foo.ts" type="modified" insertions={5} />);
    expect(screen.getByText("+5")).toBeInTheDocument();
  });

  it("renders deletions stat", () => {
    render(<DiffBlock path="src/bar.ts" type="modified" deletions={3} />);
    expect(screen.getByText("-3")).toBeInTheDocument();
  });

  it("renders type label", () => {
    render(<DiffBlock path="src/new.ts" type="added" />);
    expect(screen.getByText("added")).toBeInTheDocument();
  });

  it("shows diff content when expanded", () => {
    const diff = "+const x = 1;\n-const x = 0;";
    render(<DiffBlock path="src/x.ts" type="modified" diff={diff} />);
    // Short diff starts expanded
    expect(screen.getByText("+const x = 1;")).toBeInTheDocument();
  });

  it("does not render chevron when no diff content", () => {
    render(<DiffBlock path="src/empty.ts" type="modified" />);
    expect(document.querySelector(".diff-block-chevron")).toBeNull();
  });
});

describe("ThinkingShimmer", () => {
  it("renders default label", () => {
    render(<ThinkingShimmer />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  it("renders custom label", () => {
    render(<ThinkingShimmer label="Processing" />);
    expect(screen.getByText("Processing...")).toBeInTheDocument();
  });

  it("has aria-label matching the label prop", () => {
    render(<ThinkingShimmer label="Working" />);
    expect(screen.getByLabelText("Working")).toBeInTheDocument();
  });
});

describe("ToolGroup", () => {
  it("renders count in header", () => {
    render(<ToolGroup items={[<span key="a">a</span>, <span key="b">b</span>]} count={2} />);
    expect(screen.getByText("2 tool calls")).toBeInTheDocument();
  });

  it("uses singular 'call' for count of 1", () => {
    render(<ToolGroup items={[<span key="a">a</span>]} count={1} />);
    expect(screen.getByText("1 tool call")).toBeInTheDocument();
  });

  it("is collapsed by default", () => {
    render(
      <ToolGroup
        items={[<span key="a">visible content</span>]}
        count={1}
        defaultCollapsed
      />,
    );
    expect(screen.queryByText("visible content")).not.toBeInTheDocument();
  });

  it("expands on click", () => {
    render(
      <ToolGroup
        items={[<span key="a">visible content</span>]}
        count={1}
        defaultCollapsed
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("visible content")).toBeInTheDocument();
  });

  it("starts expanded when defaultCollapsed is false", () => {
    render(
      <ToolGroup
        items={[<span key="a">shown</span>]}
        count={1}
        defaultCollapsed={false}
      />,
    );
    expect(screen.getByText("shown")).toBeInTheDocument();
  });
});
