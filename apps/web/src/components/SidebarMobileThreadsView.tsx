import { ChevronRightIcon, PlusIcon, SquarePenIcon, Trash2Icon } from 'lucide-react'
import { PROVIDER_DISPLAY_NAMES, type ProviderKind } from '@orxa-code/contracts'
import type { ThreadId } from '@orxa-code/contracts'
import { useEffect } from 'react'

import { formatRelativeTimeLabel } from '../timestampFormat'
import { cn } from '~/lib/utils'
import { AddProjectForm } from './SidebarProjectList'
import { resolveSidebarNewThreadEnvMode } from './Sidebar.logic'
import { ProjectFavicon } from './ProjectFavicon'
import { ProviderLogo } from './session'
import { ProjectSortMenu } from './sidebar/SidebarHelpers'
import type { RenderedPinnedThreadData, RenderedProjectData } from './sidebar/ProjectItem'
import { MobileSyncDebugDock } from './MobileSyncDebugOverlay'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import type { SidebarBodyProps } from './SidebarBody'
import { useStore } from '../store'
import { toastManager } from './ui/toastState'

export type SidebarMobileThreadsViewProps = Omit<SidebarBodyProps, 'isOnSettings'>
type MobileProjectItemProps = ReturnType<
  SidebarMobileThreadsViewProps['getProjectItemProps']
>['projectItemProps']

function resolveMobileThreadProvider(
  thread: RenderedPinnedThreadData['thread']
): ProviderKind | null {
  return thread.session?.provider ?? thread.modelSelection.provider ?? null
}

function formatThreadCount(count: number) {
  return count === 1 ? '1 session' : `${count} sessions`
}

function startProjectSession(
  projectId: RenderedProjectData['project']['id'],
  defaultThreadEnvMode: MobileProjectItemProps['defaultThreadEnvMode'],
  onNewThread: MobileProjectItemProps['onNewThread']
) {
  return onNewThread(projectId, {
    envMode: resolveSidebarNewThreadEnvMode({
      defaultEnvMode: defaultThreadEnvMode,
    }),
  })
}

function MobileThreadsActionButton(props: React.ComponentProps<'button'>) {
  const { className, ...rest } = props
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-xl border border-sidebar-border bg-sidebar text-muted-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
        className
      )}
      {...rest}
    />
  )
}

function MobileThreadsHeader() {
  return (
    <div className="border-b border-sidebar-border px-4 py-4">
      <h2 className="text-lg font-semibold tracking-tight text-sidebar-foreground">Threads</h2>
      <p className="mt-1 max-w-sm text-sm leading-5 text-muted-foreground/75">
        Jump between projects, reopen a session, or start a fresh one from your phone.
      </p>
    </div>
  )
}

function MobileThreadsToolbar(props: {
  shouldShowProjectPathEntry: SidebarMobileThreadsViewProps['shouldShowProjectPathEntry']
  appSettings: SidebarMobileThreadsViewProps['appSettings']
  onUpdateProjectSortOrder: SidebarMobileThreadsViewProps['onUpdateProjectSortOrder']
  onUpdateThreadSortOrder: SidebarMobileThreadsViewProps['onUpdateThreadSortOrder']
  onStartAddProject: SidebarMobileThreadsViewProps['onStartAddProject']
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div>
        <div className="text-caption font-semibold uppercase tracking-wider text-muted-foreground/60">
          Projects
        </div>
        <div className="mt-1 text-sm text-muted-foreground/70">Choose where you want to work.</div>
      </div>
      <div className="flex items-center gap-2">
        <ProjectSortMenu
          projectSortOrder={props.appSettings.sidebarProjectSortOrder}
          threadSortOrder={props.appSettings.sidebarThreadSortOrder}
          onProjectSortOrderChange={props.onUpdateProjectSortOrder}
          onThreadSortOrderChange={props.onUpdateThreadSortOrder}
          triggerClassName="size-9 rounded-xl border border-sidebar-border bg-sidebar text-muted-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          iconClassName="size-4"
          tooltipSide="bottom"
        />
        <MobileThreadsActionButton
          aria-label={props.shouldShowProjectPathEntry ? 'Cancel add project' : 'Add project'}
          aria-pressed={props.shouldShowProjectPathEntry}
          onClick={props.onStartAddProject}
        >
          <PlusIcon
            className={cn(
              'size-4 transition-transform duration-150',
              props.shouldShowProjectPathEntry ? 'rotate-45' : 'rotate-0'
            )}
          />
        </MobileThreadsActionButton>
      </div>
    </div>
  )
}

