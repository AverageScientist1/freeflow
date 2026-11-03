import { describe, it, expect } from 'vitest'
import { cv, geoMean, mean, median, percentile, sd } from '../src/core/stats'
import { computeTable, populationPaths, summarizeByGroup, tableToCsv, type TableColumn } from '../src/core/table'
import { saturation, timeQc } from '../src/core/qc'
import { ROOT_ID, emptyWorkbench, parseWorkbench, type Workbench } from '../src/core/workbench'
import { parseFcs } from '../src/core/fcs'
import { makeDemoFcs } from '../src/core/synth'

const f = (...v: number[]): Float32Array => Float32Array.from(v)

describe('statistics of a parameter', () => {
  it('computes mean, median, SD and CV by hand-checkable values', () => {
    const v = f(2, 4, 4, 4, 5, 5, 7, 9)
    expect(mean(v, null)).toBe(5)
    expect(median(v, null)).toBe(4.5)
    expect(sd(v, null)).toBeCloseTo(2.138, 3)
    expect(cv(v, null)).toBeCloseTo(42.76, 2)
  })

  it('geometric mean ignores values that cannot be logged', () => {
    expect(geoMean(f(1, 10, 100, 0, -5), null)).toBeCloseTo(10, 9)
    expect(geoMean(f(0, -1), null)).toBeNaN()
  })

  it('percentiles interpolate and clamp', () => {
    const v = f(10, 20, 30, 40)
    expect(percentile(v, null, 0)).toBe(10)
    expect(percentile(v, null, 100)).toBe(40)
    expect(percentile(v, null, 50)).toBe(25)
    expect(percentile(v, null, 150)).toBe(40)
  })

  it('only looks at events inside the mask', () => {
    const v = f(1, 100, 3, 100)
    const mask = Uint8Array.from([1, 0, 1, 0])
    expect(mean(v, mask)).toBe(2)
    expect(median(v, mask)).toBe(2)
  })

  it('has no answer for no events, or one event where spread is asked', () => {
    expect(mean(f(), null)).toBeNaN()
    expect(median(f(), null)).toBeNaN()
    expect(sd(f(5), null)).toBeNaN()
    expect(cv(f(0, 0), null)).toBeNaN()
  })
})

function build(): { wb: Workbench; files: Record<string, ReturnType<typeof parseFcs>> } {
  const wb = emptyWorkbench('t')
  wb.samples = [
    { id: 's1', name: 'wt.fcs', source: { kind: 'demo', seed: 1 } },
    { id: 's2', name: 'ko.fcs', source: { kind: 'demo', seed: 2 } },
    { id: 's3', name: 'gone.fcs', source: { kind: 'demo', seed: 3 } },
  ]
  wb.groups = [{ id: 'g', name: 'Treated' }]
  wb.groupOf = { s2: 'g' }
  wb.gates = [{ id: 'g1', xParam: 'FL1-A', yParam: '', geometry: { type: 'range', x0: 1000, x1: 1e7 } }]
  wb.populations.push({ id: 'p1', name: 'FITC+', parentId: ROOT_ID, gateId: 'g1', sampleId: 's1' })
  return { wb, files: { s1: parseFcs(makeDemoFcs(1, 4000)), s2: parseFcs(makeDemoFcs(2, 3000)) } }
}

