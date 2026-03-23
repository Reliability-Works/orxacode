import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ToolCallCard } from "./ToolCallCard";
import { CommandOutput } from "./CommandOutput";
import { DiffBlock } from "./DiffBlock";
import { ChangedFilesCluster } from "./ChangedFilesCluster";
import { ThinkingRow } from "./ThinkingRow";
import { ThinkingShimmer } from "./ThinkingShimmer";
import { ToolGroup } from "./ToolGroup";
import { ExploreRow } from "./ExploreRow";

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

  it("only applies the expanded card chrome when opened", () => {
    render(<ToolCallCard title="run_command" status="completed" output="done" />);
    const card = document.querySelector(".tool-call-card");
    expect(card?.getAttribute("data-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button"));
    expect(card?.getAttribute("data-expanded")).toBe("true");
    expect(card?.className).toContain("is-expanded");
  });

  it("keeps the same title visible when expanded", () => {
    render(
      <ToolCallCard title="Ran npm install convex" expandedTitle="Ran command" status="completed" output="done" />,
    );
    expect(screen.getByText("Ran npm install convex")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Ran npm install convex")).toBeInTheDocument();
    expect(screen.queryByText("Ran command")).toBeNull();
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

  it("does not render an empty output block when the command produced no output", () => {
    render(<CommandOutput command="true" output="" />);
    expect(document.querySelector(".command-output-body")).toBeNull();
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

  it("tails long output instead of rendering the full stream", () => {
    const output = Array.from({ length: 250 }, (_, index) => `line ${index + 1}`).join("\n");
    render(<CommandOutput command="cat huge.log" output={output} />);

    expect(screen.getByText("tail 200")).toBeInTheDocument();
    expect(screen.queryByText("line 1")).not.toBeInTheDocument();
    expect(document.querySelector(".command-output-body")).toHaveTextContent("line 250");
  });

  it("can hide the duplicated prompt line while keeping output visible", () => {
    render(<CommandOutput command="npm run lint" output="ok" hidePrompt />);
    expect(screen.queryByText("$")).not.toBeInTheDocument();
    expect(screen.queryByText("npm run lint")).not.toBeInTheDocument();
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});

describe("DiffBlock", () => {
  it("renders file path", () => {
    render(<DiffBlock path="src/utils.ts" type="modified" />);
    expect(screen.getByText("src/utils.ts")).toBeInTheDocument();
  });

  it("renders the edited verb in the collapsed header", () => {
    render(<DiffBlock path="src/utils.ts" type="modified" />);
    expect(screen.getByText("Edited")).toBeInTheDocument();
  });

  it("renders insertions stat", () => {
    render(<DiffBlock path="src/foo.ts" type="modified" insertions={5} />);
    expect(screen.getByText("+5")).toBeInTheDocument();
  });

  it("renders deletions stat", () => {
    render(<DiffBlock path="src/bar.ts" type="modified" deletions={3} />);
    expect(screen.getByText("-3")).toBeInTheDocument();
  });

  it("shows diff content when expanded", () => {
    const diff = "+const x = 1;\n-const x = 0;";
    render(<DiffBlock path="src/x.ts" type="modified" diff={diff} />);
    expect(screen.queryByText("+const x = 1;")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByText("Edited").length).toBeGreaterThan(0);
    expect(screen.getAllByText("src/x.ts").length).toBeGreaterThan(0);
    expect(screen.getByText("+const x = 1;")).toBeInTheDocument();
  });

  it("renders line numbers when the diff is expanded", () => {
    const diff = [
      "@@ -10,2 +10,3 @@",
      " const stable = true;",
      "-const oldValue = 1;",
      "+const newValue = 2;",
      "+const anotherValue = 3;",
    ].join("\n");
    render(<DiffBlock path="src/x.ts" type="modified" diff={diff} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getAllByText("10").length).toBeGreaterThan(0);
    expect(screen.getAllByText("11").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".diff-block-line-number").length).toBeGreaterThan(0);
  });

  it("derives diff stats from diff content when counts are not provided", () => {
    const diff = [
      "diff --git a/src/x.ts b/src/x.ts",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -1 +1,2 @@",
      "-old",
      "+new",
      "+another",
    ].join("\n");
    render(<DiffBlock path="src/x.ts" type="modified" diff={diff} />);
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });

  it("hides unified diff metadata lines from the expanded diff body", () => {
    const diff = [
      "diff --git a/src/x.ts b/src/x.ts",
      "--- a/src/x.ts",
      "+++ b/src/x.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n");
    render(<DiffBlock path="src/x.ts" type="modified" diff={diff} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("@@ -1 +1 @@")).not.toBeInTheDocument();
    expect(screen.queryByText("diff --git a/src/x.ts b/src/x.ts")).not.toBeInTheDocument();
    expect(screen.getByText("-old")).toBeInTheDocument();
    expect(screen.getByText("+new")).toBeInTheDocument();
  });

  it("does not render chevron when no diff content", () => {
    render(<DiffBlock path="src/empty.ts" type="modified" />);
    expect(document.querySelector(".diff-block-chevron")).toBeNull();
  });

  it("falls back safely when a persisted diff row is missing a path", () => {
    render(<DiffBlock path={undefined} type="modified" />);
    expect(screen.getByText("(unknown file)")).toBeInTheDocument();
  });
});

describe("ChangedFilesCluster", () => {
  const files = Array.from({ length: 7 }, (_, index) => ({
    id: `file-${index + 1}`,
    path: `src/file-${index + 1}.ts`,
    type: "modified",
  }));

  it("shows only the first five files until expanded", () => {
    render(<ChangedFilesCluster title="Changed files" files={files} />);
    expect(screen.getByText("src/file-1.ts")).toBeInTheDocument();
    expect(screen.getByText("src/file-5.ts")).toBeInTheDocument();
    expect(screen.queryByText("src/file-6.ts")).toBeNull();
    expect(screen.getByRole("button", { name: /show all/i })).toBeInTheDocument();
  });

  it("can expand to show all files and collapse again", () => {
    render(<ChangedFilesCluster title="Changed files" files={files} />);
    fireEvent.click(screen.getByRole("button", { name: /show all/i }));
    expect(screen.getByText("src/file-6.ts")).toBeInTheDocument();
    expect(screen.getByText("src/file-7.ts")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^hide$/i }));
    expect(screen.queryByText("src/file-6.ts")).toBeNull();
    expect(screen.queryByText("src/file-7.ts")).toBeNull();
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

describe("ThinkingRow", () => {
  it("does not repeat a static Thinking summary beside the shimmer", () => {
    render(<ThinkingRow summary="Thinking" content="" />);
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
    expect(screen.queryByText(/^Thinking$/)).toBeNull();
  });

  it("hides expandable thinking summaries until the disclosure is opened", () => {
    render(<ThinkingRow summary="Planning the next edits" content="Create package.json and install dependencies." />);

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
    expect(screen.queryByText("Planning the next edits")).toBeNull();
    expect(screen.getByText("Create package.json and install dependencies.")).not.toBeVisible();

    fireEvent.click(screen.getByText("Thinking..."));

    expect(screen.getByText("Create package.json and install dependencies.")).toBeInTheDocument();
  });
});

describe("ToolGroup", () => {
  it("renders count in header", () => {
    render(<ToolGroup items={[<span key="a">a</span>, <span key="b">b</span>]} count={2} />);
    expect(screen.getByText("2 tool calls")).toBeInTheDocument();
  });

  it("can render a custom header label", () => {
    render(<ToolGroup items={[<span key="a">a</span>]} count={1} label="Tool calls" />);
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
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
    expect(screen.getByText("visible content")).toBeInTheDocument();
  });

  it("shows first three items by default and reveals the rest on show all", () => {
    render(
      <ToolGroup
        items={[
          <span key="a">one</span>,
          <span key="b">two</span>,
          <span key="c">three</span>,
          <span key="d">four</span>,
        ]}
        count={4}
        defaultCollapsed
      />,
    );
    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("two")).toBeInTheDocument();
    expect(screen.getByText("three")).toBeInTheDocument();
    expect(screen.queryByText("four")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "show all (1 more)" }));
    expect(screen.getByText("four")).toBeInTheDocument();
  });

  it("starts expanded when defaultCollapsed is false", () => {
    render(
      <ToolGroup
        items={[
          <span key="a">shown</span>,
          <span key="b">also shown</span>,
          <span key="c">still shown</span>,
          <span key="d">extra shown</span>,
        ]}
        count={4}
        defaultCollapsed={false}
      />,
    );
    expect(screen.getByText("shown")).toBeInTheDocument();
    expect(screen.getByText("extra shown")).toBeInTheDocument();
  });
});

describe("ExploreRow", () => {
  it("starts expanded while exploring", () => {
    render(
      <ExploreRow
        item={{
          id: "explore-1",
          status: "exploring",
          entries: [{ id: "entry-1", kind: "search", label: "Searched for foo", status: "running" }],
        }}
      />,
    );

    expect(screen.getByText("Searched for foo")).toBeInTheDocument();
  });

  it("collapses again when exploration becomes explored", () => {
    const { rerender } = render(
      <ExploreRow
        item={{
          id: "explore-1",
          status: "exploring",
          entries: [{ id: "entry-1", kind: "read", label: "Read file.ts", status: "running" }],
        }}
      />,
    );

    expect(screen.getByText("Read file.ts")).toBeInTheDocument();

    rerender(
      <ExploreRow
        item={{
          id: "explore-1",
          status: "explored",
          entries: [{ id: "entry-1", kind: "read", label: "Read file.ts", status: "completed" }],
        }}
      />,
    );

    expect(screen.queryByText("Read file.ts")).toBeNull();
    expect(screen.getByText("Explored 1 file")).toBeInTheDocument();
  });
});
