// Results as a table: one row per sample and population, with the event count and the share of the parent and of
// all events. Written so the file opens correctly in Excel, whichever decimal separator the computer uses.

import type { FcsFile } from './fcs'
import { compensate } from './compensation'
import { groupIdOf } from './groups'
import { countMask } from './stats'
import { DEFAULT_GROUP, DEFAULT_GROUP_NAME, ROOT_ID, evaluatePopulations, populationsFor, type Workbench } from './workbench'

export interface StatsRow {
  sample: string
  group: string
  population: string // the name
  path: string // names from the first level down, e.g. "Lymphs / CD3+"
  events: number
  pctParent: number | null // null when the parent is empty
  pctTotal: number | null
}

export const STATS_COLUMNS = ['Sample', 'Group', 'Population', 'Path', 'Events', '% of parent', '% of total'] as const

export function statsRows(wb: Workbench, files: Record<string, FcsFile | undefined>): StatsRow[] {
  const rows: StatsRow[] = []
  for (const s of wb.samples) {
    const raw = files[s.id]
    if (!raw) continue // a sample whose file is not loaded has nothing to count
    const matrix = wb.compensation.matrices.find((m) => m.id === wb.compensation.assignments[s.id])
    const file = matrix ? compensate(raw, matrix).file : raw
    const pops = populationsFor(wb, s.id)
    const masks = evaluatePopulations(wb, file, s.id)
    const gid = groupIdOf(wb, s.id)
    const group = gid === DEFAULT_GROUP ? DEFAULT_GROUP_NAME : (wb.groups.find((g) => g.id === gid)?.name ?? '')
    const counts = new Map<string, number>()
    const walk = (id: string, path: string[]): void => {
      const p = pops.find((q) => q.id === id)
      if (!p) return
      const count = countMask(masks.get(p.id) ?? null, file.eventCount)
      counts.set(p.id, count)
      const parentCount = p.parentId ? (counts.get(p.parentId) ?? file.eventCount) : file.eventCount
      rows.push({
        sample: s.name,
        group,
        population: p.name,
        path: path.join(' / ') || p.name,
        events: count,
        pctParent: p.id === ROOT_ID ? 100 : parentCount ? (count / parentCount) * 100 : null,
        pctTotal: file.eventCount ? (count / file.eventCount) * 100 : null,
      })
      for (const c of pops.filter((q) => q.parentId === p.id)) walk(c.id, [...path, c.name])
    }
    walk(ROOT_ID, [])
  }
  return rows
}

export interface CsvOptions {
  decimal: '.' | ','
  delimiter: ',' | ';'
  bom?: boolean // a byte-order mark makes Excel read accents correctly
}

// Excel in a language that writes decimals with a comma expects ";" between columns, and the comma in the numbers.
export function csvOptionsFor(decimalSeparator: string): CsvOptions {
  return decimalSeparator === ',' ? { decimal: ',', delimiter: ';', bom: true } : { decimal: '.', delimiter: ',', bom: true }
}

const escape = (v: string, delimiter: string): string => (/["\r\n]/.test(v) || v.includes(delimiter) ? `"${v.replace(/"/g, '""')}"` : v)

export function toCsv(rows: StatsRow[], o: CsvOptions): string {
  const num = (v: number | null): string => (v === null || !Number.isFinite(v) ? '' : v.toFixed(2).replace('.', o.decimal))
  const lines = [STATS_COLUMNS.join(o.delimiter)]
  for (const r of rows)
    lines.push([r.sample, r.group, r.population, r.path, String(r.events), num(r.pctParent), num(r.pctTotal)].map((v) => escape(v, o.delimiter)).join(o.delimiter))
  return (o.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n'
}
