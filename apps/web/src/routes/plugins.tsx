import { createFileRoute } from '@tanstack/react-router'

import { PluginsView } from '../components/skills/SkillsView'

export const Route = createFileRoute('/plugins')({
  component: PluginsView,
})