function MobileThreadStatusDot(props: { status: RenderedPinnedThreadData['threadStatus'] }) {
  if (!props.status) return null
  return (
    <span
      title={props.status.label}
      className={cn(
        'inline-flex size-2 rounded-full',
        props.status.dotClass,
        props.status.pulse && 'animate-pulse'
      )}
    />
  )
}

function MobileThreadRow(props: {
  thread: RenderedPinnedThreadData['thread']
  threadStatus: RenderedPinnedThreadData['threadStatus']
  isActive: boolean
  onOpen: (threadId: ThreadId) => void
  onDelete?: (threadId: ThreadId) => Promise<void> | void
}) {
  const provider = resolveMobileThreadProvider(props.thread)
  const isRunning =
    props.thread.session?.status === 'running' && props.thread.session.activeTurnId != null
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors',
        props.isActive
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/70'
      )}
      onClick={() => props.onOpen(props.thread.id)}
    >
      <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-sidebar-border/70 bg-sidebar/60 text-muted-foreground/80">
        {provider ? <ProviderLogo provider={provider} size={18} /> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{props.thread.title}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground/75">
          <MobileThreadStatusDot status={props.threadStatus} />
          {provider ? <span>{PROVIDER_DISPLAY_NAMES[provider]}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end">
        <div className="text-right text-xs text-muted-foreground/65">
          {formatRelativeTimeLabel(props.thread.updatedAt ?? props.thread.createdAt)}
        </div>
        {!isRunning && props.onDelete ? (
          <button
            type="button"
            className="mt-1 inline-flex h-7 w-7 items-center justify-center self-end rounded-lg text-muted-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label={`Delete ${props.thread.title}`}
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              void Promise.resolve(props.onDelete?.(props.thread.id)).catch(error => {
                toastManager.add({
                  type: 'error',
                  title: 'Failed to delete session',
                  description: error instanceof Error ? error.message : 'An error occurred.',
                })
              })
            }}
          >
            <Trash2Icon className="size-3.5" />
          </button>
        ) : null}
      </div>
    </button>
  )
}

function MobilePinnedThreadsSection(props: {
  renderedPinnedThreads: SidebarMobileThreadsViewProps['renderedPinnedThreads']
  routeThreadId: SidebarMobileThreadsViewProps['routeThreadId']
  getThreadRowProps: SidebarMobileThreadsViewProps['getThreadRowProps']
}) {
  if (props.renderedPinnedThreads.length === 0) return null
  return (
    <section className="mb-5">
      <div className="mb-2 px-1 text-caption font-semibold uppercase tracking-wider text-muted-foreground/60">
        Pinned
      </div>
      <div className="space-y-1">
        {props.renderedPinnedThreads.map(({ thread, threadStatus }) => {
          const rowProps = props.getThreadRowProps(thread)
          return (
            <MobileThreadRow
              key={thread.id}
              thread={thread}
              threadStatus={threadStatus}
              isActive={props.routeThreadId === thread.id}
              onOpen={rowProps.onThreadNavigate}
              onDelete={rowProps.deleteAction.onAttempt}
            />
          )
        })}
      </div>
    </section>
  )
}

