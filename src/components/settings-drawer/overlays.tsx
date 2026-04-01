import type { BootstrapState, OpenCodeAgentsState } from './hooks'
import { OcAgentFilenameModal, RawConfigEditorModal } from './modals'

export function SettingsDrawerOverlays({
  openCodeAgents,
  editorOpen,
  editorText,
  setEditorText,
  bootstrap,
  onCloseEditor,
  onSaveEditor,
  onReloadEditor,
}: {
  openCodeAgents: OpenCodeAgentsState
  editorOpen: boolean
  editorText: string
  setEditorText: (value: string) => void
  bootstrap: BootstrapState
  onCloseEditor: () => void
  onSaveEditor: () => void
  onReloadEditor: () => void
}) {
  return (
    <>
      {openCodeAgents.ocFilenameDialog ? (
        <OcAgentFilenameModal
          dialog={openCodeAgents.ocFilenameDialog}
          value={openCodeAgents.ocFilenameValue}
          error={openCodeAgents.ocFilenameError}
          onClose={openCodeAgents.closeOcFilenameDialog}
          onChange={value => {
            openCodeAgents.setOcFilenameValue(value)
            if (openCodeAgents.ocFilenameError) {
              openCodeAgents.setOcFilenameError(null)
            }
          }}
          onSubmit={openCodeAgents.submitOcFilenameDialog}
        />
      ) : null}

      <RawConfigEditorModal
        open={editorOpen}
        rawDoc={bootstrap.rawDoc}
        editorText={editorText}
        onClose={onCloseEditor}
        onChange={setEditorText}
        onSave={onSaveEditor}
        onReload={onReloadEditor}
      />
    </>
  )
}
