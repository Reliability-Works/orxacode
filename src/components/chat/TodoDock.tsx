import { useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { DockSurface } from "./DockSurface";

export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface TodoDockProps {
  items: TodoItem[];
  open: boolean;
  onToggle: () => void;
}

function statusIcon(status: TodoItem["status"]) {
  if (status === "completed") {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="todo-item-check"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="6.5" stroke="#22c55e" />
        <path d="M4 7l2.2 2.5L10 4.5" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "in_progress") {
    return (
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="#22c55e"
        xmlns="http://www.w3.org/2000/svg"
        className="todo-item-dot"
        aria-hidden="true"
      >
        <circle cx="6" cy="6" r="3" />
      </svg>
    );
  }
  return null;
}

export function TodoDock({ items, open, onToggle }: TodoDockProps) {
  const completedCount = items.filter((item) => item.status === "completed").length;
  const totalCount = items.length;
  const inProgressRef = useRef<HTMLLIElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const inProgressEl = inProgressRef.current;
    const listEl = listRef.current;
    if (!inProgressEl || !listEl) return;
    requestAnimationFrame(() => {
      const containerRect = listEl.getBoundingClientRect();
      const itemRect = inProgressEl.getBoundingClientRect();
      const topFade = 16;
      const bottomFade = 16;
      const top = itemRect.top - containerRect.top + listEl.scrollTop;
      const bottom = itemRect.bottom - containerRect.top + listEl.scrollTop;
      const viewTop = listEl.scrollTop + topFade;
      const viewBottom = listEl.scrollTop + listEl.clientHeight - bottomFade;
      if (top < viewTop) {
        listEl.scrollTop = Math.max(0, top - topFade);
      } else if (bottom > viewBottom) {
        listEl.scrollTop = bottom - (listEl.clientHeight - bottomFade);
      }
    });
  }, [open, items]);

  const progressLabel = `${completedCount} / ${totalCount} tasks`;

  return (
    <DockSurface
      className={`dock-surface--compact-width${open ? "" : " dock-surface--collapsed-inline"}`.trim()}
      bodyClassName="todo-dock-surface-body"
    >
      <div className="todo-dock">
        <button
          type="button"
          className="todo-dock-header"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? "Collapse todo list" : "Expand todo list"}
        >
          <span className="todo-progress" aria-label={progressLabel}>
            <span className="todo-progress-done">{completedCount}</span>
            <span className="todo-progress-sep"> / </span>
            <span className="todo-progress-total">{totalCount}</span>
            <span className="todo-progress-label"> tasks</span>
          </span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`todo-dock-chevron ${open ? "is-open" : ""}`.trim()}
          />
        </button>

        {open ? (
          <ul
            ref={listRef}
            className="todo-dock-list"
            role="list"
          >
            {items.map((item) => (
              <li
                key={item.id}
                ref={item.status === "in_progress" ? inProgressRef : null}
                className={`todo-item todo-item--${item.status}`}
                data-status={item.status}
              >
                <span className="todo-item-icon">{statusIcon(item.status)}</span>
                <span className="todo-item-text">{item.content}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </DockSurface>
  );
}
