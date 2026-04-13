import { memo, type ReactNode } from 'react'

import { TerminalContextInlineChip } from './TerminalContextInlineChip'
import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from './userMessageTerminalContexts'
import { type ParsedTerminalContextEntry } from '~/lib/terminalContext'

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />
  }
)

function EmbeddedTerminalContextText(props: {
  text: string
  terminalContexts: ParsedTerminalContextEntry[]
}) {
  let cursor = 0
  const inlineNodes: ReactNode[] = []

  for (const context of props.terminalContexts) {
    const label = formatInlineTerminalContextLabel(context.header)
    const matchIndex = props.text.indexOf(label, cursor)
    if (matchIndex === -1) {
      return null
    }
    if (matchIndex > cursor) {
      inlineNodes.push(
        <span key={`user-terminal-context-inline-before:${context.header}:${cursor}`}>
          {props.text.slice(cursor, matchIndex)}
        </span>
      )
    }
    inlineNodes.push(
      <UserMessageTerminalContextInlineLabel
        key={`user-terminal-context-inline:${context.header}`}
        context={context}
      />
    )
    cursor = matchIndex + label.length
  }

  if (cursor < props.text.length) {
    inlineNodes.push(
      <span key={`user-message-terminal-context-inline-rest:${cursor}`}>
        {props.text.slice(cursor)}
      </span>
    )
  }

  return inlineNodes.length > 0 ? (
    <div className="wrap-break-word whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
      {inlineNodes}
    </div>
  ) : null
}

function PrefixedTerminalContextText(props: {
  text: string
  terminalContexts: ParsedTerminalContextEntry[]
}) {
  const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts)
  const inlineNodes: ReactNode[] = []

  for (const context of props.terminalContexts) {
    inlineNodes.push(
      <UserMessageTerminalContextInlineLabel
        key={`user-terminal-context-inline:${context.header}`}
        context={context}
      />
    )
    inlineNodes.push(
      <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
        {' '}
      </span>
    )
  }

  if (props.text.length > 0) {
    inlineNodes.push(<span key="user-message-terminal-context-inline-text">{props.text}</span>)
  } else if (inlinePrefix.length === 0) {
    return null
  }

  return (
    <div className="wrap-break-word whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
      {inlineNodes}
    </div>
  )
}

export const UserMessageBody = memo(function UserMessageBody(props: {
  text: string
  terminalContexts: ParsedTerminalContextEntry[]
}) {
  if (props.terminalContexts.length > 0) {
    if (textContainsInlineTerminalContextLabels(props.text, props.terminalContexts)) {
      const embedded = (
        <EmbeddedTerminalContextText text={props.text} terminalContexts={props.terminalContexts} />
      )
      if (embedded) return embedded
    }
    return (
      <PrefixedTerminalContextText text={props.text} terminalContexts={props.terminalContexts} />
    )
  }

  if (props.text.length === 0) {
    return null
  }

  return (
    <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground/80">
      {props.text}
    </div>
  )
})