function MobileProjectHeader(props: {
  renderedProject: RenderedProjectData
  projectItemProps: MobileProjectItemProps
}) {
  const threadCount = props.renderedProject.projectThreads.length
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        onClick={event =>
          props.projectItemProps.onProjectTitleClick(event, props.renderedProject.project.id)
        }
        onKeyDown={event =>
          props.projectItemProps.onProjectTitleKeyDown(event, props.renderedProject.project.id)
        }
      >
        <ChevronRightIcon
          className={cn(
            'size-4 shrink-0 text-muted-foreground/70 transition-transform',
            props.renderedProject.project.expanded ? 'rotate-90' : ''
          )}
        />
        <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-sidebar-border/70 bg-sidebar/55">
          <ProjectFavicon cwd={props.renderedProject.project.cwd} className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-sidebar-foreground">
            {props.renderedProject.project.name}
          </div>
          <div className="mt-1 text-xs text-muted-foreground/70">
            {formatThreadCount(threadCount)}
          </div>
        </div>
      </button>
      <MobileThreadsActionButton
        aria-label={`Start a new session in ${props.renderedProject.project.name}`}
        onClick={event => {
          event.preventDefault()
          event.stopPropagation()
          void startProjectSession(
            props.renderedProject.project.id,
            props.projectItemProps.defaultThreadEnvMode,
            props.projectItemProps.onNewThread
          )
        }}
      >
        <SquarePenIcon className="size-4" />
      </MobileThreadsActionButton>
    </div>
  )
}

function MobileProjectEmptyState(props: {
  projectId: RenderedProjectData['project']['id']
  defaultThreadEnvMode: MobileProjectItemProps['defaultThreadEnvMode']
  onNewThread: MobileProjectItemProps['onNewThread']
}) {
  return (
    <div className="px-2 py-3">
      <div className="text-sm font-medium text-sidebar-foreground">No sessions yet</div>
      <div className="mt-1 text-sm leading-5 text-muted-foreground/70">
        Start a new session in this project to jump straight into chat.
      </div>
      <Button
        className="mt-3"
        size="sm"
        variant="secondary"
        onClick={() => {
          void startProjectSession(props.projectId, props.defaultThreadEnvMode, props.onNewThread)
        }}
      >
        Start session
      </Button>
    </div>
  )
}

function MobileProjectRows(props: {
  renderedProject: RenderedProjectData
  projectItemProps: MobileProjectItemProps
  routeThreadId: SidebarMobileThreadsViewProps['routeThreadId']
}) {
  if (props.renderedProject.renderedThreadEntries.length === 0) {
    return (
      <MobileProjectEmptyState
        projectId={props.renderedProject.project.id}
        defaultThreadEnvMode={props.projectItemProps.defaultThreadEnvMode}
        onNewThread={props.projectItemProps.onNewThread}
      />
    )
  }

  return (
    <div className="space-y-1">
      {props.renderedProject.renderedThreadEntries.map(({ thread }) => {
        const rowProps = props.projectItemProps.getThreadRowProps(thread)
        const threadStatus = props.renderedProject.threadStatuses.get(thread.id) ?? null
        return (
          <MobileThreadRow
            key={thread.id}
            thread={thread}
            threadStatus={threadStatus}
            isActive={props.routeThreadId === thread.id}
            onOpen={rowProps.onThreadNavigate}
            onDelete={rowProps.deleteAction.onAttempt}
          />
        )
      })}
    </div>
  )
}

function MobileProjectCard(props: {
  renderedProject: RenderedProjectData
  projectItemProps: MobileProjectItemProps
  routeThreadId: SidebarMobileThreadsViewProps['routeThreadId']
}) {
  return (
    <section className="overflow-hidden rounded-[1.35rem] border border-sidebar-border bg-sidebar">
      <MobileProjectHeader
        renderedProject={props.renderedProject}
        projectItemProps={props.projectItemProps}
      />
      {props.renderedProject.project.expanded ? (
        <div className="border-t border-sidebar-border/70 px-2 py-2">
          <MobileProjectRows
            renderedProject={props.renderedProject}
            projectItemProps={props.projectItemProps}
            routeThreadId={props.routeThreadId}
          />
        </div>
      ) : null}
    </section>
  )
}

