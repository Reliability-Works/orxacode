/**
 * Transient store tracking a thread being dragged from the sidebar into the
 * chat area. Enables the drop target to validate the drag (same-project,
 * different-thread) during `dragover`, since `dataTransfer` contents are only
 * readable at drop-time.
 */
import { type ProjectId, type ThreadId } from '@orxa-code/contracts'
import { create } from 'zustand'

export const THREAD_DRAG_MIME = 'application/x-orxa-thread'

export interface DraggingThread {
  readonly threadId: ThreadId
  readonly projectId: ProjectId | null
}

interface ThreadDragStore {
  draggingThread: DraggingThread | null
  setDraggingThread: (thread: DraggingThread | null) => void
}

export const useThreadDragStore = create<ThreadDragStore>(set => ({
  draggingThread: null,
  setDraggingThread: thread => set({ draggingThread: thread }),
}))
