import { describe, it, expect } from 'vitest'
import { csvOptionsFor, statsRows, toCsv, type StatsRow } from '../src/core/export'
import { ROOT_ID, emptyWorkbench, type Workbench } from '../src/core/workbench'
import { parseFcs } from '../src/core/fcs'
import { makeDemoFcs, writeFcs } from '../src/core/synth'

// Gates in these tests are written as screen positions (0..1), which is how files from before real-value gates store them.
const legacyWb = (): Workbench => ({ ...emptyWorkbench('t'), gateSpace: 'display', linkGates: false })

function build(): { wb: Workbench; files: Record<string, ReturnType<typeof parseFcs>> } {
  const wb = legacyWb()
  wb.samples = [
    { id: 's1', name: 'a, "one".fcs', source: { kind: 'demo', seed: 1 } },
    { id: 's2', name: 'b.fcs', source: { kind: 'demo', seed: 2 } },
  ]
  wb.groups = [{ id: 'g', name: 'Treated' }]
  wb.groupOf = { s2: 'g' }
  wb.gates = [
    { id: 'g1', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0.18, y0: 0, x1: 0.45, y1: 0.2 } },
    { id: 'g2', xParam: 'FL1-A', yParam: '', geometry: { type: 'range', x0: 0.55, x1: 1 } },
  ]
  wb.populations.push(
    { id: 'p1', name: 'Lymphs', parentId: ROOT_ID, gateId: 'g1', sampleId: 's1' },
    { id: 'p2', name: 'A+', parentId: 'p1', gateId: 'g2', sampleId: 's1' },
  )
  return { wb, files: { s1: parseFcs(makeDemoFcs(1, 4000)), s2: parseFcs(makeDemoFcs(2, 3000)) } }
}

describe('statistics table', () => {
  const { wb, files } = build()
  const rows = statsRows(wb, files)

  it('has the root and every population of every sample, parents before children', () => {
    expect(rows.filter((r) => r.sample === 'b.fcs').map((r) => r.population)).toEqual(['All events'])
    expect(rows.filter((r) => r.sample.startsWith('a,')).map((r) => r.population)).toEqual(['All events', 'Lymphs', 'A+'])
  })

  it('counts and shares are consistent', () => {
    const a = rows.filter((r) => r.sample.startsWith('a,'))
    expect(a[0].events).toBe(4000)
    expect(a[0].pctParent).toBe(100)
    expect(a[1].pctParent).toBeCloseTo((a[1].events / 4000) * 100, 9)
    expect(a[2].pctParent).toBeCloseTo((a[2].events / a[1].events) * 100, 9)
    expect(a[2].pctTotal).toBeCloseTo((a[2].events / 4000) * 100, 9)
    expect(a[2].pctTotal!).toBeLessThan(a[2].pctParent!)
  })

  it('writes the path of a nested population and the group of each sample', () => {
    expect(rows.find((r) => r.population === 'A+')!.path).toBe('Lymphs / A+')
    expect(rows.find((r) => r.sample === 'b.fcs')!.group).toBe('Treated')
    expect(rows.find((r) => r.sample.startsWith('a,'))!.group).toBe('All Samples')
  })

  it('skips a sample whose file is not loaded instead of failing', () => {
    expect(statsRows(wb, { s1: files.s1 }).some((r) => r.sample === 'b.fcs')).toBe(false)
  })

  it('leaves the share empty (not 0 or 100) when the parent has no events', () => {
    const w = build().wb
    w.gates.push({ id: 'g3', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0.95, y0: 0.95, x1: 1, y1: 1 } })
    w.populations.push({ id: 'p3', name: 'Empty', parentId: ROOT_ID, gateId: 'g3', sampleId: 's1' }, { id: 'p4', name: 'Below empty', parentId: 'p3', gateId: 'g1', sampleId: 's1' })
    const r = statsRows(w, files)
    expect(r.find((x) => x.population === 'Empty')!.events).toBe(0)
    expect(r.find((x) => x.population === 'Below empty')!.pctParent).toBeNull()
  })

  it('uses the compensated values when a matrix is applied', () => {
    const w = build().wb
    w.compensation.matrices = [{ id: 'm', name: 'm', parameters: ['FL1-A', 'FL2-A'], values: [[1, 0.2], [0.05, 1]], source: 'manual' }]
    w.compensation.assignments = { s1: 'm' }
    w.gates.push({ id: 'g4', xParam: 'Comp-FL1-A', yParam: 'Comp-FL2-A', geometry: { type: 'rectangle', x0: 0, y0: 0, x1: 1, y1: 1 } })
    w.populations.push({ id: 'p5', name: 'Compensated', parentId: ROOT_ID, gateId: 'g4', sampleId: 's1' })
    const r = statsRows(w, files)
    expect(r.find((x) => x.population === 'Compensated')!.events).toBeGreaterThan(0) // the Comp- parameters exist for this sample
  })

  it('handles a workbench with no samples', () => {
    expect(statsRows(emptyWorkbench('x'), {})).toEqual([])
  })
})

describe('CSV text', () => {
  const rows: StatsRow[] = [
    { sample: 'a, "one".fcs', group: 'All Samples', population: 'Lymphs', path: 'Lymphs', events: 1234, pctParent: 12.345, pctTotal: 12.345 },
    { sample: 'café.fcs', group: 'G', population: 'Empty', path: 'Empty', events: 0, pctParent: null, pctTotal: 0 },
  ]

  it('uses commas and dots for an English-style computer', () => {
    const csv = toCsv(rows, csvOptionsFor('.'))
    const lines = csv.replace('﻿', '').split('\r\n')
    expect(lines[0]).toBe('Sample,Group,Population,Path,Events,% of parent,% of total')
    expect(lines[1]).toBe('"a, ""one"".fcs",All Samples,Lymphs,Lymphs,1234,12.35,12.35')
  })

  it('uses semicolons and decimal commas where the computer writes decimals with a comma (Excel in Spanish)', () => {
    const csv = toCsv(rows, csvOptionsFor(','))
    const lines = csv.replace('﻿', '').split('\r\n')
    expect(lines[0]).toBe('Sample;Group;Population;Path;Events;% of parent;% of total')
    expect(lines[1]).toBe('"a, ""one"".fcs";All Samples;Lymphs;Lymphs;1234;12,35;12,35')
  })

  it('writes an empty cell, not NaN, for a missing share', () => {
    expect(toCsv(rows, csvOptionsFor('.'))).not.toMatch(/NaN|null|undefined/)
    expect(toCsv(rows, csvOptionsFor('.')).split('\r\n')[2]).toBe('café.fcs,G,Empty,Empty,0,,0.00')
  })

  it('starts with a byte-order mark so accents survive in Excel, and ends with a line break', () => {
    const csv = toCsv(rows, csvOptionsFor('.'))
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('quotes values with line breaks', () => {
    const csv = toCsv([{ ...rows[0], population: 'two\nlines' }], { decimal: '.', delimiter: ',' })
    expect(csv).toContain('"two\nlines"')
  })

  it('has just the header for no rows', () => {
    expect(toCsv([], { decimal: '.', delimiter: ',' })).toBe('Sample,Group,Population,Path,Events,% of parent,% of total\r\n')
  })

  it('works with a one-event file', () => {
    const f = parseFcs(writeFcs([{ name: 'FSC-A', range: 1 }, { name: 'SSC-A', range: 1 }], [[0.5], [0.5]]))
    const wb = legacyWb()
    wb.samples = [{ id: 's', name: 'one.fcs', source: { kind: 'demo', seed: 1 } }]
    expect(statsRows(wb, { s: f })[0].events).toBe(1)
  })
})
