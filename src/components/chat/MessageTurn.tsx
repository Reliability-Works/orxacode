import type { ReactNode } from 'react'

interface MessageTurnProps {
  children: ReactNode
  interrupted?: boolean
}

export function MessageTurn({ children, interrupted }: MessageTurnProps) {
  return (
    <div className="message-turn">
      {children}
      {interrupted ? <div className="message-turn-divider" aria-label="Turn interrupted" /> : null}
    </div>
  )
}
