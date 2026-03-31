import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ProjectFileEntry } from '@shared/ipc'

export type ProjectFilesTreeState = Record<string, ProjectFileEntry[]>

type UseProjectFilesTreeOptions = {
  directory: string
  onStatus: (message: string) => void
}

type ProjectFilesFilteredView = {
  nodes: ProjectFilesTreeState
  root: ProjectFileEntry[]
  matchedFiles: number
}

function sortEntries(entries: ProjectFileEntry[]) {
  return [...entries].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') {
      return -1
    }
    if (a.type !== 'directory' && b.type === 'directory') {
      return 1
    }
    return a.name.localeCompare(b.name)
  })
}

function computeFilteredView(
  nodesByPath: ProjectFilesTreeState,
  searchTerm: string,
  totalFileCount: number
): ProjectFilesFilteredView {
  if (!searchTerm) {
    return {
      nodes: nodesByPath,
      root: sortEntries(nodesByPath[''] ?? []),
      matchedFiles: totalFileCount,
    }
  }

  const filteredNodes: ProjectFilesTreeState = {}
  let matchedFiles = 0

  const filterPath = (relativePath: string): ProjectFileEntry[] => {
    const entries = sortEntries(nodesByPath[relativePath] ?? [])
    const visibleEntries: ProjectFileEntry[] = []

    for (const entry of entries) {
      if (entry.type === 'file') {
        if (entry.name.toLowerCase().includes(searchTerm)) {
          visibleEntries.push(entry)
          matchedFiles += 1
        }
        continue
      }

      const childMatches = filterPath(entry.relativePath)
      const folderNameMatch = entry.name.toLowerCase().includes(searchTerm)
      if (folderNameMatch || childMatches.length > 0) {
        visibleEntries.push(entry)
        filteredNodes[entry.relativePath] = childMatches
      }
    }

    return visibleEntries
  }

  filteredNodes[''] = filterPath('')
  return { nodes: filteredNodes, root: filteredNodes[''], matchedFiles }
}

