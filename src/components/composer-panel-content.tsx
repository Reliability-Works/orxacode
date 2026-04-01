import { memo, type RefObject } from 'react'
import type { ComposerPanelProps } from './ComposerPanel.impl'
import { ComposerDockStack } from './composer-panel-dock-stack'
import { ComposerInputSection } from './composer-panel-input-section'
import { ComposerControlsSection } from './composer-panel-controls-section'

type ComposerPanelContentProps = ComposerPanelProps & {
  dockRef: RefObject<HTMLElement | null>
}

export const ComposerPanelContent = memo(function ComposerPanelContent(
  props: ComposerPanelContentProps
) {
  const { dockRef, ...panelProps } = props

  return (
    <section ref={dockRef} className="composer-zone">
      <ComposerDockStack {...panelProps} />
      <ComposerInputSection {...panelProps} />
      <ComposerControlsSection {...panelProps} />
    </section>
  )
})
