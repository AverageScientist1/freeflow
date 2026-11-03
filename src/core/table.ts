// Tables: one row per sample, one column per (population, statistic[, parameter]). The columns are saved in the Workbench;
// the numbers are always computed from the data, never stored.

import type { FcsFile } from './fcs'
import { compensate } from './compensation'
import { findByPath, groupIdOf, namePath, samplesInGroup } from './groups'
import { columnIndex, evaluatePopulations, populationsFor, ROOT_ID, DEFAULT_GROUP, DEFAULT_GROUP_NAME, type Workbench } from './workbench'
import { countMask, isParamStat, paramStat, STAT_LABELS, type StatKind, type TableColumn } from './stats'

export type { TableColumn }

export interface TableRow {
  sampleId: string
  name: string
  group: string
  values: (number | null)[] // null: the sample has no such population, or its file is not loaded, or the value is undefined
}

export const pathLabel = (path: string[]): string => (path.length ? path.join(' / ') : 'All events')

export function columnLabel(c: TableColumn): string {
  if (!isParamStat(c.stat)) return `${pathLabel(c.path)} | ${STAT_LABELS[c.stat]}`
  const stat = c.stat === 'pctile' ? `${c.pct ?? 50}th percentile` : STAT_LABELS[c.stat]
  return `${pathLabel(c.path)} | ${stat} | ${c.param ?? '?'}`
}

// Every population (by name path) that exists in at least one of the samples, in tree order, for offering as columns.
export function populationPaths(wb: Workbench, sampleIds: string[]): string[][] {
  const seen = new Map<string, string[]>()
  for (const id of sampleIds) {
    const pops = populationsFor(wb, id)
    const walk = (popId: string): void => {
      const path = namePath(pops, popId)
      const key = JSON.stringify(path)
      if (!seen.has(key)) seen.set(key, path)
      for (const c of pops.filter((p) => p.parentId === popId)) walk(c.id)
    }
    walk(ROOT_ID)
  }
  return [...seen.values()]
}

export function groupNameOf(wb: Workbench, sampleId: string): string {
  const gid = groupIdOf(wb, sampleId)
  return gid === DEFAULT_GROUP ? DEFAULT_GROUP_NAME : (wb.groups.find((g) => g.id === gid)?.name ?? '')
}

export function computeTable(wb: Workbench, files: Record<string, FcsFile | undefined>, groupId: string, columns: TableColumn[]): TableRow[] {
  return samplesInGroup(wb, groupId).map((s) => {
    const raw = files[s.id]
    const base = { sampleId: s.id, name: s.name, group: groupNameOf(wb, s.id) }
    if (!raw) return { ...base, values: columns.map(() => null) }
    const matrix = wb.compensation.matrices.find((m) => m.id === wb.compensation.assignments[s.id])
    const file = matrix ? compensate(raw, matrix).file : raw
    const pops = populationsFor(wb, s.id)
    const masks = evaluatePopulations(wb, file, s.id)
    const total = file.eventCount
    const values = columns.map((c): number | null => {
      const pop = findByPath(pops, s.id, c.path)
      if (!pop) return null
      const mask = masks.get(pop.id) ?? null
      const count = countMask(mask, total)
      let v: number
      if (c.stat === 'count') v = count
      else if (c.stat === 'freqTotal') v = total ? (count / total) * 100 : NaN
      else if (c.stat === 'freqParent') {
        if (pop.id === ROOT_ID) v = 100
        else {
          const parentCount = countMask(masks.get(pop.parentId ?? ROOT_ID) ?? null, total)
          v = parentCount ? (count / parentCount) * 100 : NaN
        }
      } else {
        const i = c.param ? columnIndex(file, c.param) : -1
        v = i < 0 ? NaN : paramStat(c.stat, file.columns[i], mask, c.pct)
      }
      return Number.isFinite(v) ? v : null
    })
    return { ...base, values }
  })
}

// Mean and sample standard deviation of the values of one column inside each group (for the bar chart).
export interface GroupSummary { group: string; n: number; mean: number | null; sd: number | null; values: { name: string; value: number }[] }

export function summarizeByGroup(rows: TableRow[], col: number): GroupSummary[] {
  const order: string[] = []
  const by = new Map<string, TableRow[]>()
  for (const r of rows) {
    if (!by.has(r.group)) { by.set(r.group, []); order.push(r.group) }
    by.get(r.group)!.push(r)
  }
  return order.map((group) => {
    const values = by.get(group)!.flatMap((r) => (r.values[col] === null ? [] : [{ name: r.name, value: r.values[col] as number }]))
    const n = values.length
    const m = n ? values.reduce((a, b) => a + b.value, 0) / n : null
    const s = n > 1 && m !== null ? Math.sqrt(values.reduce((a, b) => a + (b.value - m) ** 2, 0) / (n - 1)) : null
    return { group, n, mean: m, sd: s, values }
  })
}

// The table as CSV, in the same style as the statistics export.
export function tableToCsv(rows: TableRow[], columns: TableColumn[], o: { decimal: '.' | ','; delimiter: ',' | ';'; bom?: boolean }): string {
  const esc = (v: string): string => (/["\r\n]/.test(v) || v.includes(o.delimiter) ? `"${v.replace(/"/g, '""')}"` : v)
  const num = (v: number | null): string => (v === null ? '' : String(Math.round(v * 1000) / 1000).replace('.', o.decimal))
  const lines = [['Sample', 'Group', ...columns.map(columnLabel)].map(esc).join(o.delimiter)]
  for (const r of rows) lines.push([r.name, r.group, ...r.values.map(num)].map(esc).join(o.delimiter))
  return (o.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n'
}

export function formatStat(stat: StatKind, v: number | null): string {
  if (v === null) return ''
  if (stat === 'count') return Math.round(v).toLocaleString()
  if (stat === 'freqParent' || stat === 'freqTotal' || stat === 'cv') return v.toFixed(2)
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2)
}
