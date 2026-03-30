export type TimelineKind =
  | 'read'
  | 'search'
  | 'list'
  | 'todo'
  | 'create'
  | 'edit'
  | 'delete'
  | 'git'
  | 'delegate'
  | 'run'

export type InternalEvent = {
  id: string
  summary: string
  details?: string
  actor?: string
  kind?: TimelineKind
  command?: string
  output?: string
  failure?: string
}

export type TimelineEvent = {
  id: string
  label: string
  kind: TimelineKind
  reason?: string
  command?: string
  output?: string
  failure?: string
}

export type TimelineBlock =
  | {
      id: string
      type: 'exploration'
      summary: string
      entries: TimelineEvent[]
    }
  | {
      id: string
      type: 'event'
      entry: TimelineEvent
    }

export type DelegationEventBlock =
  | {
      id: string
      type: 'exploration'
      summary: string
      entries: InternalEvent[]
    }
  | {
      id: string
      type: 'event'
      entry: InternalEvent
    }

export function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

function isExplorationKind(kind: TimelineKind) {
  return kind === 'read' || kind === 'search' || kind === 'list'
}

function summarizeExploration(entries: TimelineEvent[]) {
  const reads = entries.filter(entry => entry.kind === 'read').length
  const searches = entries.filter(entry => entry.kind === 'search' || entry.kind === 'list').length
  const parts: string[] = []
  if (reads > 0) {
    parts.push(pluralize(reads, 'file'))
  }
  if (searches > 0) {
    parts.push(pluralize(searches, 'search', 'searches'))
  }
  if (parts.length === 0) {
    parts.push(pluralize(entries.length, 'step'))
  }
  return `Explored ${parts.join(', ')}`
}

export function buildTimelineBlocks(events: TimelineEvent[]): TimelineBlock[] {
  const blocks: TimelineBlock[] = []
  let activeExploration: TimelineEvent[] = []

  const flushExploration = () => {
    if (activeExploration.length === 0) {
      return
    }
    blocks.push({
      id: `exploration:${activeExploration[0]?.id ?? blocks.length}`,
      type: 'exploration',
      summary: summarizeExploration(activeExploration),
      entries: activeExploration,
    })
    activeExploration = []
  }

  for (const entry of events) {
    if (isExplorationKind(entry.kind)) {
      activeExploration.push(entry)
      continue
    }
    flushExploration()
    blocks.push({ id: `event:${entry.id}`, type: 'event', entry })
  }
  flushExploration()
  return blocks
}

export function buildDelegationEventBlocks(events: InternalEvent[]): DelegationEventBlock[] {
  const blocks: DelegationEventBlock[] = []
  let activeExploration: InternalEvent[] = []

  const flushExploration = () => {
    if (activeExploration.length === 0) {
      return
    }
    const reads = activeExploration.filter(entry => entry.kind === 'read').length
    const searches = activeExploration.filter(
      entry => entry.kind === 'search' || entry.kind === 'list'
    ).length
    const parts: string[] = []
    if (reads > 0) {
      parts.push(pluralize(reads, 'file'))
    }
    if (searches > 0) {
      parts.push(pluralize(searches, 'search', 'searches'))
    }
    const summary = `Explored ${parts.length > 0 ? parts.join(', ') : pluralize(activeExploration.length, 'step')}`
    blocks.push({
      id: `exploration:${activeExploration[0]?.id ?? blocks.length}`,
      type: 'exploration',
      summary,
      entries: activeExploration,
    })
    activeExploration = []
  }

  for (const entry of events) {
    if (entry.kind && isExplorationKind(entry.kind)) {
      activeExploration.push(entry)
      continue
    }
    flushExploration()
    blocks.push({ id: `event:${entry.id}`, type: 'event', entry })
  }
  flushExploration()
  return blocks
}
