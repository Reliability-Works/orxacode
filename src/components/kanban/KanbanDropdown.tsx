import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type DropdownOption<T extends string> = {
  value: T;
  label: string;
};

export function KanbanDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  compact,
}: {
  label?: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointer);
    return () => window.removeEventListener("mousedown", handlePointer);
  }, [open]);

  return (
    <div className={`kanban-dropdown${compact ? " kanban-dropdown--compact" : ""}`} ref={ref}>
      {label ? <span className="kanban-dropdown-label">{label}</span> : null}
      <button type="button" className="kanban-dropdown-trigger" onClick={() => setOpen((current) => !current)}>
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={12} aria-hidden="true" className={`kanban-dropdown-chevron${open ? " is-open" : ""}`} />
      </button>
      {open ? (
        <div className="kanban-dropdown-menu" role="listbox">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`kanban-dropdown-option${option.value === value ? " active" : ""}`.trim()}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
