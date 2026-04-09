import { createFileRoute } from '@tanstack/react-router'

import { DashboardView } from '../components/dashboard/DashboardView'

export const Route = createFileRoute('/dashboard')({
  component: DashboardView,
})
