// What a report is made of. Kept apart from the HTML writer so the Workbench can validate it without a circular import.

export type ReportBlock =
  | { id: string; kind: 'heading'; text: string }
  | { id: string; kind: 'text'; text: string }
  | { id: string; kind: 'table' }
  | { id: string; kind: 'chart'; colId: string; by: 'sample' | 'group' }

export function validBlocks(v: unknown): v is ReportBlock[] {
  return Array.isArray(v) && v.every((b) => {
    if (!b || typeof b.id !== 'string') return false
    if (b.kind === 'heading' || b.kind === 'text') return typeof b.text === 'string'
    if (b.kind === 'table') return true
    if (b.kind === 'chart') return typeof b.colId === 'string' && (b.by === 'sample' || b.by === 'group')
    return false
  })
}

// One plot of the Sheet view: which population, which axes, which kind of plot. The sheet shows the same tiles for whichever sample is selected.
export interface SheetTile {
  id: string
  path: string[] // population as names from the first level down; empty is All events
  x: string
  y: string // ignored for a histogram
  plot: 'pseudocolor' | 'contour' | 'zebra' | 'histogram'
}

export function validTiles(v: unknown): v is SheetTile[] {
  return Array.isArray(v) && v.every((t) => t && typeof t.id === 'string' && Array.isArray(t.path) && t.path.every((p: unknown) => typeof p === 'string') &&
    typeof t.x === 'string' && typeof t.y === 'string' && ['pseudocolor', 'contour', 'zebra', 'histogram'].includes(t.plot))
}

// A population drawn over the open plot (see overlay.ts). Saved with the Workbench so the comparison is still there next time.
export interface OverlayItem {
  id: string
  sampleId: string
  path: string[] // population as names from the first level down; empty is "All events"
}

export function validOverlays(v: unknown): v is OverlayItem[] {
  return Array.isArray(v) && v.every((o) => o && typeof o.id === 'string' && typeof o.sampleId === 'string' && Array.isArray(o.path) && o.path.every((p: unknown) => typeof p === 'string'))
}
