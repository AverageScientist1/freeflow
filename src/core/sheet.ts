// Building a sheet of plots from the gates of a sample, the way a gating strategy is read: every gate shown on the
// plot of its parent population, with the axes it was drawn on.

import type { SheetTile } from './reportTypes'
import { namePath } from './groups'
import { ROOT_ID, populationsFor, type Workbench } from './workbench'

export function tilesFromGates(wb: Workbench, sampleId: string, idFor: () => string): SheetTile[] {
  const pops = populationsFor(wb, sampleId)
  const out: SheetTile[] = []
  const seen = new Set<string>()
  const walk = (id: string): void => {
    for (const p of pops.filter((q) => q.parentId === id)) {
      const g = p.gateId ? wb.gates.find((x) => x.id === p.gateId) : undefined
      if (g) {
        const oneD = g.geometry.type === 'range'
        const tile: Omit<SheetTile, 'id'> = { path: namePath(pops, id), x: g.xParam, y: oneD ? '' : g.yParam, plot: oneD ? 'histogram' : 'pseudocolor' }
        const key = JSON.stringify(tile) // the four quarters of a quadrant gate, or two gates on the same plot, share one tile
        if (!seen.has(key)) { seen.add(key); out.push({ id: idFor(), ...tile }) }
      }
      walk(p.id)
    }
  }
  walk(ROOT_ID)
  return out
}