import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { ProjectListItem } from "@shared/ipc";
import { useUnifiedRuntimeStore } from "../state/unified-runtime-store";
import { getPersistedCodexState } from "../hooks/codex-session-storage";
import { getPersistedClaudeChatState } from "../hooks/claude-chat-session-storage";
import { buildWorkspaceSessionMetadataKey } from "../lib/workspace-session-metadata";

type SearchResult = {
  sessionID: string;
  directory: string;
  sessionTitle: string;
  workspaceLabel: string;
  provider: string;
  matches: Array<{
    type: "title" | "message";
    messageId?: string;
    role?: string;
    snippet: string;
    timestamp?: number;
  }>;
};

type SessionEntry = {
  id: string;
  title?: string;
  slug: string;
};

type GlobalSearchModalProps = {
  open: boolean;
  onClose: () => void;
  projects: ProjectListItem[];
  projectSessions: Record<string, SessionEntry[]>;
  getSessionTitle: (sessionID: string, directory?: string, fallbackTitle?: string) => string | undefined;
  getSessionType: (sessionID: string, directory?: string) => string | undefined;
  openSession: (directory: string, sessionID: string) => void | Promise<void>;
};

function extractTextFromOpencodeParts(parts: Array<{ type?: string; text?: string; content?: string }>): string {
  return parts
    .filter((p) => p.type === "text" || p.type === "markdown")
    .map((p) => p.text ?? p.content ?? "")
    .join(" ");
}

function highlightSnippet(text: string, query: string, maxLen = 120): string {
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return text.slice(0, maxLen);
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 80);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "..." + snippet;
  if (end < text.length) snippet = snippet + "...";
  return snippet;
}

export function GlobalSearchModal({
  open,
  onClose,
  projects,
  projectSessions,
  getSessionTitle,
  getSessionType,
  openSession,
}: GlobalSearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const projectLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const p of projects) {
      map[p.worktree] = p.name || p.worktree.split("/").at(-1) || p.worktree;
    }
    return map;
  }, [projects]);

  const performSearch = useCallback(
    (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([]);
        return;
      }
      setSearching(true);
      const q = searchQuery.toLowerCase().trim();
      const found: SearchResult[] = [];
      const state = useUnifiedRuntimeStore.getState();

      for (const project of projects) {
        const directory = project.worktree;
        const sessions = projectSessions[directory] ?? [];
        const workspaceLabel = projectLabelMap[directory] ?? directory;

        for (const session of sessions) {
          const sessionTitle =
            getSessionTitle(session.id, directory, session.title ?? session.slug) ??
            session.title ??
            session.slug;
          const sessionType = getSessionType(session.id, directory);
          const matches: SearchResult["matches"] = [];

          // Match session title
          if (sessionTitle.toLowerCase().includes(q)) {
            matches.push({ type: "title", snippet: sessionTitle });
          }

          // Search messages based on provider type
          const sessionKey = buildWorkspaceSessionMetadataKey(directory, session.id);

          if (sessionType === "codex") {
            const persisted = getPersistedCodexState(sessionKey);
            for (const msg of persisted.messages) {
              if (msg.kind === "message" && msg.content?.toLowerCase().includes(q)) {
                matches.push({
                  type: "message",
                  messageId: msg.id,
                  role: msg.role,
                  snippet: highlightSnippet(msg.content, searchQuery),
                  timestamp: msg.timestamp,
                });
              }
            }
          } else if (sessionType === "claude-chat") {
            const persisted = getPersistedClaudeChatState(sessionKey);
            for (const msg of persisted.messages) {
              if (msg.kind === "message" && msg.content?.toLowerCase().includes(q)) {
                matches.push({
                  type: "message",
                  messageId: msg.id,
                  role: msg.role,
                  snippet: highlightSnippet(msg.content, searchQuery),
                  timestamp: msg.timestamp,
                });
              }
            }
          } else if (sessionType === "standalone" || sessionType === "opencode") {
            // OpenCode sessions use the runtime store
            const opcodeKey = `opencode::${directory}::${session.id}`;
            const runtime = state.opencodeSessions[opcodeKey];
            if (runtime?.messages) {
              for (const bundle of runtime.messages) {
                const text = extractTextFromOpencodeParts(bundle.parts as Array<{ type?: string; text?: string; content?: string }>);
                if (text.toLowerCase().includes(q)) {
                  matches.push({
                    type: "message",
                    messageId: bundle.info.id,
                    role: (bundle.info as { role?: string }).role ?? "unknown",
                    snippet: highlightSnippet(text, searchQuery),
                    timestamp: bundle.info.time?.created
                      ? new Date(bundle.info.time.created).getTime()
                      : undefined,
                  });
                }
              }
            }
          }

          if (matches.length > 0) {
            found.push({
              sessionID: session.id,
              directory,
              sessionTitle,
              workspaceLabel,
              provider: sessionType ?? "unknown",
              matches: matches.slice(0, 5), // Cap at 5 matches per session
            });
          }
        }
      }

      setResults(found);
      setSearching(false);
    },
    [projects, projectSessions, projectLabelMap, getSessionTitle, getSessionType],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter") {
      performSearch(query);
    }
  };

  const handleResultClick = (result: SearchResult, messageId?: string) => {
    void openSession(result.directory, result.sessionID);
    onClose();
    // If clicking a specific message, try to scroll to it after session loads
    if (messageId) {
      setTimeout(() => {
        const el = document.getElementById(`msg-${messageId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("search-highlight-flash");
          setTimeout(() => el.classList.remove("search-highlight-flash"), 2000);
        }
      }, 500);
    }
  };

  if (!open) return null;

  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal global-search-modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Search</h2>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        <div className="global-search-input-wrapper">
          <Search size={14} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search sessions and messages..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button
              type="button"
              className="global-search-clear"
              onClick={() => {
                setQuery("");
                setResults([]);
                inputRef.current?.focus();
              }}
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="global-search-results">
          {searching ? (
            <p className="global-search-empty">Searching...</p>
          ) : results.length === 0 && query.trim() ? (
            <p className="global-search-empty">No results found</p>
          ) : results.length === 0 ? (
            <p className="global-search-empty">Type a query and press Enter to search</p>
          ) : (
            results.map((result) => (
              <div key={`${result.directory}::${result.sessionID}`} className="global-search-group">
                <div className="global-search-group-header">
                  <span className="global-search-session-title">{result.sessionTitle}</span>
                  <span className="global-search-workspace-label">{result.workspaceLabel}</span>
                  <span className="global-search-provider-badge">{result.provider}</span>
                </div>
                <div className="global-search-group-matches">
                  {result.matches.map((match, i) => (
                    <button
                      key={`${result.sessionID}-match-${i}`}
                      type="button"
                      className="global-search-match-row"
                      onClick={() => handleResultClick(result, match.messageId)}
                    >
                      <span className="global-search-match-type">
                        {match.type === "title" ? "Title" : match.role ?? "msg"}
                      </span>
                      <span className="global-search-match-snippet">
                        {renderHighlightedSnippet(match.snippet, query)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function renderHighlightedSnippet(snippet: string, query: string) {
  if (!query.trim()) return snippet;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = snippet.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="global-search-highlight">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
