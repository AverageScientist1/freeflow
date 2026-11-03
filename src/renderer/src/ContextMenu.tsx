import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Check, ChevronRight } from 'lucide-react'

// A menu that opens where the right mouse button was pressed (or from the keyboard with the Menu key or Shift+F10). It is drawn by
// the program, not by the system, so it follows the light or dark theme. Items can open submenus.

export interface MenuItem {
  label?: string
  hint?: string // a shortcut shown at the right
  onSelect?: () => void
  items?: MenuItem[] // a submenu
  disabled?: boolean
  checked?: boolean
  danger?: boolean
  separator?: boolean
}

interface MenuState {
  open: { x: number; y: number; items: MenuItem[]; label: string; returnTo: HTMLElement | null } | null
  show(x: number, y: number, items: MenuItem[], label: string): void
  close(): void
}

export const useContextMenu = create<MenuState>((set, get) => ({
  open: null,
  show: (x, y, items, label) => set({ open: { x, y, items, label, returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null } }),
  close: () => {
    const o = get().open
    set({ open: null })
    // the keyboard focus goes back to where it was
    if (o?.returnTo && document.contains(o.returnTo)) o.returnTo.focus()
  },
}))

// Opens the menu for a right click, or for the keyboard keys that mean the same (returns true when it did).
export function openMenuFor(e: React.MouseEvent | React.KeyboardEvent, items: MenuItem[], label: string): boolean {
  if ('key' in e) {
    if (!(e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) return false
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    e.preventDefault()
    useContextMenu.getState().show(r.left + 24, r.bottom - 4, items, label)
    return true
  }
  e.preventDefault()
  e.stopPropagation()
  useContextMenu.getState().show(e.clientX, e.clientY, items, label)
  return true
}

function focusables(list: HTMLElement): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(':scope > .ctx-row > [role="menuitem"]:not([aria-disabled="true"])'))
}

function MenuList({ items, label, depth, onClose, onLeft, focusFirst = false }: { items: MenuItem[]; label: string; depth: number; onClose: () => void; onLeft?: () => void; focusFirst?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const [sub, setSub] = useState<number | null>(null)
  const rows = useRef<(HTMLDivElement | null)[]>([])
  const [byKeyboard, setByKeyboard] = useState(false) // a submenu opened with the keyboard takes the focus; one opened by the mouse does not
  const [flip, setFlip] = useState(false)
  const [shift, setShift] = useState(0)

  // a submenu that would run off the window opens to the other side, and is moved up when it is too low
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || depth === 0) return
    const r = el.getBoundingClientRect()
    if (r.right > window.innerWidth - 4) setFlip(true)
    if (r.bottom > window.innerHeight - 4) setShift(window.innerHeight - 4 - r.bottom)
  }, [depth])
  useEffect(() => { if (depth === 0 || focusFirst) focusables(ref.current!)[0]?.focus() }, [depth, focusFirst])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const list = ref.current!
    const f = focusables(list)
    const i = f.indexOf(document.activeElement as HTMLElement)
    const move = (n: number): void => { e.preventDefault(); e.stopPropagation(); f[(n + f.length) % f.length]?.focus() }
    if (e.key === 'ArrowDown') move(i + 1)
    else if (e.key === 'ArrowUp') move(i < 0 ? f.length - 1 : i - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(f.length - 1)
    else if (e.key === 'ArrowLeft' && depth > 0) { e.preventDefault(); e.stopPropagation(); onLeft?.() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    else if (e.key === 'Tab') { e.preventDefault(); onClose() }
  }

  return (
    <div ref={ref} className={`ctx-menu ${depth > 0 ? 'sub' : ''} ${flip ? 'flip' : ''}`} role="menu" aria-label={label} style={shift ? { top: shift } : undefined} onKeyDown={onKeyDown}>
      {items.map((it, k) => {
        if (it.separator) return <div key={k} role="separator" className="ctx-sep" />
        const hasSub = !!it.items
        return (
          <div key={k} className="ctx-row" ref={(el) => { rows.current[k] = el }}>
            <button type="button" role="menuitem" tabIndex={-1} aria-disabled={it.disabled || undefined} aria-haspopup={hasSub ? 'menu' : undefined} aria-expanded={hasSub ? sub === k : undefined}
              className={`ctx-item ${it.danger ? 'danger' : ''}`}
              onMouseEnter={(e) => { if (it.disabled) return; e.currentTarget.focus(); setByKeyboard(false); setSub(hasSub ? k : null) }}
              onClick={() => { if (it.disabled) return; if (hasSub) setSub(k); else { onClose(); it.onSelect?.() } }}
              onKeyDown={(e) => {
                if (it.disabled) return
                if (hasSub && (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); setByKeyboard(true); setSub(k) }
              }}>
              <span className="ctx-check">{it.checked ? <Check size={13} /> : null}</span>
              <span className="ctx-label">{it.label}</span>
              {it.hint && <span className="ctx-hint">{it.hint}</span>}
              {hasSub && <ChevronRight size={14} className="ctx-arrow" />}
            </button>
            {hasSub && sub === k && !it.disabled && (
              <MenuList items={it.items!} label={it.label ?? 'Submenu'} depth={depth + 1} onClose={onClose} focusFirst={byKeyboard}
                onLeft={() => { setSub(null); rows.current[k]?.querySelector<HTMLElement>(':scope > [role="menuitem"]')?.focus() }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ContextMenuHost() {
  const open = useContextMenu((s) => s.open)
  const close = useContextMenu((s) => s.close)
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    if (!open) return
    const r = box.current?.firstElementChild?.getBoundingClientRect()
    const w = r?.width ?? 240
    const h = r?.height ?? 300
    setPos({ x: Math.max(4, Math.min(open.x, window.innerWidth - w - 6)), y: Math.max(4, Math.min(open.y, window.innerHeight - h - 6)) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (e: Event): void => { if (!box.current?.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('contextmenu', outside, true)
    window.addEventListener('wheel', outside, { capture: true, passive: true })
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('contextmenu', outside, true)
      window.removeEventListener('wheel', outside, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  if (!open) return null
  return (
    <div ref={box} className="ctx-host" style={{ left: pos.x, top: pos.y }}>
      <MenuList items={open.items} label={open.label} depth={0} onClose={close} />
    </div>
  )
}