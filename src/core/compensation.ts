// Fluorescence compensation. The spillover matrix S follows the FCS convention: row i is the signal of
// detector i spilling into every detector (column j). Observed = true x S, so true = observed x S^-1
// (events are row vectors). Written from the FCS 3.1 specification ($SPILLOVER) and the usual linear model.

import type { FcsFile, FcsParameter } from './fcs'

export interface CompMatrix {
  id: string
  name: string
  parameters: string[] // parameter names, in the order of the rows and columns
  values: number[][] // n x n
  source: 'file' | 'manual'
}

const isNum = (v: number): boolean => Number.isFinite(v)

// $SPILLOVER = "n,P1,...,Pn,s11,s12,...,snn" (row by row). Returns null for anything malformed.
export function parseSpillover(keywords: Record<string, string>, parameters: FcsParameter[] = []): { parameters: string[]; values: number[][] } | null {
  const raw = keywords['$SPILLOVER'] ?? keywords['$SPILL']
  if (raw !== undefined) {
    const t = raw.split(',').map((s) => s.trim())
    const n = Number(t[0])
    if (!Number.isInteger(n) || n < 1 || t.length !== 1 + n + n * n) return null
    const names = t.slice(1, 1 + n)
    if (names.some((s) => s === '') || new Set(names).size !== n) return null
    const nums = t.slice(1 + n).map(Number)
    if (!nums.every(isNum)) return null
    return { parameters: names, values: Array.from({ length: n }, (_, i) => nums.slice(i * n, (i + 1) * n)) }
  }
  // older files: $COMP = "n,s11,...,snn" for the first n parameters, in order
  const comp = keywords['$COMP']
  if (comp !== undefined) {
    const t = comp.split(',').map((s) => s.trim())
    const n = Number(t[0])
    if (!Number.isInteger(n) || n < 1 || t.length !== 1 + n * n || parameters.length < n) return null
    const nums = t.slice(1).map(Number)
    if (!nums.every(isNum)) return null
    return { parameters: parameters.slice(0, n).map((p) => p.name), values: Array.from({ length: n }, (_, i) => nums.slice(i * n, (i + 1) * n)) }
  }
  return null
}

export function isIdentity(values: number[][]): boolean {
  return values.every((row, i) => row.every((v, j) => v === (i === j ? 1 : 0)))
}

// Gauss-Jordan with partial pivoting. Returns null when the matrix cannot be inverted.
export function invert(m: number[][]): number[][] | null {
  const n = m.length
  if (n === 0 || m.some((r) => r.length !== n) || !m.every((r) => r.every(isNum))) return null
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r
    if (Math.abs(a[p][c]) < 1e-12) return null
    ;[a[c], a[p]] = [a[p], a[c]]
    const d = a[c][c]
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = a[r][c]
      if (f !== 0) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j]
    }
  }
  return a.map((r) => r.slice(n))
}

export const COMP_PREFIX = 'Comp-'

export interface Compensated {
  file: FcsFile // the original columns plus a "Comp-<name>" column for every matrix parameter
  error: string | null // when set, file is the uncompensated original
}

const CACHE_PER_FILE = 3
const cache = new WeakMap<FcsFile, Map<string, Compensated>>()

export function compensate(file: FcsFile, matrix: CompMatrix): Compensated {
  const key = JSON.stringify([matrix.parameters, matrix.values])
  let perFile = cache.get(file)
  if (!perFile) { perFile = new Map(); cache.set(file, perFile) }
  const hit = perFile.get(key)
  if (hit) return hit
  const result = compute(file, matrix)
  perFile.set(key, result)
  // editing a matrix many times must not pile up copies of the columns: keep only the latest few
  while (perFile.size > CACHE_PER_FILE) perFile.delete(perFile.keys().next().value as string)
  return result
}

function compute(file: FcsFile, matrix: CompMatrix): Compensated {
  const idx = matrix.parameters.map((name) => file.parameters.findIndex((p) => p.name === name))
  const gone = matrix.parameters.filter((_, i) => idx[i] < 0)
  if (gone.length) return { file, error: `This sample has no parameter named ${gone.join(', ')}` }
  const inv = invert(matrix.values)
  if (!inv) return { file, error: 'The matrix cannot be inverted, so it cannot be applied' }
  const n = idx.length
  const out = idx.map(() => new Float32Array(file.eventCount))
  const v = new Float64Array(n)
  for (let e = 0; e < file.eventCount; e++) {
    for (let i = 0; i < n; i++) v[i] = file.columns[idx[i]][e]
    for (let j = 0; j < n; j++) {
      let s = 0
      for (let i = 0; i < n; i++) s += v[i] * inv[i][j]
      out[j][e] = s
    }
  }
  const extra: FcsParameter[] = idx.map((k, j) => ({ ...file.parameters[k], index: file.parameters.length + j + 1, name: COMP_PREFIX + file.parameters[k].name }))
  return { file: { ...file, parameters: [...file.parameters, ...extra], columns: [...file.columns, ...out] }, error: null }
}