describe('table of statistics', () => {
  const { wb, files } = build()
  const cols: TableColumn[] = [
    { id: 'a', path: [], stat: 'count' },
    { id: 'b', path: ['FITC+'], stat: 'freqParent' },
    { id: 'c', path: ['FITC+'], stat: 'freqTotal' },
    { id: 'd', path: [], stat: 'median', param: 'FSC-A' },
    { id: 'e', path: ['FITC+'], stat: 'mean', param: 'NOPE' },
  ]
  const rows = computeTable(wb, files, 'all', cols)

  it('has one row per sample in the group, and empty cells where there is nothing to say', () => {
    expect(rows.map((r) => r.name)).toEqual(['wt.fcs', 'ko.fcs', 'gone.fcs'])
    expect(rows[0].values[0]).toBe(4000)
    expect(rows[1].values[0]).toBe(3000)
    expect(rows[1].values[1]).toBeNull() // ko has no FITC+ population
    expect(rows[2].values.every((v) => v === null)).toBe(true) // file not loaded
    expect(rows[0].values[4]).toBeNull() // unknown parameter
  })

  it('percentages relate to the right population', () => {
    const [parent, total] = [rows[0].values[1] as number, rows[0].values[2] as number]
    expect(parent).toBeGreaterThan(0)
    expect(parent).toBeCloseTo(total, 9) // the parent of FITC+ is all events
    expect(rows[0].values[3]).toBeGreaterThan(0)
  })

  it('a group limits the rows and names the group', () => {
    const r = computeTable(wb, files, 'g', cols)
    expect(r.map((x) => x.name)).toEqual(['ko.fcs'])
    expect(r[0].group).toBe('Treated')
  })

  it('lists populations from all samples once', () => {
    expect(populationPaths(wb, ['s1', 's2']).map((p) => p.join('/'))).toEqual(['', 'FITC+'])
  })

  it('summarizes by group with mean and SD, skipping empty cells', () => {
    const sum = summarizeByGroup([
      { sampleId: 'a', name: 'a', group: 'X', values: [10] },
      { sampleId: 'b', name: 'b', group: 'X', values: [20] },
      { sampleId: 'c', name: 'c', group: 'X', values: [null] },
      { sampleId: 'd', name: 'd', group: 'Y', values: [5] },
    ], 0)
    expect(sum[0]).toMatchObject({ group: 'X', n: 2, mean: 15 })
    expect(sum[0].sd).toBeCloseTo(7.071, 3)
    expect(sum[1]).toMatchObject({ group: 'Y', n: 1, mean: 5, sd: null })
  })

  it('writes CSV with the decimal comma and quoting', () => {
    const csv = tableToCsv(
      [{ sampleId: 'a', name: 'a,b.fcs', group: 'G', values: [1.5, null] }],
      [{ id: 'x', path: [], stat: 'count' }, { id: 'y', path: ['A'], stat: 'median', param: 'FL1-A' }],
      { decimal: ',', delimiter: ';', bom: false },
    )
    expect(csv).toBe('Sample;Group;All events | Count;A | Median | FL1-A\r\na,b.fcs;G;1,5;\r\n')
  })
})

describe('table in the Workbench file', () => {
  it('round-trips and rejects a damaged definition', () => {
    const wb = emptyWorkbench('t')
    wb.table = [{ id: 'a', path: ['X'], stat: 'median', param: 'FL1-A' }]
    expect(parseWorkbench(JSON.stringify(wb)).table).toEqual(wb.table)
    const bad = JSON.stringify({ ...wb, table: [{ id: 'a', path: [], stat: 'nonsense' }] })
    expect(() => parseWorkbench(bad)).toThrow(/table/)
  })
})

describe('quality control', () => {
  it('finds a stretch where events stop coming', () => {
    const file = parseFcs(makeDemoFcs(1, 20000))
    const ti = file.parameters.findIndex((p) => /^time$/i.test(p.name))
    expect(ti).toBeGreaterThanOrEqual(0)
    const qc = timeQc(file)
    expect(qc.timeParam).not.toBeNull()
    expect(qc.rates.reduce((a, b) => a + b, 0)).toBe(20000)
    expect(qc.flaggedPercent).toBeLessThan(10) // the demo data flows steadily
    // drop most events of the middle of the run
    const t = file.columns[ti]
    const lo = Math.min(...t)
    const hi = Math.max(...t)
    const keep: number[] = []
    for (let i = 0; i < t.length; i++) {
      const mid = t[i] > lo + (hi - lo) * 0.4 && t[i] < lo + (hi - lo) * 0.6
      if (!mid || i % 10 === 0) keep.push(i)
    }
    const cut = { ...file, eventCount: keep.length, columns: file.columns.map((c) => Float32Array.from(keep, (i) => c[i])) }
    const bad = timeQc(cut)
    expect(bad.flaggedBins).toBeGreaterThanOrEqual(10)
    expect(bad.flaggedPercent).toBeGreaterThan(0)
  })

  it('says so when there is no time parameter', () => {
    const file = parseFcs(makeDemoFcs(1, 500))
    const noTime = { ...file, parameters: file.parameters.map((p) => ({ ...p, name: p.name === 'Time' ? 'T2' : p.name })) }
    expect(timeQc(noTime).timeParam).toBeNull()
  })

  it('counts events cut off at the top of a detector', () => {
    const file = parseFcs(makeDemoFcs(1, 1000))
    const i = file.parameters.findIndex((p) => /^FSC-A$/.test(p.name))
    const col = Float32Array.from(file.columns[i])
    for (let k = 0; k < 10; k++) col[k] = file.parameters[i].range
    const cols = file.columns.map((c, j) => (j === i ? col : c))
    const sat = saturation({ ...file, columns: cols })
    expect(sat.find((s) => s.param === 'FSC-A')?.count).toBeGreaterThanOrEqual(10)
  })
})
