/**
 * useSidebarProjectDnD — DnD sensors, drag handlers, and auto-animate refs
 * for the sidebar project list. Split out of useSidebarProjectActions to
 * keep hook bodies under the line limit.
 */

import { useCallback, useRef } from 'react'
import type { ProjectId } from '@orxa-code/contracts'
import { closestCorners, pointerWithin, useSensor, useSensors, PointerSensor } from '@dnd-kit/core'
import { autoAnimate } from '@formkit/auto-animate'
import type { Project } from '../../types'

const SIDEBAR_LIST_ANIMATION_OPTIONS = { duration: 180, easing: 'ease-out' } as const

export interface UseSidebarProjectDnDParams {
  appSettings: { sidebarProjectSortOrder: string }
  sidebarProjects: Array<Project & { expanded: boolean }>
  reorderProjects: (activeId: ProjectId, overId: ProjectId) => void
  dragInProgressRef: React.MutableRefObject<boolean>
  suppressProjectClickAfterDragRef: React.MutableRefObject<boolean>
}

export function useSidebarProjectDnD(params: UseSidebarProjectDnDParams) {
  const {
    appSettings,
    sidebarProjects,
    reorderProjects,
    dragInProgressRef,
    suppressProjectClickAfterDragRef,
  } = params

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )
  const projectCollisionDetection = useCallback<import('@dnd-kit/core').CollisionDetection>(
    args => {
      const pc = pointerWithin(args)
      return pc.length > 0 ? pc : closestCorners(args)
    },
    []
  )
  const handleProjectDragStart = useCallback(() => {
    if (appSettings.sidebarProjectSortOrder !== 'manual') return
    dragInProgressRef.current = true
    suppressProjectClickAfterDragRef.current = true
  }, [appSettings.sidebarProjectSortOrder, dragInProgressRef, suppressProjectClickAfterDragRef])
  const handleProjectDragEnd = useCallback(
    (event: import('@dnd-kit/core').DragEndEvent) => {
      if (appSettings.sidebarProjectSortOrder !== 'manual') {
        dragInProgressRef.current = false
        return
      }
      dragInProgressRef.current = false
      const { active, over } = event
      if (!over || active.id === over.id) return
      const ap = sidebarProjects.find(p => p.id === active.id)
      const op = sidebarProjects.find(p => p.id === over.id)
      if (ap && op) reorderProjects(ap.id, op.id)
    },
    [appSettings.sidebarProjectSortOrder, dragInProgressRef, reorderProjects, sidebarProjects]
  )
  const handleProjectDragCancel = useCallback(() => {
    dragInProgressRef.current = false
  }, [dragInProgressRef])

  const animatedProjectListsRef = useRef(new WeakSet<HTMLElement>())
  const attachProjectListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedProjectListsRef.current.has(node)) return
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS)
    animatedProjectListsRef.current.add(node)
  }, [])
  const animatedThreadListsRef = useRef(new WeakSet<HTMLElement>())
  const attachThreadListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedThreadListsRef.current.has(node)) return
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS)
    animatedThreadListsRef.current.add(node)
  }, [])

  return {
    projectDnDSensors,
    projectCollisionDetection,
    handleProjectDragStart,
    handleProjectDragEnd,
    handleProjectDragCancel,
    attachProjectListAutoAnimateRef,
    attachThreadListAutoAnimateRef,
  }
}
