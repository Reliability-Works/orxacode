import { useRef, useState, type RefObject } from 'react'
import { ChevronDown, Copy, Crosshair, LayoutGrid, Lock, Palette, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react'
import type { CanvasTile, CanvasTheme } from '../types/canvas'
import type { CanvasTileSortMode } from '../lib/canvas-layout'
import { AddTileDropdown } from './AddTileDropdown'
import { CanvasThemePicker } from './CanvasThemePicker'
import { useOutsideClickCloser } from './CanvasToolbarMenuHooks'

function SortMenu({
  sortMenuRef,
  sortMenuOpen,
  setSortMenuOpen,
  setMenuOpen,
  onSortTiles,
}: {
  sortMenuRef: RefObject<HTMLDivElement | null>
  sortMenuOpen: boolean
  setSortMenuOpen: (v: boolean) => void
  setMenuOpen: (v: boolean) => void
  onSortTiles: (mode: CanvasTileSortMode) => void
}) {
  useOutsideClickCloser(sortMenuOpen, setSortMenuOpen, sortMenuRef)

  if (!sortMenuOpen) return null

  return (
    <div className="canvas-toolbar-jump-menu" role="menu">
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setSortMenuOpen(false)
          setMenuOpen(false)
          onSortTiles('type')
        }}
      >
        <span className="canvas-toolbar-jump-type">mode</span>
        <span className="canvas-toolbar-jump-meta">by tile type</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setSortMenuOpen(false)
          setMenuOpen(false)
          onSortTiles('created')
        }}
      >
        <span className="canvas-toolbar-jump-type">mode</span>
        <span className="canvas-toolbar-jump-meta">by time created</span>
      </button>
    </div>
  )
}

