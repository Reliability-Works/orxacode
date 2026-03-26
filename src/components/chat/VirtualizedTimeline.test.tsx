import { createRef } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VirtualizedTimeline, type VirtualizedTimelineRow } from "./VirtualizedTimeline";

const measureMock = vi.fn();
const getVirtualItemsMock = vi.fn(() => []);
const getTotalSizeMock = vi.fn(() => 0);
const useVirtualizerMock = vi.fn((options?: unknown) => {
  void options;
  return {
    getVirtualItems: getVirtualItemsMock,
    getTotalSize: getTotalSizeMock,
    measureElement: vi.fn(),
    measure: measureMock,
  };
});

vi.mock("@tanstack/react-virtual", () => ({
  measureElement: vi.fn(),
  useVirtualizer: (options: unknown) => useVirtualizerMock(options),
}));

type Row = VirtualizedTimelineRow & {
  estimate: number;
  label: string;
};

describe("VirtualizedTimeline", () => {
  beforeEach(() => {
    measureMock.mockClear();
    getVirtualItemsMock.mockClear();
    getTotalSizeMock.mockClear();
    useVirtualizerMock.mockClear();
  });

  it("remeasures virtualized rows when row estimates change during streaming", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const rows: Row[] = [
      { id: "row-1", estimate: 80, label: "first" },
      { id: "row-2", estimate: 80, label: "second" },
      { id: "row-3", estimate: 80, label: "third" },
      { id: "row-4", estimate: 80, label: "fourth" },
      { id: "row-5", estimate: 80, label: "fifth" },
      { id: "row-6", estimate: 80, label: "sixth" },
      { id: "row-7", estimate: 80, label: "seventh" },
      { id: "row-8", estimate: 80, label: "eighth" },
      { id: "row-9", estimate: 80, label: "ninth" },
    ];

    const { rerender } = render(
      <VirtualizedTimeline
        rows={rows}
        scrollRef={scrollRef}
        estimateSize={(row) => row.estimate}
        renderRow={(row) => <div>{row.label}</div>}
      />,
    );

    expect(measureMock).toHaveBeenCalledTimes(1);

    rerender(
      <VirtualizedTimeline
        rows={rows.map((row) => (row.id === "row-1" ? { ...row, estimate: 180 } : row))}
        scrollRef={scrollRef}
        estimateSize={(row) => row.estimate}
        renderRow={(row) => <div>{row.label}</div>}
      />,
    );

    expect(measureMock).toHaveBeenCalledTimes(2);
  });

  it("renders rows without virtualization when explicitly disabled", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const rows: Row[] = [
      { id: "row-a", estimate: 80, label: "alpha" },
      { id: "row-b", estimate: 80, label: "beta" },
    ];

    const { getByText } = render(
      <VirtualizedTimeline
        rows={rows}
        scrollRef={scrollRef}
        virtualize={false}
        estimateSize={(row) => row.estimate}
        renderRow={(row) => <div>{row.label}</div>}
      />,
    );

    expect(getByText("alpha")).toBeInTheDocument();
    expect(getByText("beta")).toBeInTheDocument();
    expect(useVirtualizerMock).toHaveBeenCalledTimes(1);
    expect(useVirtualizerMock.mock.calls[0]?.[0]).toMatchObject({ count: 0 });
  });

  it("uses instant bottom snap when session rows hydrate after mount", () => {
    const scrollRef = createRef<HTMLDivElement>();
    const scrollToMock = vi.fn();
    let scrollTopValue = 0;
    let scrollHeightValue = 0;
    let clientHeightValue = 400;
    const emptyRows: Row[] = [];

    const { container, rerender } = render(
      <VirtualizedTimeline
        rows={emptyRows}
        scrollRef={scrollRef}
        virtualize={false}
        sessionId="session-hydrate"
        estimateSize={(row) => row.estimate}
        renderRow={(row) => <div>{row.label}</div>}
      />,
    );

    const scrollEl = container.querySelector(".messages-scroll") as HTMLDivElement;
    expect(scrollEl).toBeTruthy();

    Object.defineProperty(scrollEl, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (next: number) => {
        scrollTopValue = next;
      },
    });
    Object.defineProperty(scrollEl, "scrollHeight", {
      configurable: true,
      get: () => scrollHeightValue,
    });
    Object.defineProperty(scrollEl, "clientHeight", {
      configurable: true,
      get: () => clientHeightValue,
    });
    Object.defineProperty(scrollEl, "scrollTo", {
      configurable: true,
      value: scrollToMock,
    });

    scrollHeightValue = 1200;
    clientHeightValue = 400;

    rerender(
      <VirtualizedTimeline
        rows={[{ id: "row-loaded", estimate: 120, label: "loaded" }]}
        scrollRef={scrollRef}
        virtualize={false}
        sessionId="session-hydrate"
        estimateSize={(row) => row.estimate}
        renderRow={(row) => <div>{row.label}</div>}
      />,
    );

    expect(scrollTopValue).toBe(1200);
    expect(scrollToMock).not.toHaveBeenCalled();

    scrollHeightValue = 2200;
    rerender(
      <VirtualizedTimeline
        rows={[
          { id: "row-loaded", estimate: 120, label: "loaded" },
          { id: "row-loaded-2", estimate: 220, label: "loaded-2" },
        ]}
        scrollRef={scrollRef}
        virtualize={false}
        sessionId="session-hydrate"
        estimateSize={(row) => row.estimate}
        renderRow={(row) => <div>{row.label}</div>}
      />,
    );

    expect(scrollTopValue).toBe(2200);
    expect(scrollToMock).not.toHaveBeenCalled();
  });
});
