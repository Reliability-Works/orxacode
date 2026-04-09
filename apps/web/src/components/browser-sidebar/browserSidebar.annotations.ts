import { useCallback, useState } from 'react'

import type { DesktopBrowserAnnotationCandidate } from '@orxa-code/contracts'

export interface BrowserAnnotation extends DesktopBrowserAnnotationCandidate {
  id: string
  comment: string
  timestamp: number
}

function buildAnnotationsMarkdown(activeUrl: string | null, annotations: BrowserAnnotation[]): string {
  const lines = ['## Browser Annotations', '']
  if (activeUrl) {
    lines.push(`**URL:** ${activeUrl}`, '')
  }
  for (const annotation of annotations) {
    lines.push(`- **${annotation.element}**`)
    lines.push(`  - Selector: \`${annotation.selector}\``)
    if (annotation.comment.trim()) {
      lines.push(`  - Note: ${annotation.comment.trim()}`)
    }
    if (annotation.text) {
      lines.push(`  - Text: ${annotation.text}`)
    }
    if (annotation.boundingBox) {
      lines.push(
        `  - Bounds: ${annotation.boundingBox.width}x${annotation.boundingBox.height} at (${annotation.boundingBox.x}, ${annotation.boundingBox.y})`
      )
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function useBrowserAnnotations(activeUrl: string | null) {
  const [annotations, setAnnotations] = useState<BrowserAnnotation[]>([])
  const [copied, setCopied] = useState(false)

  const addAnnotation = useCallback((candidate: DesktopBrowserAnnotationCandidate) => {
    setAnnotations(current => [
      ...current,
      {
        ...candidate,
        id: crypto.randomUUID(),
        comment: '',
        timestamp: Date.now(),
      },
    ])
  }, [])

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations(current => current.filter(annotation => annotation.id !== id))
  }, [])

  const updateAnnotationComment = useCallback((id: string, comment: string) => {
    setAnnotations(current =>
      current.map(annotation => (annotation.id === id ? { ...annotation, comment } : annotation))
    )
  }, [])

  const clearAnnotations = useCallback(() => {
    setAnnotations([])
  }, [])

  const copyAnnotationsPrompt = useCallback(() => {
    if (annotations.length === 0) return
    const prompt =
      buildAnnotationsMarkdown(activeUrl, annotations) +
      '\nPlease review these annotated elements and address the notes above.'
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    })
  }, [activeUrl, annotations])

  return {
    annotations,
    copied,
    addAnnotation,
    removeAnnotation,
    updateAnnotationComment,
    clearAnnotations,
    copyAnnotationsPrompt,
  }
}
