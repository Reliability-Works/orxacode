/**
 * Derives composer-specific state: menu items, model search options, shortcut labels.
 */

import { useMemo } from 'react'
import { useDebouncedValue } from '@tanstack/react-pacer'
import { useQuery } from '@tanstack/react-query'
import { gitBranchesQueryOptions } from '~/lib/gitReactQuery'
import { projectSearchEntriesQueryOptions } from '~/lib/projectReactQuery'
import { shortcutLabelForCommand } from '../../keybindings'
import { basenameOfPath } from '../../vscode-icons'
import { AVAILABLE_PROVIDER_OPTIONS } from './ProviderModelPicker'
import type { ComposerCommandItem } from './ComposerCommandMenu'
import type { useChatViewStoreSelectors } from './useChatViewStoreSelectors'
import type { useChatViewLocalState } from './useChatViewLocalState'
import type { useChatViewDerivedThread } from './useChatViewDerivedThread'
import { getSlashCommandsForProvider } from '../../composer-logic'
import type { ProjectEntry, ProviderKind } from '@orxa-code/contracts'
import { useProviderDiscoveryMenuData } from './useChatViewDerivedComposer.discovery'

const EMPTY_PROJECT_ENTRIES: ProjectEntry[] = []
const COMPOSER_PATH_QUERY_DEBOUNCE_MS = 120

type StoreSelectors = ReturnType<typeof useChatViewStoreSelectors>
type LocalState = ReturnType<typeof useChatViewLocalState>
type ThreadDerived = ReturnType<typeof useChatViewDerivedThread>

const ALL_SLASH_COMMAND_ITEMS = [
  {
    id: 'slash:model',
    type: 'slash-command' as const,
    command: 'model' as const,
    label: '/model',
    description: 'Switch response model for this thread',
  },
  {
    id: 'slash:plan',
    type: 'slash-command' as const,
    command: 'plan' as const,
    label: '/plan',
    description: 'Switch this thread into plan mode',
  },
  {
    id: 'slash:default',
    type: 'slash-command' as const,
    command: 'default' as const,
    label: '/default',
    description: 'Switch this thread back to normal chat mode',
  },
  {
    id: 'slash:handoff',
    type: 'slash-command' as const,
    command: 'handoff' as const,
    label: '/handoff',
    description: 'Hand off to another provider, for example `/handoff claude`',
  },
  {
    id: 'slash:fork',
    type: 'slash-command' as const,
    command: 'fork' as const,
    label: '/fork',
    description: 'Open the pull request worktree flow, optionally with a PR reference',
  },
  {
    id: 'slash:status',
    type: 'slash-command' as const,
    command: 'status' as const,
    label: '/status',
    description: 'Show the active provider status and latest rate-limit summary',
  },
] satisfies ReadonlyArray<Extract<ComposerCommandItem, { type: 'slash-command' }>>

function buildSlashCommandItems(provider: ProviderKind) {
  const allowed = getSlashCommandsForProvider(provider)
  return ALL_SLASH_COMMAND_ITEMS.filter(item => allowed.includes(item.command))
}

function useComposerPathAndQueries(
  gitCwd: string | null,
  composerTriggerKind: string | null,
  pathTriggerQuery: string
) {
  const isPathTrigger = composerTriggerKind === 'path'
  const [debouncedPathQuery, composerPathQueryDebouncer] = useDebouncedValue(
    pathTriggerQuery,
    { wait: COMPOSER_PATH_QUERY_DEBOUNCE_MS },
    s => ({ isPending: s.isPending })
  )
  const effectivePathQuery = pathTriggerQuery.length > 0 ? debouncedPathQuery : ''
  const branchesQuery = useQuery(gitBranchesQueryOptions(gitCwd))
  const workspaceEntriesQuery = useQuery(
    projectSearchEntriesQueryOptions({
      cwd: gitCwd,
      query: effectivePathQuery,
      enabled: isPathTrigger,
      limit: 80,
    })
  )
  const workspaceEntries = workspaceEntriesQuery.data?.entries ?? EMPTY_PROJECT_ENTRIES
  const isGitRepo = branchesQuery.data?.isRepo ?? true
  return {
    isPathTrigger,
    debouncedPathQuery,
    composerPathQueryDebouncer,
    branchesQuery,
    workspaceEntriesQuery,
    workspaceEntries,
    isGitRepo,
  }
}

