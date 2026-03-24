import { useEffect, useState } from "react";
import { Search as SearchLucide, Eye as EyeLucide } from "lucide-react";
import type { ExploreEntry, ExploreEntryKind } from "../../lib/explore-utils";
import { buildExploreLabel } from "../../lib/explore-utils";
import { ChatFileIcon, ChatSearchIcon } from "./chat-icons";

export interface ExploreRowItem {
  id: string;
  status: "exploring" | "explored";
  entries: ExploreEntry[];
  timestamp?: number;
}

interface ExploreRowProps {
  item: ExploreRowItem;
}

function ExploreHeaderIcon({ entries }: { entries: ExploreEntry[] }) {
  const hasSearch = entries.some((e) => e.kind === "search" || e.kind === "list");
  if (hasSearch) {
    return <SearchLucide size={13} className="explore-header-icon" aria-hidden="true" />;
  }
  return <EyeLucide size={13} className="explore-header-icon" aria-hidden="true" />;
}

function EntryIcon({ kind }: { kind: ExploreEntryKind }) {
  if (kind === "search") return <ChatSearchIcon className="explore-entry-icon" />;
  if (kind === "list") return <ChatSearchIcon className="explore-entry-icon" />;
  // read, run, mcp — default to file icon
  return <ChatFileIcon className="explore-entry-icon" />;
}

function EntryStatusDot({ status }: { status: ExploreEntry["status"] }) {
  return (
    <span
      className={`explore-entry-status explore-entry-status--${status}`}
      aria-label={status}
    />
  );
}

export function ExploreRow({ item }: ExploreRowProps) {
  const [expanded, setExpanded] = useState(item.status === "exploring");
  const isExploring = item.status === "exploring";
  const label = buildExploreLabel(item.entries, item.status);

  useEffect(() => {
    setExpanded(item.status === "exploring");
  }, [item.id, item.status]);

  return (
    <div className="explore-group">
      <button
        type="button"
        className="explore-group-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <ExploreHeaderIcon entries={item.entries} />
        <span className={`explore-group-label${isExploring ? " explore-group-label--exploring" : ""}`}>
          {label}
        </span>
        <span className="explore-group-chevron" aria-hidden="true">
          {expanded ? "▾" : "›"}
        </span>
      </button>

      {expanded ? (
        <div className="explore-group-entries">
          {item.entries.map((entry) => (
            <div key={entry.id} className="explore-entry">
              <EntryIcon kind={entry.kind} />
              <span className="explore-entry-label">{entry.label}</span>
              {entry.detail ? (
                <span className="explore-entry-detail">{entry.detail}</span>
              ) : null}
              <EntryStatusDot status={entry.status} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