function ManageMenu({
  manageMenuRef,
  manageMenuOpen,
  setManageMenuOpen,
  tiles,
  onDuplicateTile,
  onRemoveTile,
}: {
  manageMenuRef: RefObject<HTMLDivElement | null>
  manageMenuOpen: boolean
  setManageMenuOpen: (v: boolean) => void
  tiles: CanvasTile[]
  onDuplicateTile?: (tile: CanvasTile) => void
  onRemoveTile?: (tileId: string) => void
}) {
  useOutsideClickCloser(manageMenuOpen, setManageMenuOpen, manageMenuRef)

  if (!manageMenuOpen) return null

  return (
    <div className="canvas-toolbar-jump-menu canvas-toolbar-jump-menu-up" role="menu">
      {tiles.map(tile => (
        <div key={tile.id} className="canvas-toolbar-manage-row">
          <span className="canvas-toolbar-jump-type">{tile.type.replace(/_/g, ' ')}</span>
          <span className="canvas-toolbar-jump-meta">
            {(tile.meta?.title as string) ||
              (tile.meta?.url as string) ||
              (tile.meta?.directory as string) ||
              tile.id.slice(0, 8)}
          </span>
          <span className="canvas-toolbar-manage-actions">
            {onDuplicateTile ? (
              <button
                type="button"
                title="Duplicate"
                onClick={() => {
                  setManageMenuOpen(false)
                  onDuplicateTile(tile)
                }}
              >
                <Copy size={11} />
              </button>
            ) : null}
            {onRemoveTile ? (
              <button
                type="button"
                className="canvas-toolbar-manage-delete"
                title="Remove"
                onClick={() => {
                  setManageMenuOpen(false)
                  onRemoveTile(tile.id)
                }}
              >
                <Trash2 size={11} />
              </button>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  )
}

function JumpMenu({
  jumpMenuRef,
  jumpMenuOpen,
  setJumpMenuOpen,
  tiles,
  onJumpToTile,
}: {
  jumpMenuRef: RefObject<HTMLDivElement | null>
  jumpMenuOpen: boolean
  setJumpMenuOpen: (v: boolean) => void
  tiles: CanvasTile[]
  onJumpToTile?: (tile: CanvasTile) => void
}) {
  useOutsideClickCloser(jumpMenuOpen, setJumpMenuOpen, jumpMenuRef)

  if (!jumpMenuOpen || !onJumpToTile) return null

  return (
    <div className="canvas-toolbar-jump-menu canvas-toolbar-jump-menu-up" role="menu">
      {tiles.map(tile => (
        <button
          key={tile.id}
          type="button"
          role="menuitem"
          onClick={() => {
            setJumpMenuOpen(false)
            onJumpToTile(tile)
          }}
        >
          <span className="canvas-toolbar-jump-type">{tile.type.replace(/_/g, ' ')}</span>
          <span className="canvas-toolbar-jump-meta">
            {(tile.meta?.title as string) ||
              (tile.meta?.url as string) ||
              (tile.meta?.directory as string) ||
              tile.id.slice(0, 8)}
          </span>
        </button>
      ))}
    </div>
  )
}

function HubMenuAddTile({
  dropdownOpen,
  setDropdownOpen,
  addButtonRef,
  onAddTile,
}: {
  dropdownOpen: boolean
  setDropdownOpen: (v: boolean) => void
  addButtonRef: RefObject<HTMLButtonElement | null>
  onAddTile: (type: CanvasTile['type']) => void
}) {
  return (
    <div className="canvas-toolbar-add-wrap">
      <button
        ref={addButtonRef}
        type="button"
        role="menuitem"
        className={`canvas-hub-menu-item${dropdownOpen ? ' active' : ''}`}
        onClick={() => setDropdownOpen(!dropdownOpen)}
        aria-label="Add tile"
        aria-expanded={dropdownOpen}
        aria-haspopup="dialog"
      >
        <Plus size={14} aria-hidden="true" />
        <span>add tile</span>
      </button>
      {dropdownOpen ? (
        <AddTileDropdown onAddTile={onAddTile} onClose={() => setDropdownOpen(false)} />
      ) : null}
    </div>
  )
}

function HubMenuTheme({
  themePickerOpen,
  setThemePickerOpen,
  theme,
  onTheme,
  onThemeChange,
}: {
  themePickerOpen: boolean
  setThemePickerOpen: (v: boolean) => void
  theme?: CanvasTheme
  onTheme?: () => void
  onThemeChange?: (theme: Partial<CanvasTheme>) => void
}) {
  const handleThemeClick = () => {
    if (theme && onThemeChange) {
      setThemePickerOpen(!themePickerOpen)
      return
    }
    onTheme?.()
  }

  return (
    <div className="canvas-toolbar-theme-anchor">
      <button
        type="button"
        role="menuitem"
        className={`canvas-hub-menu-item${themePickerOpen ? ' active' : ''}`}
        onClick={handleThemeClick}
        aria-label="Theme"
        aria-expanded={theme && onThemeChange ? themePickerOpen : undefined}
        aria-haspopup={theme && onThemeChange ? 'dialog' : undefined}
      >
        <Palette size={14} aria-hidden="true" />
        <span>theme</span>
      </button>
      {themePickerOpen && theme && onThemeChange ? (
        <CanvasThemePicker
          theme={theme}
          onThemeChange={onThemeChange}
          onClose={() => setThemePickerOpen(false)}
        />
      ) : null}
    </div>
  )
}

function HubMenuSort({
  sortMenuOpen,
  setSortMenuOpen,
  setMenuOpen,
  sortMenuRef,
  onSortTiles,
  tiles,
}: {
  sortMenuOpen: boolean
  setSortMenuOpen: (v: boolean) => void
  setMenuOpen: (v: boolean) => void
  sortMenuRef: RefObject<HTMLDivElement | null>
  onSortTiles?: (mode: CanvasTileSortMode) => void
  tiles: CanvasTile[]
}) {
  if (!onSortTiles || tiles.length <= 1) return null

  return (
    <div ref={sortMenuRef} className="canvas-toolbar-jump-wrap">
      <button
        type="button"
        role="menuitem"
        className={`canvas-hub-menu-item${sortMenuOpen ? ' active' : ''}`}
        onClick={() => setSortMenuOpen(!sortMenuOpen)}
        aria-label="Sort tiles"
        aria-expanded={sortMenuOpen}
        aria-haspopup="menu"
      >
        <LayoutGrid size={14} aria-hidden="true" />
        <span>sort</span>
      </button>
      <SortMenu
        sortMenuRef={sortMenuRef}
        sortMenuOpen={sortMenuOpen}
        setSortMenuOpen={setSortMenuOpen}
        setMenuOpen={setMenuOpen}
        onSortTiles={onSortTiles}
      />
    </div>
  )
}

export function HubMenu({
  menuOpen,
  dropdownOpen,
  setDropdownOpen,
  themePickerOpen,
  setThemePickerOpen,
  theme,
  onTheme,
  onThemeChange,
  snapToGrid,
  onToggleSnap,
  onReset,
  setMenuOpen,
  sortMenuOpen,
  setSortMenuOpen,
  sortMenuRef,
  onSortTiles,
  tiles,
  addButtonRef,
  onAddTile,
}: {
  menuOpen: boolean
  dropdownOpen: boolean
  setDropdownOpen: (v: boolean) => void
  themePickerOpen: boolean
  setThemePickerOpen: (v: boolean) => void
  theme?: CanvasTheme
  onTheme?: () => void
  onThemeChange?: (theme: Partial<CanvasTheme>) => void
  snapToGrid: boolean
  onToggleSnap: () => void
  onReset: () => void
  setMenuOpen: (v: boolean) => void
  sortMenuOpen: boolean
  setSortMenuOpen: (v: boolean) => void
  sortMenuRef: React.RefObject<HTMLDivElement | null>
  onSortTiles?: (mode: CanvasTileSortMode) => void
  tiles: CanvasTile[]
  addButtonRef: RefObject<HTMLButtonElement | null>
  onAddTile: (type: CanvasTile['type']) => void
}) {
  if (!menuOpen) return null

  return (
    <div className="canvas-hub-menu" role="menu">
      <HubMenuAddTile
        dropdownOpen={dropdownOpen}
        setDropdownOpen={setDropdownOpen}
        addButtonRef={addButtonRef}
        onAddTile={onAddTile}
      />
      <HubMenuTheme
        themePickerOpen={themePickerOpen}
        setThemePickerOpen={setThemePickerOpen}
        theme={theme}
        onTheme={onTheme}
        onThemeChange={onThemeChange}
      />
      <button
        type="button"
        role="menuitem"
        className={`canvas-hub-menu-item${snapToGrid ? ' active' : ''}`}
        onClick={onToggleSnap}
        aria-label="Lock tiles"
        title={snapToGrid ? 'Unlock tiles' : 'Lock tiles'}
        aria-pressed={snapToGrid}
      >
        <Lock size={14} aria-hidden="true" />
        <span>{snapToGrid ? 'locked' : 'lock'}</span>
      </button>
      <HubMenuSort
        sortMenuOpen={sortMenuOpen}
        setSortMenuOpen={setSortMenuOpen}
        setMenuOpen={setMenuOpen}
        sortMenuRef={sortMenuRef}
        onSortTiles={onSortTiles}
        tiles={tiles}
      />
      <button
        type="button"
        role="menuitem"
        className="canvas-hub-menu-item"
        onClick={() => {
          onReset()
          setMenuOpen(false)
        }}
        aria-label="Reset canvas view"
      >
        <RotateCcw size={14} aria-hidden="true" />
        <span>reset view</span>
      </button>
    </div>
  )
}

export function ManageTilesButton({
  tiles,
  onDuplicateTile,
  onRemoveTile,
}: {
  tiles: CanvasTile[]
  onDuplicateTile?: (tile: CanvasTile) => void
  onRemoveTile?: (tileId: string) => void
}) {
  const [manageMenuOpen, setManageMenuOpen] = useState(false)
  const manageMenuRef = useRef<HTMLDivElement>(null)
  useOutsideClickCloser(manageMenuOpen, setManageMenuOpen, manageMenuRef)

  if (tiles.length === 0 || (!onDuplicateTile && !onRemoveTile)) return null

  return (
    <div ref={manageMenuRef} className="canvas-toolbar-jump-wrap canvas-toolbar-pill-wrap">
      <button
        type="button"
        className={`canvas-toolbar-btn canvas-toolbar-pill${manageMenuOpen ? ' active' : ''}`}
        onClick={() => setManageMenuOpen(v => !v)}
        aria-label="Manage tiles"
        aria-expanded={manageMenuOpen}
        aria-haspopup="menu"
      >
        <Settings2 size={12} aria-hidden="true" />
        <span>manage</span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      <ManageMenu
        manageMenuRef={manageMenuRef}
        manageMenuOpen={manageMenuOpen}
        setManageMenuOpen={setManageMenuOpen}
        tiles={tiles}
        onDuplicateTile={onDuplicateTile}
        onRemoveTile={onRemoveTile}
      />
    </div>
  )
}

export function JumpToTileButton({
  tiles,
  onJumpToTile,
}: {
  tiles: CanvasTile[]
  onJumpToTile?: (tile: CanvasTile) => void
}) {
  const [jumpMenuOpen, setJumpMenuOpen] = useState(false)
  const jumpMenuRef = useRef<HTMLDivElement>(null)
  useOutsideClickCloser(jumpMenuOpen, setJumpMenuOpen, jumpMenuRef)

  if (!onJumpToTile || tiles.length === 0) return null

  return (
    <div ref={jumpMenuRef} className="canvas-toolbar-jump-wrap canvas-toolbar-pill-wrap">
      <button
        type="button"
        className={`canvas-toolbar-btn canvas-toolbar-pill${jumpMenuOpen ? ' active' : ''}`}
        onClick={() => setJumpMenuOpen(v => !v)}
        aria-label="Jump to tile"
        aria-expanded={jumpMenuOpen}
        aria-haspopup="menu"
      >
        <Crosshair size={12} aria-hidden="true" />
        <span>jump to</span>
        <ChevronDown size={11} aria-hidden="true" />
      </button>
      <JumpMenu
        jumpMenuRef={jumpMenuRef}
        jumpMenuOpen={jumpMenuOpen}
        setJumpMenuOpen={setJumpMenuOpen}
        tiles={tiles}
        onJumpToTile={onJumpToTile}
      />
    </div>
  )
}
