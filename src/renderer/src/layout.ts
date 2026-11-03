import { create } from 'zustand'

// How the window is divided: the widths of the left and right panels, whether each is open, and the height of each
// section of the left panel. Kept between sessions.

const KEY = 'freeflow.layout'

export const LIMITS = { left: [220, 640], right: [220, 560], box: [56, 600] } as const

interface Saved {
  leftW: number
  rightW: number
  leftOpen: boolean
  rightOpen: boolean
  boxH: Record<string, number> // section id -> height in pixels (the last section takes what is left)
  closed: Record<string, boolean> // section id -> folded to its title
}

export const DEFAULT_LAYOUT: Saved = { leftW: 400, rightW: 320, leftOpen: true, rightOpen: true, boxH: { groups: 150, samples: 200 }, closed: {} }

interface LayoutState extends Saved {
  setLeftW(w: number): void
  setRightW(w: number): void
  toggleLeft(): void
  toggleRight(): void
  setBoxH(id: string, h: number): void
  toggleSection(id: string): void
  reset(): void
}

const clamp = (v: number, [lo, hi]: readonly [number, number] | readonly number[]): number => Math.min(hi, Math.max(lo, Math.round(v)))

function load(): Saved {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_LAYOUT
    const o = JSON.parse(raw) as Partial<Saved>
    return {
      leftW: typeof o.leftW === 'number' ? clamp(o.leftW, LIMITS.left) : DEFAULT_LAYOUT.leftW,
      rightW: typeof o.rightW === 'number' ? clamp(o.rightW, LIMITS.right) : DEFAULT_LAYOUT.rightW,
      leftOpen: o.leftOpen !== false,
      rightOpen: o.rightOpen !== false,
      boxH: { ...DEFAULT_LAYOUT.boxH, ...(o.boxH && typeof o.boxH === 'object' ? o.boxH : {}) },
      closed: o.closed && typeof o.closed === 'object' ? o.closed : {},
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

export const useLayout = create<LayoutState>((set) => ({
  ...load(),
  setLeftW: (w) => set({ leftW: clamp(w, LIMITS.left), leftOpen: true }),
  setRightW: (w) => set({ rightW: clamp(w, LIMITS.right), rightOpen: true }),
  toggleLeft: () => set((s) => ({ leftOpen: !s.leftOpen })),
  toggleRight: () => set((s) => ({ rightOpen: !s.rightOpen })),
  setBoxH: (id, h) => set((s) => ({ boxH: { ...s.boxH, [id]: clamp(h, LIMITS.box) }, closed: { ...s.closed, [id]: false } })),
  toggleSection: (id) => set((s) => ({ closed: { ...s.closed, [id]: !s.closed[id] } })),
  reset: () => set({ ...DEFAULT_LAYOUT }),
}))

useLayout.subscribe((s) => {
  const saved: Saved = { leftW: s.leftW, rightW: s.rightW, leftOpen: s.leftOpen, rightOpen: s.rightOpen, boxH: s.boxH, closed: s.closed }
  try { localStorage.setItem(KEY, JSON.stringify(saved)) } catch { /* storage unavailable */ }
})