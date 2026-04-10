import type { SidebarThreadSortOrder } from '@orxa-code/contracts/settings'

import { getFallbackThreadIdAfterDelete } from '../components/Sidebar.logic'
import type { Thread } from '../types'

type ArchivableThread = Pick<
  Thread,
  'id' | 'projectId' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'messages'
>

export function getFallbackThreadIdAfterArchive<T extends ArchivableThread>(input: {
  threads: readonly T[]
  archivedThreadId: T['id']
  sortOrder: SidebarThreadSortOrder
}): T['id'] | null {
  return getFallbackThreadIdAfterDelete({
    threads: input.threads.filter(thread => thread.archivedAt === null),
    deletedThreadId: input.archivedThreadId,
    sortOrder: input.sortOrder,
  })
}
