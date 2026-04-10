import {
  FolderTreeIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { cn } from '~/lib/utils'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { useFilesSidebarEditor } from './useFilesSidebarEditor'
import { FilesEditor } from './FilesEditor'
import { FilesSidebarTreePane } from './FilesSidebarTree'
import { Button } from '../ui/button'

function FilesSidebarHeader(props: {
  isMobile: boolean
  isRefreshing: boolean
  treeCollapsed: boolean
  onRefresh: () => void
  onToggleTree: () => void
  onClose: () => void
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3">
      <FolderTreeIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-xs font-medium text-foreground">Files</span>
      <div className="ms-auto flex items-center gap-0.5">
        {props.isMobile ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={props.onToggleTree}
            aria-label={props.treeCollapsed ? 'Show file tree' : 'Hide file tree'}
            className="h-6 w-6 p-0"
          >
            {props.treeCollapsed ? (
              <PanelLeftOpenIcon className="size-3.5" />
            ) : (
              <PanelLeftCloseIcon className="size-3.5" />
            )}
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          onClick={props.onRefresh}
          disabled={props.isRefreshing}
          aria-label="Refresh files sidebar"
          className="h-6 w-6 p-0"
        >
          <RefreshCwIcon className={cn('size-3', props.isRefreshing && 'animate-spin')} />
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={props.onClose}
          aria-label="Close files sidebar"
          className="h-6 w-6 p-0"
        >
          <XIcon className="size-3" />
        </Button>
      </div>
    </div>
  )
}

export interface FilesSidebarProps {
  cwd: string
  onClose: () => void
  onInsertPath: (path: string) => void
}

export function FilesSidebar({ cwd, onClose, onInsertPath }: FilesSidebarProps): ReactNode {
  const isMobile = useIsMobile()
  const [treeCollapsed, setTreeCollapsed] = useState(false)
  const editor = useFilesSidebarEditor({ cwd, onClose })

  return (
    <div className="flex h-full w-full min-w-0 shrink-0 flex-col overflow-hidden border-l border-border bg-background">
      <FilesSidebarHeader
        isMobile={isMobile}
        isRefreshing={editor.isRefreshing}
        treeCollapsed={treeCollapsed}
        onRefresh={editor.handleRefresh}
        onToggleTree={() => setTreeCollapsed(current => !current)}
        onClose={editor.handleClose}
      />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {!treeCollapsed ? (
          <FilesSidebarTreePane
            cwd={cwd}
            selectedFilePath={editor.selectedFilePath}
            onOpenFile={editor.handleOpenFile}
            onInsertPath={onInsertPath}
          />
        ) : null}
        <div className="min-h-0 min-w-0 flex-1">
          <FilesEditor
            cwd={cwd}
            filePath={editor.selectedFilePath}
            contents={editor.contents}
            isDirty={editor.isDirty}
            isLoading={editor.isLoading}
            isSaving={editor.isSaving}
            errorMessage={editor.errorMessage}
            onChange={editor.handleChange}
            onSave={editor.handleSave}
          />
        </div>
      </div>
    </div>
  )
}
