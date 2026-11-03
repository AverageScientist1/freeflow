// Cluster Explorer data: the events of one population from one or several samples (virtually concatenated, each sample
// cut down to the same number of events), on the scale the plots use, plus k-means clustering and a summary per cluster.

import type { FcsFile } from './fcs'
import { compensate } from './compensation'
import { findByPath } from './groups'
import { transformColumn } from './transform'
import { mulberry32 } from './synth'
import { columnIndex, evaluatePopulations, populationsFor, scaleFor, type Workbench } from './workbench'

export interface ClusterInput {
  n: number
  d: number
  data: Float32Array // n rows of d values, each parameter on the 0..1 scale of the plots
  sample: Uint16Array // index into `sampleIds` for every row
  sampleIds: string[]
  params: string[]
  skipped: { sampleId: string; reason: string }[] // samples that could not contribute
}

// Takes up to `perSample` events of the population `path` from each sample (evenly spread, not just the first ones), so
// every sample weighs the same and the picture is not dominated by the biggest file.
export function buildClusterInput(wb: Workbench, files: Record<string, FcsFile | undefined>, sampleIds: string[], path: string[], params: string[], perSample: number, seed = 1): ClusterInput {
  const rows: Float32Array[] = []
  const owner: number[] = []
  const used: string[] = []
  const skipped: ClusterInput['skipped'] = []
  const rand = mulberry32(seed)
  for (const sid of sampleIds) {
    const raw = files[sid]
    if (!raw) { skipped.push({ sampleId: sid, reason: 'its file is not loaded' }); continue }
    const matrix = wb.compensation.matrices.find((m) => m.id === wb.compensation.assignments[sid])
    const file = matrix ? compensate(raw, matrix).file : raw
    const pop = findByPath(populationsFor(wb, sid), sid, path)
    if (!pop) { skipped.push({ sampleId: sid, reason: 'it has no such population' }); continue }
    const idx = params.map((p) => columnIndex(file, p))
    const missing = params.find((_, i) => idx[i] < 0)
    if (missing) { skipped.push({ sampleId: sid, reason: `it has no parameter ${missing}` }); continue }
    const mask = evaluatePopulations(wb, file, sid).get(pop.id) ?? null
    const cols = params.map((p, i) => transformColumn(file.columns[idx[i]], scaleFor(wb, file, p)))
    const members: number[] = []
    for (let e = 0; e < file.eventCount; e++) if (!mask || mask[e]) members.push(e)
    // a seeded partial shuffle keeps the choice repeatable
    const take = Math.min(perSample, members.length)
    for (let k = 0; k < take; k++) {
      const j = k + Math.floor(rand() * (members.length - k))
      ;[members[k], members[j]] = [members[j], members[k]]
    }
    const chosen = members.slice(0, take).sort((a, b) => a - b)
    const row = used.length
    used.push(sid)
    for (const e of chosen) {
      const r = new Float32Array(params.length)
      for (let c = 0; c < params.length; c++) r[c] = cols[c][e]
      rows.push(r)
      owner.push(row)
    }
  }
  const d = params.length
  const data = new Float32Array(rows.length * d)
  rows.forEach((r, i) => data.set(r, i * d))
  return { n: rows.length, d, data, sample: Uint16Array.from(owner), sampleIds: used, params, skipped }
}

export interface KMeans { labels: Uint16Array; centroids: Float64Array; iterations: number }

