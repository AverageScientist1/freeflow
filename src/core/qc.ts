// Sample quality control: is the flow of events steady over the acquisition, and did any detector saturate?

import type { FcsFile } from './fcs'
import { percentile } from './stats'

export interface TimeQc {
  timeParam: string | null // null when the file has no time parameter
  seconds: boolean // the time axis is in seconds (the file declares $TIMESTEP), else instrument units
  binStart: number // start of the first bin
  binWidth: number
  rates: number[] // events per bin
  flagged: boolean[] // bins whose rate is far from the usual one
  median: number
  flaggedBins: number
  flaggedEvents: number
  flaggedPercent: number
}

export interface Saturation {
  param: string
  count: number
  percent: number
}

const arr = (a: number[]): Float32Array => Float32Array.from(a)

// Events per time bin, and the bins that look wrong: farther from the median than 3 robust standard deviations
// (from the median absolute deviation), and at least 25% away from it, so a very steady run is not flagged for noise.
export function timeQc(file: FcsFile, bins = 100): TimeQc {
  const i = file.parameters.findIndex((p) => /^time$/i.test(p.name))
  const empty: TimeQc = { timeParam: null, seconds: false, binStart: 0, binWidth: 0, rates: [], flagged: [], median: 0, flaggedBins: 0, flaggedEvents: 0, flaggedPercent: 0 }
  if (i < 0 || file.eventCount < 2) return empty
  const t = file.columns[i]
  let lo = Infinity
  let hi = -Infinity
  for (let k = 0; k < t.length; k++) { if (t[k] < lo) lo = t[k]; if (t[k] > hi) hi = t[k] }
  if (!(hi > lo)) return { ...empty, timeParam: file.parameters[i].name }
  const n = Math.max(5, Math.min(bins, Math.floor(file.eventCount / 20)))
  const width = (hi - lo) / n
  const rates = new Array<number>(n).fill(0)
  for (let k = 0; k < t.length; k++) rates[Math.min(n - 1, Math.floor((t[k] - lo) / width))]++
  const med = percentile(arr(rates), null, 50)
  const mad = percentile(arr(rates.map((r) => Math.abs(r - med))), null, 50)
  const tol = Math.max(3 * 1.4826 * mad, 0.25 * med)
  const flagged = rates.map((r) => Math.abs(r - med) > tol)
  const flaggedEvents = rates.reduce((a, r, k) => a + (flagged[k] ? r : 0), 0)
  const step = parseFloat(file.keywords['$TIMESTEP'] ?? '')
  const seconds = Number.isFinite(step) && step > 0
  const scale = seconds ? step : 1
  return {
    timeParam: file.parameters[i].name,
    seconds,
    binStart: lo * scale,
    binWidth: width * scale,
    rates,
    flagged,
    median: med,
    flaggedBins: flagged.filter(Boolean).length,
    flaggedEvents,
    flaggedPercent: (flaggedEvents / file.eventCount) * 100,
  }
}

// Events sitting at the top of a detector's declared range are cut off (saturated). Only measured parameters are checked.
export function saturation(file: FcsFile): Saturation[] {
  const out: Saturation[] = []
  file.parameters.forEach((p, i) => {
    if (/^time$/i.test(p.name) || !(p.range > 0)) return
    const col = file.columns[i]
    const limit = p.range * 0.999
    let c = 0
    for (let k = 0; k < col.length; k++) if (col[k] >= limit) c++
    if (c > 0) out.push({ param: p.name, count: c, percent: (c / file.eventCount) * 100 })
  })
  return out.sort((a, b) => b.percent - a.percent)
}
