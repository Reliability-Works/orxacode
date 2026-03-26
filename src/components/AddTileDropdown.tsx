import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Globe,
  Image,
  Server,
  Terminal,
  FileText,
  Zap,
} from "lucide-react";
import type { CanvasTile } from "../types/canvas";

type TileType = CanvasTile["type"];

type TileOption = {
  type: TileType;
  label: string;
  icon: React.ReactNode;
};

const TILE_OPTIONS: TileOption[] = [
  { type: "terminal", label: "terminal", icon: <Terminal size={14} aria-hidden="true" /> },
  { type: "claude_code", label: "claude code", icon: <Terminal size={14} aria-hidden="true" /> },
  { type: "codex_cli", label: "codex cli", icon: <Terminal size={14} aria-hidden="true" /> },
  { type: "opencode_cli", label: "opencode", icon: <Terminal size={14} aria-hidden="true" /> },
  { type: "browser", label: "browser", icon: <Globe size={14} aria-hidden="true" /> },
  { type: "file_editor", label: "file editor", icon: <FileText size={14} aria-hidden="true" /> },
  { type: "dev_server", label: "dev server", icon: <Server size={14} aria-hidden="true" /> },
  { type: "markdown_preview", label: "markdown preview", icon: <BookOpen size={14} aria-hidden="true" /> },
  { type: "image_viewer", label: "image viewer", icon: <Image size={14} aria-hidden="true" /> },
  { type: "api_tester", label: "api tester", icon: <Zap size={14} aria-hidden="true" /> },
];

type AddTileDropdownProps = {
  onAddTile: (type: TileType) => void;
  onClose: () => void;
};

export function AddTileDropdown({ onAddTile, onClose }: AddTileDropdownProps) {
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = TILE_OPTIONS.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase()),
  );

  // Focus search input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Outside click to dismiss
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // Escape to dismiss
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="add-tile-dropdown" ref={containerRef} role="dialog" aria-label="Add tile">
      <div className="add-tile-dropdown-header">add tile</div>
      <div className="add-tile-dropdown-search-wrap">
        <input
          ref={inputRef}
          className="add-tile-dropdown-search"
          type="text"
          placeholder="search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search tile types"
        />
      </div>
      <ul className="add-tile-dropdown-list" role="listbox">
        {filtered.map((opt) => (
          <li key={opt.type} role="option" aria-selected={false}>
            <button
              type="button"
              className="add-tile-dropdown-item"
              onClick={() => {
                onAddTile(opt.type);
                onClose();
              }}
            >
              <span className="add-tile-dropdown-item-icon">{opt.icon}</span>
              <span className="add-tile-dropdown-item-label">{opt.label}</span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="add-tile-dropdown-empty">no results</li>
        )}
      </ul>
    </div>
  );
}
