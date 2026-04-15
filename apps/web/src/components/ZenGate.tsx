import type { ReactNode } from 'react'
import { useZenMode } from '../hooks/useZenMode'
import type { TopbarButtonId } from './chat/topbarButtonRegistry'

export function ZenGate({ id, children }: { id: TopbarButtonId; children: ReactNode }) {
  const { isButtonVisible } = useZenMode()
  if (!isButtonVisible(id)) return null
  return <>{children}</>
}
