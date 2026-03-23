import { useState, type ReactNode } from "react";

interface ToolGroupProps {
  items: ReactNode[];
  count: number;
  label?: string;
  defaultCollapsed?: boolean;
}

export function ToolGroup({ items, count, label, defaultCollapsed = true }: ToolGroupProps) {
  const [showAll, setShowAll] = useState(!defaultCollapsed);
  const headerLabel = label ?? `${count} tool ${count === 1 ? "call" : "calls"}`;
  const visibleItems = showAll ? items : items.slice(0, 3);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <div className="tool-group">
      <div className="tool-group-header codex-status-line" role="status" aria-label={headerLabel}>
        <span className="tool-group-header-label">
          {headerLabel}
        </span>
      </div>
      <div className="tool-group-body">
        {visibleItems.map((item, i) => (
          <div key={i} className="tool-group-item">
            {item}
          </div>
        ))}
        {hiddenCount > 0 ? (
          <button
            type="button"
            className="tool-group-show-all"
            onClick={() => setShowAll(true)}
          >
            show all ({hiddenCount} more)
          </button>
        ) : null}
      </div>
    </div>
  );
}
