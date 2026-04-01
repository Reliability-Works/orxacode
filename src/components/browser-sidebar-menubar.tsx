import type { MutableRefObject } from 'react'
import { PanelRightClose } from 'lucide-react'
import type { BrowserSidebarStateView } from '../lib/app-session-utils'

type BrowserSidebarMenuBarProps = {
  browserState: BrowserSidebarStateView
  closeMenu: () => void
  menubarRef: MutableRefObject<HTMLElement | null>
  onBrowserCloseTab?: (tabID: string) => Promise<void> | void
  onBrowserGoBack: () => Promise<void> | void
  onBrowserGoForward: () => Promise<void> | void
  onBrowserOpenTab?: () => Promise<void> | void
  onBrowserReload: () => Promise<void> | void
  onBrowserSelectHistory: (url: string) => Promise<void> | void
  onBrowserStop: () => Promise<void> | void
  openMenu: string | null
  runBrowserAction: (action: () => void | Promise<void>) => void
  setBrowserUrlInput: (value: string) => void
  setOpenMenu: (value: string | null) => void
  onCollapse?: () => void
}

function FileMenuSection({
  browserState,
  closeMenu,
  onBrowserCloseTab,
  onBrowserOpenTab,
}: Pick<
  BrowserSidebarMenuBarProps,
  'browserState' | 'closeMenu' | 'onBrowserCloseTab' | 'onBrowserOpenTab'
>) {
  return (
    <div className="browser-menu-dropdown" role="menu">
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          closeMenu()
          void onBrowserOpenTab?.()
        }}
      >
        New Tab
      </button>
      {browserState.activeTabID && onBrowserCloseTab ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            closeMenu()
            void onBrowserCloseTab(browserState.activeTabID!)
          }}
        >
          Close Tab
        </button>
      ) : null}
    </div>
  )
}

function EditMenuSection({
  closeMenu,
  setBrowserUrlInput,
}: Pick<BrowserSidebarMenuBarProps, 'closeMenu' | 'setBrowserUrlInput'>) {
  return (
    <div className="browser-menu-dropdown" role="menu">
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          closeMenu()
          document.execCommand('copy')
        }}
      >
        Copy URL
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          closeMenu()
          void navigator.clipboard.readText().then(text => {
            if (text.trim()) {
              setBrowserUrlInput(text.trim())
            }
          })
        }}
      >
        Paste URL
      </button>
    </div>
  )
}

function ViewMenuSection({
  closeMenu,
  onBrowserReload,
  onBrowserStop,
  runBrowserAction,
}: Pick<
  BrowserSidebarMenuBarProps,
  'closeMenu' | 'onBrowserReload' | 'onBrowserStop' | 'runBrowserAction'
>) {
  return (
    <div className="browser-menu-dropdown" role="menu">
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          closeMenu()
          runBrowserAction(onBrowserReload)
        }}
      >
        Reload
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          closeMenu()
          runBrowserAction(onBrowserStop)
        }}
      >
        Stop
      </button>
    </div>
  )
}

function HistoryMenuSection({
  browserState,
  closeMenu,
  onBrowserGoBack,
  onBrowserGoForward,
  onBrowserSelectHistory,
  runBrowserAction,
}: Pick<
  BrowserSidebarMenuBarProps,
  | 'browserState'
  | 'closeMenu'
  | 'onBrowserGoBack'
  | 'onBrowserGoForward'
  | 'onBrowserSelectHistory'
  | 'runBrowserAction'
>) {
  return (
    <div className="browser-menu-dropdown" role="menu">
      <button
        type="button"
        role="menuitem"
        disabled={!browserState.canGoBack}
        onClick={() => {
          closeMenu()
          runBrowserAction(onBrowserGoBack)
        }}
      >
        Back
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!browserState.canGoForward}
        onClick={() => {
          closeMenu()
          runBrowserAction(onBrowserGoForward)
        }}
      >
        Forward
      </button>
      {browserState.history.length > 0 ? (
        <>
          <div className="browser-menu-separator" />
          {browserState.history.slice(0, 10).map(entry => (
            <button
              key={entry.id}
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu()
                runBrowserAction(() => onBrowserSelectHistory(entry.url))
              }}
              title={entry.url}
            >
              {entry.label}
            </button>
          ))}
        </>
      ) : null}
    </div>
  )
}

function MenuToggle({
  activeMenu,
  label,
  openMenu,
  setOpenMenu,
}: {
  activeMenu: string
  label: string
  openMenu: string | null
  setOpenMenu: (value: string | null) => void
}) {
  return (
    <button
      type="button"
      className={`browser-menubar-item ${openMenu === activeMenu ? 'is-open' : ''}`.trim()}
      onClick={() => setOpenMenu(openMenu === activeMenu ? null : activeMenu)}
      onMouseEnter={() => openMenu && setOpenMenu(activeMenu)}
    >
      {label}
    </button>
  )
}

export function BrowserSidebarMenuBar({
  browserState,
  closeMenu,
  menubarRef,
  onBrowserCloseTab,
  onBrowserGoBack,
  onBrowserGoForward,
  onBrowserOpenTab,
  onBrowserReload,
  onBrowserSelectHistory,
  onBrowserStop,
  openMenu,
  runBrowserAction,
  setBrowserUrlInput,
  setOpenMenu,
  onCollapse,
}: BrowserSidebarMenuBarProps) {
  return (
    <div className="browser-sidebar-header">
      <nav ref={menubarRef} className="browser-menubar" aria-label="Browser menu bar">
        <div className="browser-menu-wrap">
          <MenuToggle
            activeMenu="file"
            label="File"
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
          />
          {openMenu === 'file' ? (
            <FileMenuSection
              browserState={browserState}
              closeMenu={closeMenu}
              onBrowserCloseTab={onBrowserCloseTab}
              onBrowserOpenTab={onBrowserOpenTab}
            />
          ) : null}
        </div>

        <div className="browser-menu-wrap">
          <MenuToggle
            activeMenu="edit"
            label="Edit"
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
          />
          {openMenu === 'edit' ? (
            <EditMenuSection closeMenu={closeMenu} setBrowserUrlInput={setBrowserUrlInput} />
          ) : null}
        </div>

        <div className="browser-menu-wrap">
          <MenuToggle
            activeMenu="view"
            label="View"
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
          />
          {openMenu === 'view' ? (
            <ViewMenuSection
              closeMenu={closeMenu}
              onBrowserReload={onBrowserReload}
              onBrowserStop={onBrowserStop}
              runBrowserAction={runBrowserAction}
            />
          ) : null}
        </div>

        <div className="browser-menu-wrap">
          <MenuToggle
            activeMenu="history"
            label="History"
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
          />
          {openMenu === 'history' ? (
            <HistoryMenuSection
              browserState={browserState}
              closeMenu={closeMenu}
              onBrowserGoBack={onBrowserGoBack}
              onBrowserGoForward={onBrowserGoForward}
              onBrowserSelectHistory={onBrowserSelectHistory}
              runBrowserAction={runBrowserAction}
            />
          ) : null}
        </div>
      </nav>

      {onCollapse ? (
        <button
          type="button"
          className="browser-sidebar-collapse"
          onClick={onCollapse}
          aria-label="Collapse browser sidebar"
          title="Collapse browser sidebar"
        >
          <PanelRightClose size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