type SearchableModelOption = {
  provider: ProviderKind
  providerLabel: string
  slug: string
  name: string
  searchSlug: string
  searchName: string
  searchProvider: string
}

function buildModelCommandItems(
  options: readonly SearchableModelOption[],
  query: string
): ComposerCommandItem[] {
  return options
    .filter(({ searchSlug, searchName, searchProvider }) => {
      const q = query.trim().toLowerCase()
      return !q || searchSlug.includes(q) || searchName.includes(q) || searchProvider.includes(q)
    })
    .map(({ provider, providerLabel, slug, name }) => ({
      id: `model:${provider}:${slug}`,
      type: 'model' as const,
      provider,
      model: slug,
      label: name,
      description: `${providerLabel} · ${slug}`,
    }))
}

function buildPathCommandItems(entries: readonly ProjectEntry[]): ComposerCommandItem[] {
  return entries.map(e => ({
    id: `path:${e.kind}:${e.path}`,
    type: 'path' as const,
    path: e.path,
    pathKind: e.kind,
    label: basenameOfPath(e.path),
    description: e.parentPath ?? '',
  }))
}

function useComposerMenuItems(params: {
  composerTrigger: LocalState['composerTrigger']
  workspaceEntries: readonly ProjectEntry[]
  lockedProvider: ThreadDerived['lockedProvider']
  selectedProvider: ProviderKind
  modelOptionsByProvider: ThreadDerived['modelOptionsByProvider']
  composerHighlightedItemId: string | null
  nativeSlashCommandItems: ReadonlyArray<Extract<ComposerCommandItem, { type: 'native-slash-command' }>>
  skillItems: ReadonlyArray<Extract<ComposerCommandItem, { type: 'skill' }>>
}) {
  const { composerTrigger, workspaceEntries, lockedProvider, selectedProvider } = params
  const { modelOptionsByProvider, composerHighlightedItemId } = params
  const searchableModelOptions = useMemo<SearchableModelOption[]>(
    () =>
      AVAILABLE_PROVIDER_OPTIONS.filter(
        o => lockedProvider === null || o.value === lockedProvider
      ).flatMap(o =>
        modelOptionsByProvider[o.value].map(({ slug, name }) => ({
          provider: o.value,
          providerLabel: o.label,
          slug,
          name,
          searchSlug: slug.toLowerCase(),
          searchName: name.toLowerCase(),
          searchProvider: o.label.toLowerCase(),
        }))
      ),
    [lockedProvider, modelOptionsByProvider]
  )
  const composerMenuItems = useMemo<ComposerCommandItem[]>(() => {
    if (!composerTrigger) return []
    if (composerTrigger.kind === 'path') {
      const items = [...buildPathCommandItems(workspaceEntries)]
      if (params.skillItems.length > 0) {
        items.push(...params.skillItems)
      }
      return items
    }
    if (composerTrigger.kind === 'slash-command') {
      const items = [
        ...buildSlashCommandItems(selectedProvider),
        ...params.nativeSlashCommandItems,
      ]
      const query = composerTrigger.query.trim().toLowerCase()
      if (!query) return [...items]
      return items.filter(
        item =>
          item.command.includes(query) ||
          item.label.slice(1).includes(query) ||
          item.description.toLowerCase().includes(query)
      )
    }
    return buildModelCommandItems(searchableModelOptions, composerTrigger.query)
  }, [
    composerTrigger,
    params.nativeSlashCommandItems,
    params.skillItems,
    searchableModelOptions,
    selectedProvider,
    workspaceEntries,
  ])
  const composerMenuOpen = Boolean(composerTrigger)
  const activeComposerMenuItem = useMemo(
    () =>
      composerMenuItems.find(item => item.id === composerHighlightedItemId) ??
      composerMenuItems[0] ??
      null,
    [composerHighlightedItemId, composerMenuItems]
  )
  return { searchableModelOptions, composerMenuItems, composerMenuOpen, activeComposerMenuItem }
}

