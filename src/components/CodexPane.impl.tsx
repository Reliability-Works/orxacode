import { CodexPaneView } from './CodexPane.view'
import type { CodexPaneProps } from './CodexPane.types'
import { useCodexPaneViewProps } from './useCodexPaneViewProps'

export function CodexPane(props: CodexPaneProps) {
  return <CodexPaneView {...useCodexPaneViewProps(props)} />
}
