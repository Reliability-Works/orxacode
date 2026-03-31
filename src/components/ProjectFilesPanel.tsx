import { ProjectFilesPanelView } from './ProjectFilesPanel.view'
import { useProjectFilePreview } from './useProjectFilePreview'
import { useProjectFilesTree } from './useProjectFilesTree'

type Props = {
  directory: string
  onAddToChatPath: (path: string) => void
  onStatus: (message: string) => void
}

export function ProjectFilesPanel({ directory, onStatus }: Props) {
  const tree = useProjectFilesTree({ directory, onStatus })
  const preview = useProjectFilePreview({ directory, onStatus })

  return (
    <ProjectFilesPanelView
      canEditPreview={preview.canEditPreview}
      collapseAll={tree.collapseAll}
      copiedField={preview.copiedField}
      editorRef={preview.editorRef}
      editorState={preview.editorState}
      entries={tree.filteredView.root}
      expanded={tree.expanded}
      expandAll={tree.expandAll}
      fileCountLabel={tree.fileCountLabel}
      isEditing={preview.isEditing}
      loading={tree.loading}
      onCaptureSelection={preview.captureSelection}
      onClosePreview={preview.closePreview}
      onCopyPath={preview.copyPreviewPath}
      onCopySelection={preview.copySelectionReference}
      onEditorContentChange={(content, dirty) =>
        preview.setEditorState(current => current ? { ...current, content, dirty } : current)
      }
      onOpenFile={preview.openFile}
      onSavePreview={() => void preview.savePreview()}
      onSearchChange={tree.setSearchQuery}
      onSelectionChange={selection => preview.setSelection(selection)}
      onUndoPreviewChanges={preview.undoPreviewChanges}
      preview={preview.preview}
      previewHtmlLines={preview.previewHtmlLines}
      previewLanguage={preview.previewLanguage}
      previewScrollerRef={preview.previewScrollerRef}
      renderLabel={tree.renderLabel}
      searchActive={tree.searchActive}
      searchLoading={tree.searchLoading}
      searchQuery={tree.searchQuery}
      selection={preview.selection}
      selectionPopoverRef={preview.selectionPopoverRef}
      setSelection={selection => preview.setSelection(selection)}
      toggleDirectory={tree.toggleDirectory}
      tree={tree.filteredView.nodes}
    />
  )
}
