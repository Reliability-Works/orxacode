import type { ComponentProps, MouseEvent as ReactMouseEvent } from 'react'
import { BrowserSidebar } from './components/BrowserSidebar'
import { GitSidebar } from './components/GitSidebar'

type AppSidePanesProps = {
  hasProjectContext: boolean
  browserSidebarOpen: boolean
  showGitPane: boolean
  startSidebarResize: (
    pane: 'browser' | 'right',
    event: ReactMouseEvent<HTMLButtonElement>
  ) => void
  setBrowserSidebarOpen: (open: boolean) => void
  browserSidebarProps: ComponentProps<typeof BrowserSidebar>
  gitSidebarProps: ComponentProps<typeof GitSidebar>
}

export function AppSidePanes({
  hasProjectContext,
  browserSidebarOpen,
  showGitPane,
  startSidebarResize,
  setBrowserSidebarOpen,
  browserSidebarProps,
  gitSidebarProps,
}: AppSidePanesProps) {
  return (
    <>
      {hasProjectContext ? (
        <button
          type="button"
          className={`sidebar-resizer sidebar-resizer-browser ${browserSidebarOpen ? '' : 'is-collapsed'}`.trim()}
          aria-label="Resize browser sidebar"
          onMouseDown={event => startSidebarResize('browser', event)}
          disabled={!browserSidebarOpen}
        />
      ) : null}
      {hasProjectContext ? (
        <div className={`workspace-browser-pane ${browserSidebarOpen ? 'open' : 'collapsed'}`.trim()}>
          {browserSidebarOpen ? (
            <BrowserSidebar
              {...browserSidebarProps}
              onCollapse={() => setBrowserSidebarOpen(false)}
            />
          ) : null}
        </div>
      ) : null}
      {hasProjectContext ? (
        <button
          type="button"
          className={`sidebar-resizer sidebar-resizer-right ${showGitPane ? '' : 'is-collapsed'}`.trim()}
          aria-label="Resize git sidebar"
          onMouseDown={event => startSidebarResize('right', event)}
          disabled={!showGitPane}
        />
      ) : null}
      {hasProjectContext ? (
        <div className={`workspace-right-pane ${showGitPane ? 'open' : 'collapsed'}`.trim()}>
          <GitSidebar {...gitSidebarProps} />
        </div>
      ) : null}
    </>
  )
}
