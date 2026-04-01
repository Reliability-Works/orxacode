import { useEffect, type RefObject } from 'react'

export function useCloseAllMenus(
  menuOpen: boolean,
  setMenuOpen: (v: boolean) => void,
  setDropdownOpen: (v: boolean) => void,
  setThemePickerOpen: (v: boolean) => void,
  setJumpMenuOpen: (v: boolean) => void,
  setSortMenuOpen: (v: boolean) => void,
  setManageMenuOpen: (v: boolean) => void,
  hubRef: RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (hubRef.current && !hubRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setDropdownOpen(false)
        setThemePickerOpen(false)
        setJumpMenuOpen(false)
        setSortMenuOpen(false)
        setManageMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [
    menuOpen,
    setMenuOpen,
    setDropdownOpen,
    setThemePickerOpen,
    setJumpMenuOpen,
    setSortMenuOpen,
    setManageMenuOpen,
    hubRef,
  ])
}

export function useOutsideClickCloser(
  isOpen: boolean,
  setOpen: (v: boolean) => void,
  ref: RefObject<HTMLDivElement | null>
) {
  useEffect(() => {
    if (!isOpen) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen, setOpen, ref])
}
