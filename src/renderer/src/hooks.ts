import { useMemo } from 'react'
import { evaluatePopulations, scaleFor, columnIndex, populationsFor, ROOT_ID, DEFAULT_GROUP, DEFAULT_GROUP_NAME } from '@core/workbench'
import { transformColumn } from '@core/transform'
import { countMask } from '@core/stats'
import { compensate } from '@core/compensation'
import { findByPath, groupIdOf, namePath, samplesInGroup } from '@core/groups'
import { useStore } from './store'

export interface PopStat {
  count: number
  parentCount: number
}

// Masks and counts for every population of the selected sample, recomputed only when inputs change.
export function useSampleData() {
  const wb = useStore((s) => s.wb)
  const files = useStore((s) => s.files)
  const sampleId = useStore((s) => s.sampleId)
  const scaleVersion = useStore((s) => s.scaleVersion) // the shared default scales change when a sample is added
  const rawFile = sampleId ? files[sampleId] : undefined

  // With a matrix assigned, the sample gains "Comp-" parameters; without one (or if it cannot be applied) it is the file as read.
  const matrixId = sampleId ? wb.compensation.assignments[sampleId] : undefined
  const matrix = matrixId ? wb.compensation.matrices.find((m) => m.id === matrixId) : undefined
  const compensated = useMemo(() => (rawFile && matrix ? compensate(rawFile, matrix) : null), [rawFile, matrix])
  const file = compensated?.file ?? rawFile
  const compError = compensated?.error ?? null

  // this sample's own populations (plus the shared root)
  const pops = useMemo(() => populationsFor(wb, sampleId), [wb.populations, sampleId]) // eslint-disable-line react-hooks/exhaustive-deps

  const masks = useMemo(() => (file ? evaluatePopulations(wb, file, sampleId) : null), [wb.gates, wb.populations, wb.transforms, wb.gateSpace, file, sampleId, scaleVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = useMemo(() => {
    const out = new Map<string, PopStat>()
    if (!file || !masks) return out
    for (const p of pops) {
      const count = countMask(masks.get(p.id) ?? null, file.eventCount)
      const parentCount = p.parentId ? (out.get(p.parentId)?.count ?? file.eventCount) : file.eventCount
      out.set(p.id, { count, parentCount })
    }
    return out
  }, [pops, masks, file])

  return { wb, file, rawFile, matrix, compError, masks, stats, pops }
}

// Display-space columns (0..1) for the two plotted parameters.
export function useAxisColumns(xParam: string, yParam: string) {
  const { wb, file } = useSampleData()
  const scaleVersion = useStore((s) => s.scaleVersion)
  return useMemo(() => {
    if (!file) return null
    const xi = columnIndex(file, xParam)
    const yi = columnIndex(file, yParam)
    if (xi < 0 || yi < 0) return null
    const sx = scaleFor(wb, file, xParam)
    const sy = scaleFor(wb, file, yParam)
    return { xs: transformColumn(file.columns[xi], sx), ys: transformColumn(file.columns[yi], sy), sx, sy }
  }, [wb.transforms, file, xParam, yParam, scaleVersion]) // eslint-disable-line react-hooks/exhaustive-deps
}

export interface GroupRow {
  sampleId: string
  name: string
  count: number | null // null when the sample has no such population or its file is not loaded
  pct: number | null
  note: string | null
}

// The selected population across the samples of the selected sample's group, matched by name path.
export function useGroupTable(): { groupName: string; path: string[]; rows: GroupRow[] } | null {
  const wb = useStore((s) => s.wb)
  const files = useStore((s) => s.files)
  const sampleId = useStore((s) => s.sampleId)
  const popId = useStore((s) => s.popId)
  const scaleVersion = useStore((s) => s.scaleVersion)

  return useMemo(() => {
    if (!sampleId) return null
    const gid = groupIdOf(wb, sampleId)
    const members = samplesInGroup(wb, gid)
    if (members.length < 2) return null
    const path = namePath(populationsFor(wb, sampleId), popId)
    const rows: GroupRow[] = members.map((m) => {
      const raw = files[m.id]
      if (!raw) return { sampleId: m.id, name: m.name, count: null, pct: null, note: 'file not loaded' }
      const matrix = wb.compensation.matrices.find((x) => x.id === wb.compensation.assignments[m.id])
      const file = matrix ? compensate(raw, matrix).file : raw
      const pops = populationsFor(wb, m.id)
      const pop = findByPath(pops, m.id, path)
      if (!pop) return { sampleId: m.id, name: m.name, count: null, pct: null, note: 'no such population' }
      const masks = evaluatePopulations(wb, file, m.id)
      const count = countMask(masks.get(pop.id) ?? null, file.eventCount)
      const parent = pop.id === ROOT_ID ? null : pops.find((p) => p.id === pop.parentId)
      const parentCount = parent ? countMask(masks.get(parent.id) ?? null, file.eventCount) : file.eventCount
      return { sampleId: m.id, name: m.name, count, pct: pop.id === ROOT_ID ? 100 : parentCount ? (count / parentCount) * 100 : null, note: null }
    })
    return { groupName: gid === DEFAULT_GROUP ? DEFAULT_GROUP_NAME : (wb.groups.find((g) => g.id === gid)?.name ?? gid), path, rows }
  }, [wb, files, sampleId, popId, scaleVersion])
}

export { ROOT_ID }