function getFileCountLabel(
  searchActive: boolean,
  matchedFiles: number,
  totalFileCount: number,
  projectFileCount: number | null,
  projectFileCountError: boolean
) {
  const format = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`

  if (!searchActive) {
    if (projectFileCountError) return 'File count unavailable'
    if (projectFileCount === null) return 'Counting files...'
    return format(totalFileCount)
  }

  if (projectFileCountError) return `${matchedFiles} matches`
  return projectFileCount === null ? `${matchedFiles}/... files` : `${matchedFiles}/${totalFileCount} files`
}

function useProjectFileCount(
  directory: string,
  onStatus: (message: string) => void
) {
  const [projectFileCount, setProjectFileCount] = useState<number | null>(null)
  const [projectFileCountError, setProjectFileCountError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setProjectFileCount(null)
    setProjectFileCountError(false)
    void window.orxa.opencode
      .countProjectFiles(directory)
      .then(count => {
        if (!cancelled) {
          setProjectFileCount(count)
        }
      })
      .catch(error => {
        if (!cancelled) {
          onStatus(error instanceof Error ? error.message : String(error))
          setProjectFileCountError(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [directory, onStatus])

  return { projectFileCount, projectFileCountError }
}

function useProjectFilesLoader({ directory, onStatus }: UseProjectFilesTreeOptions) {
  const [nodesByPath, setNodesByPath] = useState<ProjectFilesTreeState>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const nodesByPathRef = useRef<ProjectFilesTreeState>({})
  const folderRequestsRef = useRef<Record<string, Promise<ProjectFileEntry[]>>>({})

  useEffect(() => {
    nodesByPathRef.current = nodesByPath
  }, [nodesByPath])

  const loadFolder = useCallback(async (relativePath = '') => {
    const activeRequest = folderRequestsRef.current[relativePath]
    if (activeRequest) {
      return activeRequest
    }

    const request = (async () => {
      setLoading(current => ({ ...current, [relativePath]: true }))
      try {
        const entries = sortEntries(await window.orxa.opencode.listFiles(directory, relativePath))
        setNodesByPath(current => ({ ...current, [relativePath]: entries }))
        return entries
      } catch (error) {
        onStatus(error instanceof Error ? error.message : String(error))
        return []
      } finally {
        setLoading(current => ({ ...current, [relativePath]: false }))
        delete folderRequestsRef.current[relativePath]
      }
    })()

    folderRequestsRef.current[relativePath] = request
    return request
  }, [directory, onStatus])

  const loadAllFolders = useCallback(async () => {
    const pending = ['']
    const visited = new Set<string>()
    const discoveredDirectories = new Set<string>()

    while (pending.length > 0) {
      const currentPath = pending.shift()
      if (currentPath === undefined || visited.has(currentPath)) {
        continue
      }
      visited.add(currentPath)

      const entries = nodesByPathRef.current[currentPath] ?? (await loadFolder(currentPath))
      for (const entry of entries) {
        if (entry.type === 'directory') {
          discoveredDirectories.add(entry.relativePath)
          if (entry.hasChildren !== false) {
            pending.push(entry.relativePath)
          }
        }
      }
    }

    return discoveredDirectories
  }, [loadFolder])

  useEffect(() => {
    nodesByPathRef.current = {}
    folderRequestsRef.current = {}
    setNodesByPath({})
    setExpanded({})
    void loadFolder('')
  }, [directory, loadFolder])

  const toggleDirectory = useCallback((entry: ProjectFileEntry) => {
    setExpanded(current => {
      const next = !current[entry.relativePath]
      if (next) {
        void loadFolder(entry.relativePath)
      }
      return { ...current, [entry.relativePath]: next }
    })
  }, [loadFolder])

  const expandAll = useCallback(async () => {
    const directories = await loadAllFolders()
    setExpanded(Object.fromEntries([...directories].map(path => [path, true])))
  }, [loadAllFolders])

  const collapseAll = useCallback(() => {
    setExpanded({})
  }, [])

  return { collapseAll, expandAll, expanded, loading, nodesByPath, loadAllFolders, toggleDirectory }
}

function useProjectFilesSearch(
  directory: string,
  nodesByPath: ProjectFilesTreeState,
  loadAllFolders: () => Promise<Set<string>>,
  projectFileCount: number | null,
  projectFileCountError: boolean
) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const searchTerm = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery])
  const searchActive = searchTerm.length > 0

  useEffect(() => {
    setSearchQuery('')
    setSearchLoading(false)
  }, [directory])

  useEffect(() => {
    if (!searchActive) {
      setSearchLoading(false)
      return
    }

    let cancelled = false
    void (async () => {
      setSearchLoading(true)
      await loadAllFolders()
      if (!cancelled) {
        setSearchLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loadAllFolders, searchActive])

  const totalFileCount = useMemo(() => {
    const paths = new Set<string>()
    for (const entries of Object.values(nodesByPath)) {
      for (const entry of entries) {
        if (entry.type === 'file') {
          paths.add(entry.relativePath)
        }
      }
    }
    return paths.size
  }, [nodesByPath])
  const effectiveTotalFileCount = projectFileCount ?? totalFileCount
  const filteredView = useMemo(
    () => computeFilteredView(nodesByPath, searchActive ? searchTerm : '', effectiveTotalFileCount),
    [effectiveTotalFileCount, nodesByPath, searchActive, searchTerm]
  )
  const fileCountLabel = useMemo(
    () =>
      getFileCountLabel(
        searchActive,
        filteredView.matchedFiles,
        effectiveTotalFileCount,
        projectFileCount,
        projectFileCountError
      ),
    [effectiveTotalFileCount, filteredView.matchedFiles, projectFileCount, projectFileCountError, searchActive]
  )

  const renderLabel = useCallback((value: string): ReactNode => {
    if (!searchActive) {
      return value
    }

    const index = value.toLowerCase().indexOf(searchTerm)
    if (index < 0) {
      return value
    }

    const end = index + searchTerm.length
    return (
      <>
        {value.slice(0, index)}
        <mark className="file-tree-label-match">{value.slice(index, end)}</mark>
        {value.slice(end)}
      </>
    )
  }, [searchActive, searchTerm])

  return { fileCountLabel, filteredView, renderLabel, searchActive, searchLoading, searchQuery, setSearchQuery }
}

export function useProjectFilesTree({ directory, onStatus }: UseProjectFilesTreeOptions) {
  const { projectFileCount, projectFileCountError } = useProjectFileCount(directory, onStatus)
  const loader = useProjectFilesLoader({ directory, onStatus })
  const search = useProjectFilesSearch(
    directory,
    loader.nodesByPath,
    loader.loadAllFolders,
    projectFileCount,
    projectFileCountError
  )

  return {
    collapseAll: loader.collapseAll,
    expandAll: loader.expandAll,
    expanded: loader.expanded,
    loading: loader.loading,
    toggleDirectory: loader.toggleDirectory,
    fileCountLabel: search.fileCountLabel,
    filteredView: search.filteredView,
    renderLabel: search.renderLabel,
    searchActive: search.searchActive,
    searchLoading: search.searchLoading,
    searchQuery: search.searchQuery,
    setSearchQuery: search.setSearchQuery,
  }
}
