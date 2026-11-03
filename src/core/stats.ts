export function countMask(mask: Uint8Array | null, total: number): number {
  if (!mask) return total
  let c = 0
  for (let i = 0; i < mask.length; i++) if (mask[i]) c++
  return c
}

// Percentage of the parent population, 0 to 100. An empty parent gives NaN, never a fake 0 or 100.
export function freqOfParent(count: number, parentCount: number): number {
  return parentCount === 0 ? NaN : (count / parentCount) * 100
}

function selected(values: Float32Array, mask: Uint8Array | null): Float64Array {
  if (!mask) return Float64Array.from(values)
  let c = 0
  for (let i = 0; i < mask.length; i++) if (mask[i]) c++
  const out = new Float64Array(c)
  let k = 0
  for (let i = 0; i < mask.length; i++) if (mask[i]) out[k++] = values[i]
  return out
}

// Value below which a fraction p (0..100) of the events lie, interpolating between neighbours. NaN with no events.
export function percentile(values: Float32Array, mask: Uint8Array | null, p: number): number {
  const v = selected(values, mask)
  if (v.length === 0 || !Number.isFinite(p)) return NaN
  v.sort()
  const pos = (Math.min(100, Math.max(0, p)) / 100) * (v.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return v[lo] + (v[hi] - v[lo]) * (pos - lo)
}

export function median(values: Float32Array, mask: Uint8Array | null): number {
  return percentile(values, mask, 50)
}

export function mean(values: Float32Array, mask: Uint8Array | null): number {
  const v = selected(values, mask)
  if (v.length === 0) return NaN
  let s = 0
  for (const x of v) s += x
  return s / v.length
}

// Geometric mean of the positive values (the usual definition for fluorescence: zero and negative events cannot be logged).
export function geoMean(values: Float32Array, mask: Uint8Array | null): number {
  const v = selected(values, mask)
  let s = 0
  let n = 0
  for (const x of v) if (x > 0) { s += Math.log(x); n++ }
  return n === 0 ? NaN : Math.exp(s / n)
}

// Sample standard deviation (n - 1). Needs at least two events.
export function sd(values: Float32Array, mask: Uint8Array | null): number {
  const v = selected(values, mask)
  if (v.length < 2) return NaN
  let s = 0
  for (const x of v) s += x
  const m = s / v.length
  let ss = 0
  for (const x of v) ss += (x - m) * (x - m)
  return Math.sqrt(ss / (v.length - 1))
}

// Coefficient of variation in percent (sample standard deviation over the mean).
export function cv(values: Float32Array, mask: Uint8Array | null): number {
  const m = mean(values, mask)
  const s = sd(values, mask)
  return !Number.isFinite(m) || !Number.isFinite(s) || m === 0 ? NaN : (s / m) * 100
}

// The statistics a table column can show. The first three describe the population; the others describe one parameter inside it.
export type StatKind = 'count' | 'freqParent' | 'freqTotal' | 'median' | 'mean' | 'gmean' | 'sd' | 'cv' | 'pctile'

export const STAT_LABELS: Record<StatKind, string> = {
  count: 'Count',
  freqParent: '% of parent',
  freqTotal: '% of total',
  median: 'Median',
  mean: 'Mean',
  gmean: 'Geometric mean',
  sd: 'SD',
  cv: 'CV %',
  pctile: 'Percentile',
}

// One column of a table: a population (names from the first level down; empty is "All events") and a statistic.
export interface TableColumn {
  id: string
  path: string[]
  stat: StatKind
  param?: string // for statistics of a parameter
  pct?: number // for percentile
}

export function validColumns(v: unknown): v is TableColumn[] {
  return Array.isArray(v) && v.every((c) => c && typeof c.id === 'string' && Array.isArray(c.path) && c.path.every((p: unknown) => typeof p === 'string') &&
    Object.keys(STAT_LABELS).includes(c.stat) && (c.param === undefined || typeof c.param === 'string') && (c.pct === undefined || (typeof c.pct === 'number' && Number.isFinite(c.pct))))
}

export const isParamStat =(k: StatKind): boolean => k !== 'count' && k !== 'freqParent' && k !== 'freqTotal'

export function paramStat(kind: StatKind, values: Float32Array, mask: Uint8Array | null, pct = 50): number {
  switch (kind) {
    case 'median': return median(values, mask)
    case 'mean': return mean(values, mask)
    case 'gmean': return geoMean(values, mask)
    case 'sd': return sd(values, mask)
    case 'cv': return cv(values, mask)
    case 'pctile': return percentile(values, mask, pct)
    default: return NaN
  }
}