function useMobileThreadsDebugState(input: {
  activeEnvironmentId: string | null
  bootstrapComplete: boolean
  pinnedThreads: number
  projectCards: number
  shouldShowBootstrapLoading: boolean
}) {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    console.info('[mobile-sync] mobile threads view state', {
      activeEnvironmentId: input.activeEnvironmentId,
      bootstrapComplete: input.bootstrapComplete,
      mobile: new URLSearchParams(window.location.search).get('mobile') === '1',
      pinnedThreads: input.pinnedThreads,
      projectCards: input.projectCards,
      revision: 'mobile-reopen-probe-1',
      shouldShowBootstrapLoading: input.shouldShowBootstrapLoading,
    })
  }, [
    input.activeEnvironmentId,
    input.bootstrapComplete,
    input.pinnedThreads,
    input.projectCards,
    input.shouldShowBootstrapLoading,
  ])
}

function useMobileThreadsRuntimeDebugState(input: {
  bootstrapComplete: boolean
  pinnedThreads: number
  projectCards: number
  shouldShowBootstrapLoading: boolean
}) {
  const activeEnvironmentId = useStore(store => store.activeEnvironmentId)
  useMobileThreadsDebugState({
    activeEnvironmentId,
    bootstrapComplete: input.bootstrapComplete,
    pinnedThreads: input.pinnedThreads,
    projectCards: input.projectCards,
    shouldShowBootstrapLoading: input.shouldShowBootstrapLoading,
  })
}

function MobileThreadsFooter() {
  return (
    <div className="border-t border-sidebar-border px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <MobileSyncDebugDock />
    </div>
  )
}

export function SidebarMobileThreadsView(props: SidebarMobileThreadsViewProps) {
  const { projectItemProps } = props.getProjectItemProps()
  const shouldShowBootstrapLoading =
    !props.bootstrapComplete &&
    !props.shouldShowProjectPathEntry &&
    props.renderedPinnedThreads.length === 0 &&
    props.renderedProjects.length === 0
  useMobileThreadsRuntimeDebugState({
    bootstrapComplete: props.bootstrapComplete,
    pinnedThreads: props.renderedPinnedThreads.length,
    projectCards: props.renderedProjects.length,
    shouldShowBootstrapLoading,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar text-sidebar-foreground">
      <MobileThreadsHeader />
      <ScrollArea hideScrollbars scrollFade className="min-h-0 flex-1">
        <div className="px-4 py-4">
          <MobileThreadsToolbar
            shouldShowProjectPathEntry={props.shouldShowProjectPathEntry}
            appSettings={props.appSettings}
            onUpdateProjectSortOrder={props.onUpdateProjectSortOrder}
            onUpdateThreadSortOrder={props.onUpdateThreadSortOrder}
            onStartAddProject={props.onStartAddProject}
          />
          {props.shouldShowProjectPathEntry ? (
            <div className="mb-4 rounded-[1.2rem] border border-sidebar-border bg-sidebar p-3">
              <AddProjectForm
                isPickingFolder={props.isPickingFolder}
                isAddingProject={props.isAddingProject}
                addProjectError={props.addProjectError}
                addProjectInputRef={props.addProjectInputRef}
                canAddProject={props.canAddProject}
                newCwd={props.newCwd}
                onNewCwdChange={props.onNewCwdChange}
                onPickFolder={props.onPickFolder}
                onAddProject={props.onAddProject}
                onAddProjectKeyDown={props.onAddProjectKeyDown}
              />
            </div>
          ) : null}
          <MobilePinnedThreadsSection
            renderedPinnedThreads={props.renderedPinnedThreads}
            routeThreadId={props.routeThreadId}
            getThreadRowProps={props.getThreadRowProps}
          />
          {shouldShowBootstrapLoading ? (
            <div className="flex min-h-[40vh] items-center justify-center px-6 py-10 text-center">
              <div>
                <div className="text-sm font-medium text-sidebar-foreground">
                  Syncing your workspaces…
                </div>
                <div className="mt-2 text-sm text-muted-foreground/70">
                  Pulling projects and sessions from your Mac.
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {props.renderedProjects.map(renderedProject => (
                <MobileProjectCard
                  key={renderedProject.project.id}
                  renderedProject={renderedProject}
                  projectItemProps={projectItemProps}
                  routeThreadId={props.routeThreadId}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
      <MobileThreadsFooter />
    </div>
  )
}
