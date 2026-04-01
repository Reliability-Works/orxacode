import type { ComposerPanelProps } from './ComposerPanel.impl'
import { ComposerPanelContent } from './composer-panel-content'
import { useComposerPanelHeight } from './composer/useComposerPanelHeight'
import { useRef } from 'react'

export function ComposerPanelSurface(props: ComposerPanelProps) {
  const composerZoneRef = useRef<HTMLElement | null>(null)
  useComposerPanelHeight(composerZoneRef, props.onLayoutHeightChange)
  return <ComposerPanelContent {...props} dockRef={composerZoneRef} />
}
