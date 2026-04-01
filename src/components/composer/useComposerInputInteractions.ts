import { useCallback, useState, type ClipboardEvent as ReactClipboardEvent, type DragEvent as ReactDragEvent } from 'react'
import type { Attachment } from '../../hooks/useComposerState'
import { IMAGE_FILENAME_FALLBACK, fileToDataUrl } from '../composer-panel-utils'
import { useAttachmentPreview } from './useAttachmentPreview'
import { useComposerResize } from './useComposerResize'

type UseComposerInputInteractionsOptions = {
  addComposerAttachments: (attachments: Attachment[]) => void
}

export function useComposerInputInteractions({
  addComposerAttachments,
}: UseComposerInputInteractionsOptions) {
  const [isDragOver, setIsDragOver] = useState(false)
  const { composerHeight, composerResizeActive, startComposerResize } = useComposerResize({
    minHeight: 96,
    maxHeight: 360,
    defaultHeight: 118,
  })
  const { previewAttachment, setPreviewAttachment, clearPreviewAttachment } =
    useAttachmentPreview<Attachment>()

  const handlePaste = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
      const items = Array.from(event.clipboardData?.items ?? [])
      const imageFiles = items
        .filter(item => item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((item): item is File => Boolean(item))
      if (imageFiles.length === 0) {
        return
      }
      event.preventDefault()
      void (async () => {
        const timestamp = Date.now()
        const attachments = await Promise.all(
          imageFiles.map(async (file, index) => {
            const dataUrl = await fileToDataUrl(file)
            const filename = file.name?.trim() || `pasted-image-${timestamp}-${index + 1}.png`
            return {
              url: dataUrl,
              filename: filename || IMAGE_FILENAME_FALLBACK,
              mime: file.type || 'image/png',
              path: `clipboard://${filename || IMAGE_FILENAME_FALLBACK}`,
            } satisfies Attachment
          })
        )
        addComposerAttachments(attachments)
      })().catch(() => undefined)
    },
    [addComposerAttachments]
  )

  const handleDragOver = useCallback((event: ReactDragEvent) => {
    const hasFiles = event.dataTransfer.types.includes('Files')
    if (hasFiles) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setIsDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((event: ReactDragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (event: ReactDragEvent) => {
      event.preventDefault()
      setIsDragOver(false)
      const files = Array.from(event.dataTransfer.files).filter(file =>
        file.type.startsWith('image/')
      )
      if (files.length === 0) return
      void (async () => {
        const timestamp = Date.now()
        const attachments = await Promise.all(
          files.map(async (file, index) => {
            const dataUrl = await fileToDataUrl(file)
            const filename = file.name?.trim() || `dropped-image-${timestamp}-${index + 1}.png`
            return {
              url: dataUrl,
              filename: filename || IMAGE_FILENAME_FALLBACK,
              mime: file.type || 'image/png',
              path:
                (file as File & { path?: string }).path ||
                `drop://${filename || IMAGE_FILENAME_FALLBACK}`,
            } satisfies Attachment
          })
        )
        addComposerAttachments(attachments)
      })().catch(() => undefined)
    },
    [addComposerAttachments]
  )

  return {
    clearPreviewAttachment,
    composerHeight,
    composerResizeActive,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
    isDragOver,
    previewAttachment,
    setPreviewAttachment,
    startComposerResize,
  }
}
