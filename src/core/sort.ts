// Ordering the samples of a Workbench: by name, in natural order (Sample 2 before Sample 10), by number of events, by the
// date the file was acquired, by group, or by the value of a keyword stored in the file. The order is kept in the list of
// samples itself, so everything that walks the samples (the list, tables, the gallery, moving with the arrow keys) follows it.

import type { FcsFile } from './fcs'
import { groupIdOf, groupTree } from './groups'
import type { SampleRef, Workbench } from './workbench'

export type SortKey = 'name' | 'natural' | 'events' | 'date' | 'group' | `kw:${string}`
export type SortDir = 'asc' | 'desc'

const collator = new Intl.Collator('en', { sensitivity: 'base' })
const natural = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export const naturalCompare = (a: string, b: string): number => natural.compare(a, b)

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// $DATE ("27-OCT-2026", "27-Oct-26" or "2026-10-27") with $BTIM ("14:03:22"), as milliseconds, or null when the file does not say.
export function acquisitionTime(file: FcsFile): number | null {
  const d = (file.keywords['$DATE'] ?? '').trim()
  if (!d) return null
  let y: number, m: number, day: number
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(d)
  const dmy = /^(\d{1,2})[-/ ]([A-Za-z]{3})[A-Za-z]*[-/ ](\d{2,4})$/.exec(d)
  if (iso) { y = +iso[1]; m = +iso[2] - 1; day = +iso[3] }
  else if (dmy) {
    m = MONTHS.indexOf(dmy[2].toLowerCase()); day = +dmy[1]; y = +dmy[3]
    if (m < 0) return null
    if (y < 100) y += y < 70 ? 2000 : 1900
  } else return null
  const t = /^(\d{1,2}):(\d{2}):(\d{2})/.exec((file.keywords['$BTIM'] ?? '').trim())
  const ms = Date.UTC(y, m, day, t ? +t[1] : 0, t ? +t[2] : 0, t ? +t[3] : 0)
  return Number.isFinite(ms) ? ms : null
}

// The samples in the requested order. Samples with no value to compare (no file, no such keyword, no date) always go last.
export function sortSamples(wb: Pick<Workbench, 'samples' | 'groups' | 'groupOf'>, files: Record<string, FcsFile | undefined>, key: SortKey, dir: SortDir = 'asc'): SampleRef[] {
  const sign = dir === 'asc' ? 1 : -1
  const order = new Map(groupTree(wb).map((g, i) => [g.id, i + 1]))
  type Item = { s: SampleRef; v: number | string | null }
  const value = (s: SampleRef): number | string | null => {
    const f = files[s.id]
    if (key === 'name' || key === 'natural') return s.name
    if (key === 'group') return order.get(groupIdOf(wb, s.id)) ?? 0 // samples in no group first, then groups as listed
    if (!f) return null
    if (key === 'events') return f.eventCount
    if (key === 'date') return acquisitionTime(f)
    const k = f.keywords[key.slice(3)]
    return k === undefined || k === '' ? null : k
  }
  const items: Item[] = wb.samples.map((s) => ({ s, v: value(s) }))
  const compare = (a: Item, b: Item): number => {
    if (a.v === null || b.v === null) return a.v === b.v ? 0 : a.v === null ? 1 : -1 // missing last, whatever the direction
    let c: number
    if (typeof a.v === 'number' && typeof b.v === 'number') c = a.v - b.v
    else c = key === 'name' ? collator.compare(String(a.v), String(b.v)) : natural.compare(String(a.v), String(b.v))
    if (c !== 0) return c * sign
    return key === 'name' || key === 'natural' ? 0 : natural.compare(a.s.name, b.s.name) // ties by name, always A to Z
  }
  return items.map((it, i) => ({ it, i })).sort((x, y) => compare(x.it, y.it) || x.i - y.i).map((x) => x.it.s)
}

// Moves the chosen samples as a block to just before `beforeId` (or to the end with null), keeping their own order.
export function moveBefore(samples: SampleRef[], ids: string[], beforeId: string | null): SampleRef[] {
  const moving = samples.filter((s) => ids.includes(s.id))
  const rest = samples.filter((s) => !ids.includes(s.id))
  const at = beforeId === null ? rest.length : rest.findIndex((s) => s.id === beforeId)
  if (at < 0) return samples
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)]
}

// One place up or down among the samples that are shown (the others keep their places).
export function nudge(samples: SampleRef[], shownIds: string[], ids: string[], delta: -1 | 1): SampleRef[] {
  const shown = shownIds.filter((id) => samples.some((s) => s.id === id))
  const idx = shown.map((id, i) => (ids.includes(id) ? i : -1)).filter((i) => i >= 0)
  if (idx.length === 0) return samples
  const targetIndex = delta < 0 ? idx[0] - 1 : idx[idx.length - 1] + 1
  if (targetIndex < 0 || targetIndex >= shown.length) return samples
  const neighbour = shown[targetIndex]
  const block = shown.filter((id) => ids.includes(id))
  return delta < 0 ? moveBefore(samples, block, neighbour) : moveBefore(samples, block, nextAfter(samples, neighbour))
}

function nextAfter(samples: SampleRef[], id: string): string | null {
  const i = samples.findIndex((s) => s.id === id)
  return i >= 0 && i + 1 < samples.length ? samples[i + 1].id : null
}