// k-means with k-means++ starting points, on rows of `data`. Repeatable for a given seed.
export function kmeans(data: Float32Array, n: number, d: number, k: number, seed = 1, maxIter = 60): KMeans {
  const kk = Math.max(1, Math.min(k, n))
  const rand = mulberry32(seed)
  const cent = new Float64Array(kk * d)
  const dist2 = (i: number, c: number): number => {
    let s = 0
    for (let j = 0; j < d; j++) { const v = data[i * d + j] - cent[c * d + j]; s += v * v }
    return s
  }
  const first = Math.floor(rand() * n)
  for (let j = 0; j < d; j++) cent[j] = data[first * d + j]
  const best = new Float64Array(n).fill(Infinity)
  for (let c = 1; c < kk; c++) {
    let total = 0
    for (let i = 0; i < n; i++) { best[i] = Math.min(best[i], dist2(i, c - 1)); total += best[i] }
    let pick = rand() * total
    let chosen = n - 1
    for (let i = 0; i < n; i++) { pick -= best[i]; if (pick <= 0) { chosen = i; break } }
    for (let j = 0; j < d; j++) cent[c * d + j] = data[chosen * d + j]
  }
  const labels = new Uint16Array(n)
  let it = 0
  for (; it < maxIter; it++) {
    let changed = 0
    for (let i = 0; i < n; i++) {
      let bc = 0
      let bd = Infinity
      for (let c = 0; c < kk; c++) { const v = dist2(i, c); if (v < bd) { bd = v; bc = c } }
      if (labels[i] !== bc || it === 0) { labels[i] = bc; changed++ }
    }
    const sum = new Float64Array(kk * d)
    const cnt = new Uint32Array(kk)
    for (let i = 0; i < n; i++) { cnt[labels[i]]++; for (let j = 0; j < d; j++) sum[labels[i] * d + j] += data[i * d + j] }
    for (let c = 0; c < kk; c++) if (cnt[c]) for (let j = 0; j < d; j++) cent[c * d + j] = sum[c * d + j] / cnt[c]
    if (changed === 0) break
  }
  return { labels, centroids: cent, iterations: it }
}

export interface ClusterSummary {
  k: number
  counts: number[] // events per cluster
  median: number[][] // [cluster][parameter] median on the 0..1 scale
  bySample: number[][] // [cluster][sample] events
}

export function summarizeClusters(input: ClusterInput, labels: Uint16Array, k: number): ClusterSummary {
  const counts = new Array<number>(k).fill(0)
  const bySample = Array.from({ length: k }, () => new Array<number>(input.sampleIds.length).fill(0))
  const values: number[][][] = Array.from({ length: k }, () => Array.from({ length: input.d }, () => []))
  for (let i = 0; i < input.n; i++) {
    const c = labels[i]
    counts[c]++
    bySample[c][input.sample[i]]++
    for (let j = 0; j < input.d; j++) values[c][j].push(input.data[i * input.d + j])
  }
  const med = (v: number[]): number => {
    if (v.length === 0) return NaN
    const s = [...v].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  return { k, counts, median: values.map((row) => row.map(med)), bySample }
}

// Each parameter's cluster medians turned into scores around the mean of the clusters (a z-score), for colouring a heat map.
export function zScores(median: number[][]): number[][] {
  const k = median.length
  const d = k ? median[0].length : 0
  const out = median.map((r) => r.map(() => 0))
  for (let j = 0; j < d; j++) {
    const col = median.map((r) => r[j]).filter((v) => Number.isFinite(v))
    const m = col.reduce((a, b) => a + b, 0) / (col.length || 1)
    const s = Math.sqrt(col.reduce((a, b) => a + (b - m) ** 2, 0) / (col.length || 1))
    for (let c = 0; c < k; c++) out[c][j] = s > 1e-9 && Number.isFinite(median[c][j]) ? (median[c][j] - m) / s : 0
  }
  return out
}

// The embedding, the clusters and the events as CSV (one row per event) for use in other programs.
export function clusterCsv(input: ClusterInput, names: string[], embedding: Float32Array, labels: Uint16Array | null, sampleName: (id: string) => string, o: { decimal: '.' | ','; delimiter: ',' | ';'; bom?: boolean }): string {
  const esc = (v: string): string => (/["\r\n]/.test(v) || v.includes(o.delimiter) ? `"${v.replace(/"/g, '""')}"` : v)
  const num = (v: number): string => String(Math.round(v * 10000) / 10000).replace('.', o.decimal)
  const head = ['Sample', 'Embedding 1', 'Embedding 2', ...(labels ? ['Cluster'] : []), ...names]
  const lines = [head.map(esc).join(o.delimiter)]
  for (let i = 0; i < input.n; i++) {
    const row = [sampleName(input.sampleIds[input.sample[i]]), num(embedding[i * 2]), num(embedding[i * 2 + 1])]
    if (labels) row.push(String(labels[i] + 1))
    for (let j = 0; j < input.d; j++) row.push(num(input.data[i * input.d + j]))
    lines.push(row.map(esc).join(o.delimiter))
  }
  return (o.bom ? '﻿' : '') + lines.join('\r\n') + '\r\n'
}
