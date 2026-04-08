import { RegistryContext } from '@effect/atom-react'
import type { ReactNode } from 'react'

import { appAtomRegistry } from './atomRegistryState'

export function AppAtomRegistryProvider({ children }: { readonly children: ReactNode }) {
  return <RegistryContext.Provider value={appAtomRegistry}>{children}</RegistryContext.Provider>
}
