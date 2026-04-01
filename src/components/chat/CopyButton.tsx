import { useState } from 'react'
import { ChatCheckIcon, ChatClipboardIcon } from './chat-icons'

interface CopyButtonProps {
  text: string
  className?: string
  label?: string
}

export function CopyButton({ text, className, label = 'Copy' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleClick = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard write failed — silently ignore
    }
  }

  return (
    <button
      type="button"
      className={`copy-button${className ? ` ${className}` : ''}`}
      onClick={handleClick}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
    >
      {copied ? <ChatCheckIcon /> : <ChatClipboardIcon />}
    </button>
  )
}
