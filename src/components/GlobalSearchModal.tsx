import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectListItem } from '@shared/ipc'
import { GlobalSearchModalView } from './global-search-modal-content'
import { searchGlobalSessions, type SearchResult } from './global-search-modal-search'

type SessionEntry = {
  id: string
  title?: string
  slug: string
}

type GlobalSearchModalProps = {
  open: boolean
  onClose: () => void
  projects: ProjectListItem[]
  projectSessions: Record<string, SessionEntry[]>
  getSessionTitle: (
    sessionID: string,
    directory?: string,
    fallbackTitle?: string
  ) => string | undefined
  getSessionType: (sessionID: string, directory?: string) => string | undefined
  openSession: (directory: string, sessionID: string) => void | Promise<void>
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
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults([])
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const projectLabelMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of projects) {
      map[p.worktree] = p.name || p.worktree.split('/').at(-1) || p.worktree
    }
    return map
  }, [projects])

  const performSearch = useCallback(
    (searchQuery: string) => {
      if (!searchQuery.trim()) {
        setResults([])
        setSearching(false)
        return
      }
      setSearching(true)
      setResults(
        searchGlobalSessions(
          projects,
          projectSessions,
          projectLabelMap,
          getSessionTitle,
          getSessionType,
          searchQuery
        )
      )
      setSearching(false)
    },
    [projects, projectSessions, projectLabelMap, getSessionTitle, getSessionType]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter') {
      performSearch(query)
    }
  }

  const handleResultClick = (result: SearchResult, messageId?: string) => {
    void openSession(result.directory, result.sessionID)
    onClose()
    // If clicking a specific message, try to scroll to it after session loads
    if (messageId) {
      setTimeout(() => {
        const el = document.getElementById(`msg-${messageId}`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          el.classList.add('search-highlight-flash')
          setTimeout(() => el.classList.remove('search-highlight-flash'), 2000)
        }
      }, 500)
    }
  }

  if (!open) return null

  return (
    <GlobalSearchModalView
      open={open}
      onClose={onClose}
      query={query}
      results={results}
      searching={searching}
      inputRef={inputRef}
      onQueryChange={setQuery}
      onKeyDown={handleKeyDown}
      onResultClick={handleResultClick}
      onClear={() => {
        setQuery('')
        setResults([])
        inputRef.current?.focus()
      }}
    />
  )
}
