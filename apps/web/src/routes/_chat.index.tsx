import { createFileRoute } from '@tanstack/react-router'

import { ChatViewEmptyState } from '../components/chat/ChatViewEmptyState'

export const Route = createFileRoute('/_chat/')({
  component: ChatViewEmptyState,
})
