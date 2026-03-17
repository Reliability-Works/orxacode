import { useState, type ReactNode } from "react";

interface ToolGroupProps {
  items: ReactNode[];
  count: number;
  defaultCollapsed?: boolean;
}

export function ToolGroup({ items, count, defaultCollapsed = true }: ToolGroupProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <div className="tool-group">
      <button
        type="button"
        className="tool-group-header"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className="tool-group-header-chevron" aria-hidden="true">
          {collapsed ? "›" : "▾"}
        </span>
        <span className="tool-group-header-label">
          {count} tool {count === 1 ? "call" : "calls"}
        </span>
      </button>
      {!collapsed ? (
        <div className="tool-group-body">
          {items.map((item, i) => (
              <div key={i} className="tool-group-item">
              {item}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
