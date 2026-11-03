// Overlays: another population (of this sample or of another) drawn on top of the plot that is open, on the same axes.
// On a histogram it is a second curve; on a two-parameter plot it is a set of coloured dots. Comparing a sample with a
// reference sample is the usual use.

import type { FcsFile } from './fcs'
import type { OverlayItem } from './reportTypes'
import { compensate } from './compensation'
import { findByPath } from './groups'
import { transformColumn } from './transform'
import { columnIndex, evaluatePopulations, populationsFor, scaleFor, type Workbench } from './workbench'

export type { OverlayItem }

export interface OverlayColumns {
  xs: Float32Array // display coordinates, 0..1
  ys: Float32Array | null // null for a histogram
  mask: Uint8Array | null // events of the population (null: all)
  events: number
}

export function overlayLabel(wb: Pick<Workbench, 'samples'>, item: OverlayItem): string {
  const name = wb.samples.find((s) => s.id === item.sampleId)?.name.replace(/\.fcs$/i, '') ?? '?'
  return `${name} · ${item.path.length ? item.path.join(' / ') : 'All events'}`
}

// The events of an overlay on the axes of the open plot, or the reason there is nothing to draw.
export function overlayColumns(wb: Workbench, files: Record<string, FcsFile | undefined>, item: OverlayItem, x: string, y: string | null): { data: OverlayColumns | null; note: string | null } {
  const raw = files[item.sampleId]
  if (!raw) return { data: null, note: 'its file is not loaded' }
  const matrix = wb.compensation.matrices.find((m) => m.id === wb.compensation.assignments[item.sampleId])
  const file = matrix ? compensate(raw, matrix).file : raw
  const pops = populationsFor(wb, item.sampleId)
  const pop = findByPath(pops, item.sampleId, item.path)
  if (!pop) return { data: null, note: 'it has no such population' }
  const xi = columnIndex(file, x)
  const yi = y === null ? 0 : columnIndex(file, y)
  if (xi < 0 || yi < 0) return { data: null, note: `it has no parameter ${xi < 0 ? x : y}` }
  const mask = evaluatePopulations(wb, file, item.sampleId).get(pop.id) ?? null
  let events = 0
  if (!mask) events = file.eventCount
  else for (let i = 0; i < mask.length; i++) if (mask[i]) events++
  return {
    data: {
      xs: transformColumn(file.columns[xi], scaleFor(wb, file, x)),
      ys: y === null ? null : transformColumn(file.columns[yi], scaleFor(wb, file, y)),
      mask,
      events,
    },
    note: null,
  }
}

// [1 2 1] / 4 repeated `passes` times; the ends keep their own value so the total is kept.
export function smoothBins(bins: Float64Array, passes: number): Float64Array {
  let cur = bins
  for (let p = 0; p < passes; p++) {
    const next = new Float64Array(cur.length)
    for (let i = 0; i < cur.length; i++) next[i] = (cur[Math.max(0, i - 1)] + 2 * cur[i] + cur[Math.min(cur.length - 1, i + 1)]) / 4
    cur = next
  }
  return cur
}

// Scales so the tallest bin is `to` (an empty histogram stays empty).
export function normalizeBins(bins: Float64Array, to = 100): Float64Array {
  let max = 0
  for (const v of bins) if (v > max) max = v
  return max > 0 ? bins.map((v) => (v / max) * to) : bins
}

// The same population in every other sample of a list, matched by name path: for "overlay the whole group".
export function itemsForSamples(wb: Workbench, sampleIds: string[], path: string[], idFor: () => string): OverlayItem[] {
  return sampleIds.filter((id) => findByPath(populationsFor(wb, id), id, path)).map((id) => ({ id: idFor(), sampleId: id, path }))
}

