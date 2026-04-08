import { memo, useState, useId } from 'react'
import {
  buildCollapsedProposedPlanPreviewMarkdown,
  buildProposedPlanMarkdownFilename,
  downloadPlanAsTextFile,
  normalizePlanMarkdownForExport,
  proposedPlanTitle,
  stripDisplayedPlanMarkdown,
} from '../../proposedPlan'
import ChatMarkdown from '../ChatMarkdown'
import { EllipsisIcon } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Menu, MenuItem, MenuPopup, MenuTrigger } from '../ui/menu'
import { cn } from '~/lib/utils'
import { Badge } from '../ui/badge'
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '../ui/dialog'
import { toastManager } from '../ui/toastState'
import { readNativeApi } from '~/nativeApi'

function ProposedPlanActionsMenu(props: {
  workspaceRoot: string | undefined
  isSavingToWorkspace: boolean
  onDownload: () => void
  onOpenSaveDialog: () => void
}) {
  const { workspaceRoot, isSavingToWorkspace, onDownload, onOpenSaveDialog } = props
  return (
    <Menu>
      <MenuTrigger render={<Button aria-label="Plan actions" size="icon-xs" variant="outline" />}>
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem onClick={onDownload}>Download as markdown</MenuItem>
        <MenuItem onClick={onOpenSaveDialog} disabled={!workspaceRoot || isSavingToWorkspace}>
          Save to workspace
        </MenuItem>
      </MenuPopup>
    </Menu>
  )
}

