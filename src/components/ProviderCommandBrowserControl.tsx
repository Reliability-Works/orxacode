import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Command, Search, X } from 'lucide-react'
import {
  getProviderCommandCatalog,
  type ProviderCommandCategory,
  type ProviderCommandEntry,
  type ProviderCommandProvider,
} from '../lib/provider-command-catalog'

type ProviderCommandBrowserControlProps = {
  provider: ProviderCommandProvider
}

const CATEGORY_LABELS: Record<ProviderCommandCategory, string> = {
  session: 'Session',
  context: 'Context',
  model: 'Model',
  review: 'Review',
  integrations: 'Integrations',
  project: 'Project',
}

const STATUS_LABELS = {
  mapped: 'in Orxa',
  planned: 'planned',
  reference: 'reference',
} as const

function groupProviderCommands(commands: ProviderCommandEntry[]) {
  const groups = new Map<ProviderCommandCategory, ProviderCommandEntry[]>()
  for (const command of commands) {
    const group = groups.get(command.category)
    if (group) {
      group.push(command)
      continue
    }
    groups.set(command.category, [command])
  }
  return [...groups.entries()]
}

export function ProviderCommandBrowserControl({
  provider,
}: ProviderCommandBrowserControlProps) {
  const [open, setOpen] = useState(false)
  const catalog = useMemo(() => getProviderCommandCatalog(provider), [provider])
  const ariaLabel =
    provider === 'claude' ? 'Open Claude native commands' : 'Open Codex native commands'

  return (
    <>
      <button
        type="button"
        className="composer-mode-toggle-icon"
        aria-label={ariaLabel}
        title={catalog.title}
        onClick={() => setOpen(true)}
      >
        <Command size={11} aria-hidden="true" />
        <span className="composer-pill-label">commands</span>
      </button>
      <ProviderCommandBrowserModal catalog={catalog} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function ProviderCommandBrowserModal({
  catalog,
  open,
  onClose,
}: {
  catalog: ReturnType<typeof getProviderCommandCatalog>
  open: boolean
  onClose: () => void
}) {
  const [search, setSearch] = useState('')

  const filteredCommands = useMemo(() => {
    const normalized = search.trim().toLowerCase()
    if (!normalized) {
      return catalog.commands
    }
    return catalog.commands.filter(command =>
      [command.name, command.description, command.orxaEquivalent, CATEGORY_LABELS[command.category]]
        .filter((value): value is string => Boolean(value))
        .some(value => value.toLowerCase().includes(normalized))
    )
  }, [catalog.commands, search])
  const groupedCommands = useMemo(() => groupProviderCommands(filteredCommands), [filteredCommands])

  if (!open) {
    return null
  }

  return createPortal(
    <div className="overlay overlay--session-list" onClick={onClose}>
      <div
        className="modal claude-session-browser-modal provider-command-browser-modal"
        onClick={event => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>{catalog.title.toLowerCase()}</h2>
            <small>{catalog.subtitle}</small>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close native commands browser">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="workspace-detail-modal-body workspace-detail-modal-body--stacked">
          <ProviderCommandBrowserSearch
            note={catalog.note}
            provider={catalog.provider}
            search={search}
            setSearch={setSearch}
            source={catalog.source}
          />

          {groupedCommands.length === 0 ? (
            <section className="workspace-detail-section">
              <p className="workspace-detail-empty">No commands match that search.</p>
            </section>
          ) : null}

          {groupedCommands.map(([category, commands]) => (
            <ProviderCommandSection key={category} category={category} commands={commands} />
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}

function ProviderCommandBrowserSearch({
  note,
  provider,
  search,
  setSearch,
  source,
}: {
  note: string
  provider: ProviderCommandProvider
  search: string
  setSearch: (value: string) => void
  source: string
}) {
  return (
    <section className="workspace-detail-section">
      <p className="provider-command-browser-note">{note}</p>
      <div className="provider-command-browser-search">
        <label className="provider-command-browser-search-input">
          <Search size={13} aria-hidden="true" />
          <input
            type="text"
            value={search}
            placeholder={`Search ${provider} commands`}
            onChange={event => setSearch(event.target.value)}
          />
        </label>
        <div className="provider-command-browser-source-wrap">
          <span className="provider-command-browser-source-label">Source</span>
          <span className="provider-command-browser-source">{source}</span>
        </div>
      </div>
    </section>
  )
}

function ProviderCommandSection({
  category,
  commands,
}: {
  category: ProviderCommandCategory
  commands: ProviderCommandEntry[]
}) {
  return (
    <section className="workspace-detail-section">
      <div className="workspace-detail-section-header">
        <h3>{CATEGORY_LABELS[category]}</h3>
      </div>
      <div className="claude-session-browser-list provider-command-browser-list">
        {commands.map(command => (
          <article key={command.name} className="provider-command-browser-row">
            <div className="provider-command-browser-row-header">
              <div className="provider-command-browser-command">
                <span className="provider-command-browser-command-name">/{command.name}</span>
                <span
                  className={`provider-command-browser-status provider-command-browser-status--${command.status}`.trim()}
                >
                  {STATUS_LABELS[command.status]}
                </span>
              </div>
            </div>
            <span className="provider-command-browser-description">{command.description}</span>
            {command.orxaEquivalent ? (
              <span className="provider-command-browser-equivalent">
                In Orxa: {command.orxaEquivalent}
              </span>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
