import { FileDiff } from '@pierre/diffs/react'
import { type CSSProperties, useMemo } from 'react'

import { useTheme } from '~/hooks/useTheme'
import { resolveDiffThemeName } from '../../lib/diffRendering'
import { findChangedFileDiff } from './ChangedFilesInlineDiff.logic'

export function ToolCallInlineDiff(props: { patchText: string; filePath: string }) {
  const { resolvedTheme } = useTheme()
  const fileDiff = useMemo(
    () => findChangedFileDiff(props.patchText, props.filePath, 'tool-call-inline'),
    [props.patchText, props.filePath]
  )

  if (!fileDiff) {
    return (
      <div className="mt-1 rounded-md border border-border/50 bg-background px-2 py-1 text-[11px] text-muted-foreground/70">
        Diff unavailable.
      </div>
    )
  }

  return (
    <div
      className="mt-1 overflow-hidden rounded-md border border-border/50 bg-background"
      style={
        {
          '--diffs-font-size': '11px',
          '--diffs-line-height': '16px',
        } as CSSProperties
      }
    >
      <FileDiff
        fileDiff={fileDiff}
        options={{
          diffStyle: 'unified',
          lineDiffType: 'none',
          overflow: 'scroll',
          disableFileHeader: true,
          theme: resolveDiffThemeName(resolvedTheme),
          themeType: resolvedTheme,
        }}
      />
    </div>
  )
}
