import type { Attachment } from '../hooks/useComposerState'

export const IMAGE_FILENAME_FALLBACK = 'pasted-image.png'

export function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('Failed to read pasted image.'))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read pasted image.'))
    reader.readAsDataURL(file)
  })
}

export function isImageAttachment(attachment: Attachment) {
  return (
    attachment.mime.startsWith('image/') ||
    attachment.url.startsWith('data:image/') ||
    attachment.url.startsWith('file:')
  )
}