function ProposedPlanMarkdownBody(props: {
  canCollapse: boolean
  expanded: boolean
  collapsedPreview: string | null
  displayedPlanMarkdown: string
  cwd: string | undefined
  onToggleExpanded: () => void
}) {
  const { canCollapse, expanded, collapsedPreview, displayedPlanMarkdown, cwd, onToggleExpanded } =
    props
  return (
    <div className="mt-4">
      <div className={cn('relative', canCollapse && !expanded && 'max-h-104 overflow-hidden')}>
        {canCollapse && !expanded ? (
          <ChatMarkdown text={collapsedPreview ?? ''} cwd={cwd} isStreaming={false} />
        ) : (
          <ChatMarkdown text={displayedPlanMarkdown} cwd={cwd} isStreaming={false} />
        )}
        {canCollapse && !expanded ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-card/95 via-card/80 to-transparent" />
        ) : null}
      </div>
      {canCollapse ? (
        <div className="mt-4 flex justify-center">
          <Button size="sm" variant="outline" data-scroll-anchor-ignore onClick={onToggleExpanded}>
            {expanded ? 'Collapse plan' : 'Expand plan'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function ProposedPlanSaveDialog(props: {
  open: boolean
  workspaceRoot: string | undefined
  savePathInputId: string
  savePath: string
  downloadFilename: string
  isSavingToWorkspace: boolean
  onOpenChange: (open: boolean) => void
  onSavePathChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
}) {
  const {
    open,
    workspaceRoot,
    savePathInputId,
    savePath,
    downloadFilename,
    isSavingToWorkspace,
    onOpenChange,
    onSavePathChange,
    onCancel,
    onSave,
  } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Save plan to workspace</DialogTitle>
          <DialogDescription>
            Enter a path relative to <code>{workspaceRoot ?? 'the workspace'}</code>.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <label htmlFor={savePathInputId} className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Workspace path</span>
            <Input
              id={savePathInputId}
              value={savePath}
              onChange={event => onSavePathChange(event.target.value)}
              placeholder={downloadFilename}
              spellCheck={false}
              disabled={isSavingToWorkspace}
            />
          </label>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={isSavingToWorkspace}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void onSave()} disabled={isSavingToWorkspace}>
            {isSavingToWorkspace ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

function savePlanToWorkspace(props: {
  workspaceRoot: string
  relativePath: string
  saveContents: string
  onSaved: (relativePath: string) => void
  onFinished: () => void
}) {
  const { workspaceRoot, relativePath, saveContents, onSaved, onFinished } = props
  const api = readNativeApi()
  if (!api) {
    return
  }

  void api.projects
    .writeFile({
      cwd: workspaceRoot,
      relativePath,
      contents: saveContents,
    })
    .then(result => {
      onSaved(result.relativePath)
    })
    .catch(error => {
      toastManager.add({
        type: 'error',
        title: 'Could not save plan',
        description: error instanceof Error ? error.message : 'An error occurred while saving.',
      })
    })
    .then(onFinished, onFinished)
}

function useProposedPlanSaveState(props: {
  workspaceRoot: string | undefined
  downloadFilename: string
  saveContents: string
}) {
  const { workspaceRoot, downloadFilename, saveContents } = props
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false)
  const [savePath, setSavePath] = useState('')
  const [isSavingToWorkspace, setIsSavingToWorkspace] = useState(false)

  const handleDownload = () => {
    downloadPlanAsTextFile(downloadFilename, saveContents)
  }

  const openSaveDialog = () => {
    if (!workspaceRoot) {
      toastManager.add({
        type: 'error',
        title: 'Workspace path is unavailable',
        description: 'This thread does not have a workspace path to save into.',
      })
      return
    }
    setSavePath(existing => (existing.length > 0 ? existing : downloadFilename))
    setIsSaveDialogOpen(true)
  }

  const handleSaveToWorkspace = () => {
    const relativePath = savePath.trim()
    if (!workspaceRoot) {
      return
    }
    if (!relativePath) {
      toastManager.add({
        type: 'warning',
        title: 'Enter a workspace path',
      })
      return
    }

    setIsSavingToWorkspace(true)
    savePlanToWorkspace({
      workspaceRoot,
      relativePath,
      saveContents,
      onSaved: savedPath => {
        setIsSaveDialogOpen(false)
        toastManager.add({
          type: 'success',
          title: 'Plan saved to workspace',
          description: savedPath,
        })
      },
      onFinished: () => {
        setIsSavingToWorkspace(false)
      },
    })
  }

  return {
    isSaveDialogOpen,
    setIsSaveDialogOpen,
    savePath,
    setSavePath,
    isSavingToWorkspace,
    handleDownload,
    openSaveDialog,
    handleSaveToWorkspace,
  }
}

export const ProposedPlanCard = memo(function ProposedPlanCard({
  planMarkdown,
  cwd,
  workspaceRoot,
}: {
  planMarkdown: string
  cwd: string | undefined
  workspaceRoot: string | undefined
}) {
  const [expanded, setExpanded] = useState(false)
  const savePathInputId = useId()
  const title = proposedPlanTitle(planMarkdown) ?? 'Proposed plan'
  const lineCount = planMarkdown.split('\n').length
  const canCollapse = planMarkdown.length > 900 || lineCount > 20
  const displayedPlanMarkdown = stripDisplayedPlanMarkdown(planMarkdown)
  const collapsedPreview = canCollapse
    ? buildCollapsedProposedPlanPreviewMarkdown(planMarkdown, { maxLines: 10 })
    : null
  const downloadFilename = buildProposedPlanMarkdownFilename(planMarkdown)
  const saveContents = normalizePlanMarkdownForExport(planMarkdown)
  const {
    isSaveDialogOpen,
    setIsSaveDialogOpen,
    savePath,
    setSavePath,
    isSavingToWorkspace,
    handleDownload,
    openSaveDialog,
    handleSaveToWorkspace,
  } = useProposedPlanSaveState({
    workspaceRoot,
    downloadFilename,
    saveContents,
  })

  return (
    <div className="rounded-[24px] border border-border/80 bg-card/70 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant="secondary">Plan</Badge>
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
        </div>
        <ProposedPlanActionsMenu
          workspaceRoot={workspaceRoot}
          isSavingToWorkspace={isSavingToWorkspace}
          onDownload={handleDownload}
          onOpenSaveDialog={openSaveDialog}
        />
      </div>
      <ProposedPlanMarkdownBody
        canCollapse={canCollapse}
        expanded={expanded}
        collapsedPreview={collapsedPreview}
        displayedPlanMarkdown={displayedPlanMarkdown}
        cwd={cwd}
        onToggleExpanded={() => setExpanded(value => !value)}
      />

      <ProposedPlanSaveDialog
        open={isSaveDialogOpen}
        workspaceRoot={workspaceRoot}
        savePathInputId={savePathInputId}
        savePath={savePath}
        downloadFilename={downloadFilename}
        isSavingToWorkspace={isSavingToWorkspace}
        onOpenChange={open => {
          if (!isSavingToWorkspace) {
            setIsSaveDialogOpen(open)
          }
        }}
        onSavePathChange={setSavePath}
        onCancel={() => setIsSaveDialogOpen(false)}
        onSave={handleSaveToWorkspace}
      />
    </div>
  )
})
