import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ProjectFileEntry, SkillEntry } from '@shared/ipc'
import { PROVIDER_SKILL_ROOTS, type SkillProvider } from '../lib/provider-skill-roots'

export type ComposerAutocompleteProvider = SkillProvider

type SlashCommand = {
  name: string
  description?: string
  meta?: string
  insertText?: string
  onSelect?: () => void
}

export type ComposerAutocompleteItem = {
  id: string
  name: string
  description?: string
  meta?: string
  trigger: '/' | '@'
  kind: 'command' | 'skill' | 'file'
  insertText: string
  onSelect?: () => void
}

type UseComposerAutocompleteArgs = {
  provider: ComposerAutocompleteProvider
  directory: string | null
  composer: string
  setComposer: Dispatch<SetStateAction<string>>
  availableSlashCommands?: SlashCommand[]
}

type ComposerAutocompleteMatch = {
  trigger: '/' | '@'
  query: string
  start: number
  end: number
}

const MAX_FILE_SUGGESTIONS = 500

function extractComposerAutocompleteMatch(value: string): ComposerAutocompleteMatch | null {
  const lineStart = value.lastIndexOf('\n') + 1
  const currentLine = value.slice(lineStart)
  if (currentLine.startsWith('/') && !currentLine.includes(' ')) {
    return {
      trigger: '/',
      query: currentLine.slice(1),
      start: lineStart,
      end: value.length,
    }
  }

  const mentionMatch = currentLine.match(/(?:^|\s)(@([^\s@]*))$/)
  if (!mentionMatch) {
    return null
  }
  const token = mentionMatch[1] ?? ''
  const query = mentionMatch[2] ?? ''
  return {
    trigger: '@',
    query,
    start: value.length - token.length,
    end: value.length,
  }
}

function filterAutocompleteItems(items: ComposerAutocompleteItem[], query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) {
    return items
  }
  return items.filter(item =>
    [item.name, item.description, item.meta]
      .filter((value): value is string => Boolean(value))
      .some(value => value.toLowerCase().includes(normalized))
  )
}

async function loadProviderSkills(provider: ComposerAutocompleteProvider): Promise<SkillEntry[]> {
  if (provider === 'opencode') {
    return window.orxa?.opencode?.listSkills ? window.orxa.opencode.listSkills() : []
  }
  const directory = PROVIDER_SKILL_ROOTS[provider]
  return window.orxa?.app?.listSkillsFromDir ? window.orxa.app.listSkillsFromDir(directory) : []
}

async function collectWorkspaceFiles(
  directory: string,
  relativePath = '',
  acc: ProjectFileEntry[] = []
): Promise<ProjectFileEntry[]> {
  if (!window.orxa?.opencode?.listFiles || acc.length >= MAX_FILE_SUGGESTIONS) {
    return acc
  }
  const entries = await window.orxa.opencode.listFiles(directory, relativePath)
  for (const entry of entries) {
    if (entry.type === 'file') {
      acc.push(entry)
      if (acc.length >= MAX_FILE_SUGGESTIONS) {
        break
      }
      continue
    }
    if (entry.type === 'directory' && entry.relativePath) {
      await collectWorkspaceFiles(directory, entry.relativePath, acc)
      if (acc.length >= MAX_FILE_SUGGESTIONS) {
        break
      }
    }
  }
  return acc
}

function buildSkillItems(skills: SkillEntry[]): ComposerAutocompleteItem[] {
  return skills.map(skill => ({
    id: `skill:${skill.id}`,
    name: skill.id,
    description: skill.description,
    meta: skill.name !== skill.id ? skill.name : skill.path,
    trigger: '/',
    kind: 'skill',
    insertText: `/${skill.id} `,
  }))
}

function buildCommandItems(commands: SlashCommand[]): ComposerAutocompleteItem[] {
  return commands.map(command => ({
    id: `command:${command.name}`,
    name: command.name,
    description: command.description,
    meta: command.meta,
    trigger: '/',
    kind: 'command',
    insertText: command.insertText ?? `/${command.name} `,
    onSelect: command.onSelect,
  }))
}

function buildFileItems(files: ProjectFileEntry[]): ComposerAutocompleteItem[] {
  return files.map(file => ({
    id: `file:${file.relativePath}`,
    name: file.relativePath,
    description: file.path,
    trigger: '@',
    kind: 'file',
    insertText: `@${file.relativePath} `,
  }))
}