function useShortcutLabels(keybindings: StoreSelectors['keybindings'], terminalOpen: boolean) {
  const terminalShortcutOpts = useMemo(
    () => ({ context: { terminalFocus: true, terminalOpen } }),
    [terminalOpen]
  )
  const nonTerminalShortcutOpts = useMemo(
    () => ({ context: { terminalFocus: false, terminalOpen } }),
    [terminalOpen]
  )
  const terminalToggleShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, 'terminal.toggle'),
    [keybindings]
  )
  const splitTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, 'terminal.split', terminalShortcutOpts),
    [keybindings, terminalShortcutOpts]
  )
  const newTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, 'terminal.new', terminalShortcutOpts),
    [keybindings, terminalShortcutOpts]
  )
  const closeTerminalShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, 'terminal.close', terminalShortcutOpts),
    [keybindings, terminalShortcutOpts]
  )
  const diffPanelShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, 'diff.toggle', nonTerminalShortcutOpts),
    [keybindings, nonTerminalShortcutOpts]
  )
  return {
    terminalToggleShortcutLabel,
    splitTerminalShortcutLabel,
    newTerminalShortcutLabel,
    closeTerminalShortcutLabel,
    diffPanelShortcutLabel,
  }
}

export function useChatViewDerivedComposer(
  store: StoreSelectors,
  ls: LocalState,
  td: ThreadDerived,
  gitCwd: string | null
) {
  const { keybindings, terminalState } = store
  const { composerTrigger, composerHighlightedItemId } = ls
  const { lockedProvider, selectedProvider, modelOptionsByProvider } = td
  const composerTriggerKind = composerTrigger?.kind ?? null
  const pathTriggerQuery = composerTrigger?.kind === 'path' ? composerTrigger.query : ''
  const pathAndQueries = useComposerPathAndQueries(gitCwd, composerTriggerKind, pathTriggerQuery)
  const discovery = useProviderDiscoveryMenuData({
    provider: selectedProvider,
    pathTriggerQuery,
  })
  const menu = useComposerMenuItems({
    composerTrigger,
    workspaceEntries: pathAndQueries.workspaceEntries,
    lockedProvider,
    selectedProvider,
    modelOptionsByProvider,
    composerHighlightedItemId,
    nativeSlashCommandItems: discovery.nativeSlashCommandItems,
    skillItems: discovery.skillItems,
  })
  const isComposerMenuLoading =
    (composerTriggerKind === 'path' &&
      ((pathTriggerQuery.length > 0 && pathAndQueries.composerPathQueryDebouncer.state.isPending) ||
        pathAndQueries.workspaceEntriesQuery.isLoading ||
        pathAndQueries.workspaceEntriesQuery.isFetching ||
        discovery.skillsQuery.isLoading ||
        discovery.skillsQuery.isFetching)) ||
    (composerTriggerKind === 'slash-command' &&
      ((discovery.nativeCommandsQuery.isLoading || discovery.nativeCommandsQuery.isFetching)))
  const shortcutLabels = useShortcutLabels(keybindings, Boolean(terminalState.terminalOpen))
  const nonPersistedComposerImageIdSet = useMemo(
    () => new Set(store.nonPersistedComposerImageIds),
    [store.nonPersistedComposerImageIds]
  )

  return {
    composerTriggerKind,
    pathTriggerQuery,
    ...pathAndQueries,
    composerCapabilities: discovery.composerCapabilities,
    nativeCommandsQuery: discovery.nativeCommandsQuery,
    skillsQuery: discovery.skillsQuery,
    ...menu,
    isComposerMenuLoading,
    ...shortcutLabels,
    nonPersistedComposerImageIdSet,
  }
}
