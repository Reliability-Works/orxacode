import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ProviderCardConfiguredProviders } from './ProviderCardAuthDetails'

describe('ProviderCardConfiguredProviders', () => {
  it('renders each configured provider name when the list is non-empty', () => {
    const html = renderToStaticMarkup(
      <ProviderCardConfiguredProviders configuredProviders={['anthropic', 'openai']} />
    )

    expect(html).toContain('Configured:')
    expect(html).toContain('anthropic')
    expect(html).toContain('openai')
  })

  it('renders nothing when the configured providers list is undefined', () => {
    const html = renderToStaticMarkup(
      <ProviderCardConfiguredProviders configuredProviders={undefined} />
    )

    expect(html).toBe('')
    expect(html).not.toContain('Configured:')
  })

  it('renders nothing when the configured providers list is empty', () => {
    const html = renderToStaticMarkup(<ProviderCardConfiguredProviders configuredProviders={[]} />)

    expect(html).toBe('')
    expect(html).not.toContain('Configured:')
  })
})