function useAutocompleteMenuState(activeMatch: ComposerAutocompleteMatch | null) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    if (!activeMatch) {
      setMenuOpen(false)
      setSelectedIndex(0)
      return
    }
    setMenuOpen(true)
    setSelectedIndex(0)
  }, [activeMatch])

  return { menuOpen, selectedIndex, setMenuOpen, setSelectedIndex }
}

function useProviderSkills(
  activeMatch: ComposerAutocompleteMatch | null,
  provider: ComposerAutocompleteProvider
) {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const skillsLoadedRef = useRef<Record<ComposerAutocompleteProvider, boolean>>({
    opencode: false,
    codex: false,
    claude: false,
  })

  useEffect(() => {
    if (activeMatch?.trigger !== '/' || skillsLoadedRef.current[provider]) {
      return
    }
    let cancelled = false
    void loadProviderSkills(provider)
      .then(entries => {
        if (cancelled) {
          return
        }
        skillsLoadedRef.current[provider] = true
        setSkills(entries)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        skillsLoadedRef.current[provider] = true
        setSkills([])
      })
    return () => {
      cancelled = true
    }
  }, [activeMatch, provider])

  return skills
}

function useWorkspaceFiles(
  activeMatch: ComposerAutocompleteMatch | null,
  directory: string | null
) {
  const [files, setFiles] = useState<ProjectFileEntry[]>([])
  const filesLoadedRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    if (activeMatch?.trigger !== '@' || !directory || filesLoadedRef.current[directory]) {
      return
    }
    let cancelled = false
    void collectWorkspaceFiles(directory)
      .then(entries => {
        if (cancelled) {
          return
        }
        filesLoadedRef.current[directory] = true
        setFiles(entries)
      })
      .catch(() => {
        if (cancelled) {
          return
        }
        filesLoadedRef.current[directory] = true
        setFiles([])
      })
    return () => {
      cancelled = true
    }
  }, [activeMatch, directory])

  return files
}

export function useComposerAutocomplete({
  provider,
  directory,
  composer,
  setComposer,
  availableSlashCommands = [],
}: UseComposerAutocompleteArgs) {
  const activeMatch = useMemo(() => extractComposerAutocompleteMatch(composer), [composer])
  const { menuOpen, selectedIndex, setMenuOpen, setSelectedIndex } =
    useAutocompleteMenuState(activeMatch)
  const skills = useProviderSkills(activeMatch, provider)
  const files = useWorkspaceFiles(activeMatch, directory)

  const allItems = useMemo(() => {
    if (!activeMatch) {
      return []
    }
    if (activeMatch.trigger === '/') {
      return [...buildCommandItems(availableSlashCommands), ...buildSkillItems(skills)]
    }
    return buildFileItems(files)
  }, [activeMatch, availableSlashCommands, files, skills])

  const filteredItems = useMemo(() => {
    if (!activeMatch) {
      return []
    }
    return filterAutocompleteItems(allItems, activeMatch.query)
  }, [activeMatch, allItems])

  useEffect(() => {
    setSelectedIndex(current =>
      filteredItems.length === 0 ? 0 : Math.min(current, filteredItems.length - 1)
    )
  }, [filteredItems.length, setSelectedIndex])

  const closeMenu = useCallback(() => {
    setMenuOpen(false)
    setSelectedIndex(0)
  }, [setMenuOpen, setSelectedIndex])

  const insertItem = useCallback(
    (item: ComposerAutocompleteItem) => {
      if (!activeMatch) {
        return
      }
      if (item.onSelect) {
        const nextValue = composer.slice(0, activeMatch.start) + composer.slice(activeMatch.end)
        setComposer(nextValue)
        item.onSelect()
        closeMenu()
        return
      }
      const nextValue =
        composer.slice(0, activeMatch.start) + item.insertText + composer.slice(activeMatch.end)
      setComposer(nextValue)
      closeMenu()
    },
    [activeMatch, closeMenu, composer, setComposer]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!menuOpen) {
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelectedIndex(current =>
          filteredItems.length === 0 ? 0 : Math.min(current + 1, filteredItems.length - 1)
        )
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelectedIndex(current => Math.max(current - 1, 0))
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const item = filteredItems[selectedIndex]
        if (item) {
          insertItem(item)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
      }
    },
    [closeMenu, filteredItems, insertItem, menuOpen, selectedIndex, setSelectedIndex]
  )

  return {
    slashMenuOpen: menuOpen && filteredItems.length > 0,
    filteredSlashCommands: filteredItems,
    slashSelectedIndex: selectedIndex,
    handleComposerChange: setComposer,
    handleSlashKeyDown: handleKeyDown,
    insertSlashCommand: insertItem,
  }
}
