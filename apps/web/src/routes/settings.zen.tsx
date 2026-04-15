import { createFileRoute } from '@tanstack/react-router'

import { ZenSettingsPanel } from '../components/settings/ZenSettingsPanel'

export const Route = createFileRoute('/settings/zen')({
  component: ZenSettingsPanel,
})
