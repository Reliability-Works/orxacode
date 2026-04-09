/**
 * Auth-detail subcomponents for `ProviderCard`.
 *
 * Pure render-only helpers — no hooks, no state. Live in their own file so the
 * parent `ProviderCard.tsx` stays under the 500-line lint cap and so the
 * helpers can be unit-tested in isolation.
 */
import type { ReactNode } from 'react'

export interface ProviderCardConfiguredProvidersProps {
  readonly configuredProviders: ReadonlyArray<string> | undefined
}

/**
 * Render a compact "Configured: anthropic, openai" summary for the
 * `ServerProviderAuth.configuredProviders` field. Renders nothing when the
 * list is undefined or empty so providers without a nested-provider concept
 * (Claude, Codex) display no extra row.
 */
export function ProviderCardConfiguredProviders({
  configuredProviders,
}: ProviderCardConfiguredProvidersProps): ReactNode {
  if (!configuredProviders || configuredProviders.length === 0) {
    return null
  }
  return (
    <p className="text-xs text-muted-foreground">
      Configured: <span className="text-foreground">{configuredProviders.join(', ')}</span>
    </p>
  )
}
