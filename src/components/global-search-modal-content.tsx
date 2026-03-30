import { Search, X } from 'lucide-react'
import type { ReactNode, RefObject } from 'react'
import type { SearchResult } from './global-search-modal-search'

type GlobalSearchResultsProps = {
  results: SearchResult[]
  query: string
  searching: boolean
  onResultClick: (result: SearchResult, messageId?: string) => void
}

export function GlobalSearchResults({
  results,
  query,
  searching,
  onResultClick,
}: GlobalSearchResultsProps) {
  if (searching) {
    return <p className="global-search-empty">Searching...</p>
  }
  if (results.length === 0 && query.trim()) {
    return <p className="global-search-empty">No results found</p>
  }
  if (results.length === 0) {
    return <p className="global-search-empty">Type a query and press Enter to search</p>
  }

  return (
    <>
      {results.map(result => (
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
                onClick={() => onResultClick(result, match.messageId)}
              >
                <span className="global-search-match-type">
                  {match.type === 'title' ? 'Title' : (match.role ?? 'msg')}
                </span>
                <span className="global-search-match-snippet">
                  {renderHighlightedSnippet(match.snippet, query)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

export function GlobalSearchInputIcon() {
  return <Search size={14} aria-hidden="true" />
}

export function GlobalSearchClearButton({
  onClick,
}: {
  onClick: () => void
}) {
  return (
    <button type="button" className="global-search-clear" onClick={onClick}>
      <X size={12} />
    </button>
  )
}

type GlobalSearchModalViewProps = {
  open: boolean
  onClose: () => void
  query: string
  results: SearchResult[]
  searching: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onQueryChange: (value: string) => void
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
  onResultClick: (result: SearchResult, messageId?: string) => void
  onClear: () => void
}

export function GlobalSearchModalView({
  open,
  onClose,
  query,
  results,
  searching,
  inputRef,
  onQueryChange,
  onKeyDown,
  onResultClick,
  onClear,
}: GlobalSearchModalViewProps) {
  if (!open) {
    return null
  }

  return (
    <div className="overlay" onClick={onClose}>
      <section className="modal global-search-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <h2>Search</h2>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        <div className="global-search-input-wrapper">
          <GlobalSearchInputIcon />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search sessions and messages..."
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {query && <GlobalSearchClearButton onClick={onClear} />}
        </div>

        <div className="global-search-results">
          <GlobalSearchResults
            results={results}
            query={query}
            searching={searching}
            onResultClick={onResultClick}
          />
        </div>
      </section>
    </div>
  )
}

function renderHighlightedSnippet(snippet: string, query: string): ReactNode {
  if (!query.trim()) return snippet
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  const parts = snippet.split(regex)
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="global-search-highlight">
        {part}
      </mark>
    ) : (
      part
    )
  )
}
