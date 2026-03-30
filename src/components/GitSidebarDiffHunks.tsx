import type { ReactNode } from 'react'
import type { GitDiffViewMode } from '../hooks/useGitPanel'
import type { ParsedHunk, ParsedHunkLine } from '../lib/git-diff'

type ExpandedRowsSetter = (updater: (current: Record<string, boolean>) => Record<string, boolean>) => void

function GitSidebarContextLine({
  line,
  split = false,
}: {
  line: ParsedHunkLine
  split?: boolean
}) {
  if (!split) {
    return (
      <div className="git-diff-row git-diff-row-context">
        <span className="git-diff-ln">{line.oldLine ?? ''}</span>
        <span className="git-diff-ln">{line.newLine ?? ''}</span>
        <span className="git-diff-code">{line.text}</span>
      </div>
    )
  }

  return (
    <div className="git-diff-split-row git-diff-split-context">
      <span className="git-diff-cell git-diff-cell-left">
        <span className="git-diff-ln">{line.newLine ?? ''}</span>
        <span className="git-diff-code">{line.text}</span>
      </span>
      <span className="git-diff-cell git-diff-cell-right">
        <span className="git-diff-ln">{line.newLine ?? ''}</span>
        <span className="git-diff-code">{line.text}</span>
      </span>
    </div>
  )
}

function renderCollapsedContextRows(
  run: ParsedHunkLine[],
  collapseKey: string,
  expanded: boolean,
  setExpandedUnchangedRows: ExpandedRowsSetter,
  split = false
) {
  const rows: ReactNode[] = []
  const visible = run.length > 10 && !expanded ? [...run.slice(0, 3), ...run.slice(-3)] : run

  visible.forEach((contextLine, contextIndex) => {
    if (run.length > 10 && !expanded && contextIndex === 3) {
      rows.push(
        <button
          key={`${collapseKey}:expand`}
          type="button"
          className={`git-diff-collapsed-lines${split ? ' split' : ''}`}
          onClick={() => setExpandedUnchangedRows(current => ({ ...current, [collapseKey]: true }))}
        >
          {run.length - 6} unmodified lines
        </button>
      )
    }
    rows.push(<GitSidebarContextLine key={contextLine.id} line={contextLine} split={split} />)
  })

  return rows
}

function renderSplitChangeRows(hunkKey: string, removed: ParsedHunkLine[], added: ParsedHunkLine[]) {
  const rows: ReactNode[] = []
  const maxRows = Math.max(removed.length, added.length)

  for (let rowIndex = 0; rowIndex < maxRows; rowIndex += 1) {
    const left = removed[rowIndex] ?? null
    const right = added[rowIndex] ?? null
    rows.push(
      <div
        key={`${hunkKey}:split:${rowIndex}:${left?.id ?? 'none'}:${right?.id ?? 'none'}`}
        className="git-diff-split-row"
      >
        <span className={`git-diff-cell git-diff-cell-left ${left ? 'git-diff-row-remove' : 'git-diff-row-empty'}`.trim()}>
          <span className="git-diff-ln">{left?.oldLine ?? ''}</span>
          <span className="git-diff-code">{left?.text ?? ''}</span>
        </span>
        <span className={`git-diff-cell git-diff-cell-right ${right ? 'git-diff-row-add' : 'git-diff-row-empty'}`.trim()}>
          <span className="git-diff-ln">{right?.newLine ?? ''}</span>
          <span className="git-diff-code">{right?.text ?? ''}</span>
        </span>
      </div>
    )
  }

  return rows
}

function GitSidebarUnifiedHunk({
  hunk,
  sectionKey,
  expandedUnchangedRows,
  setExpandedUnchangedRows,
}: {
  hunk: ParsedHunk
  sectionKey: string
  expandedUnchangedRows: Record<string, boolean>
  setExpandedUnchangedRows: ExpandedRowsSetter
}) {
  const rows: ReactNode[] = []
  let index = 0

  while (index < hunk.lines.length) {
    const line = hunk.lines[index]!
    if (line.type !== 'context') {
      rows.push(
        <div key={line.id} className={`git-diff-row git-diff-row-${line.type}`}>
          <span className="git-diff-ln">{line.oldLine ?? ''}</span>
          <span className="git-diff-ln">{line.newLine ?? ''}</span>
          <span className="git-diff-code">{line.text}</span>
        </div>
      )
      index += 1
      continue
    }

    const start = index
    while (index < hunk.lines.length && hunk.lines[index]!.type === 'context') {
      index += 1
    }
    const collapseKey = `${sectionKey}:${hunk.key}:${start}`
    rows.push(
      ...renderCollapsedContextRows(
        hunk.lines.slice(start, index),
        collapseKey,
        Boolean(expandedUnchangedRows[collapseKey]),
        setExpandedUnchangedRows
      )
    )
  }

  return <>{rows}</>
}

function GitSidebarSplitHunk({
  hunk,
  sectionKey,
  expandedUnchangedRows,
  setExpandedUnchangedRows,
}: {
  hunk: ParsedHunk
  sectionKey: string
  expandedUnchangedRows: Record<string, boolean>
  setExpandedUnchangedRows: ExpandedRowsSetter
}) {
  const rows: ReactNode[] = []
  let index = 0

  while (index < hunk.lines.length) {
    const line = hunk.lines[index]!
    if (line.type === 'context') {
      const start = index
      while (index < hunk.lines.length && hunk.lines[index]!.type === 'context') {
        index += 1
      }
      const collapseKey = `${sectionKey}:${hunk.key}:${start}`
      rows.push(
        ...renderCollapsedContextRows(
          hunk.lines.slice(start, index),
          collapseKey,
          Boolean(expandedUnchangedRows[collapseKey]),
          setExpandedUnchangedRows,
          true
        )
      )
      continue
    }

    const removed: ParsedHunkLine[] = []
    const added: ParsedHunkLine[] = []
    while (index < hunk.lines.length && hunk.lines[index]!.type === 'remove') {
      removed.push(hunk.lines[index]!)
      index += 1
    }
    while (index < hunk.lines.length && hunk.lines[index]!.type === 'add') {
      added.push(hunk.lines[index]!)
      index += 1
    }
    rows.push(...renderSplitChangeRows(hunk.key, removed, added))
  }

  return <>{rows}</>
}

export function GitSidebarHunkRows({
  hunks,
  sectionKey,
  gitDiffViewMode,
  expandedUnchangedRows,
  setExpandedUnchangedRows,
}: {
  hunks: ParsedHunk[]
  sectionKey: string
  gitDiffViewMode: GitDiffViewMode
  expandedUnchangedRows: Record<string, boolean>
  setExpandedUnchangedRows: ExpandedRowsSetter
}) {
  return (
    <div className="git-diff-rows-wrapper">
      {hunks.map((hunk, index) => (
        <div key={`${sectionKey}:${hunk.key}:${index}`}>
          {gitDiffViewMode === 'split' ? (
            <GitSidebarSplitHunk
              hunk={hunk}
              sectionKey={sectionKey}
              expandedUnchangedRows={expandedUnchangedRows}
              setExpandedUnchangedRows={setExpandedUnchangedRows}
            />
          ) : (
            <GitSidebarUnifiedHunk
              hunk={hunk}
              sectionKey={sectionKey}
              expandedUnchangedRows={expandedUnchangedRows}
              setExpandedUnchangedRows={setExpandedUnchangedRows}
            />
          )}
        </div>
      ))}
    </div>
  )
}
