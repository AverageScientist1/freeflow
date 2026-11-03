import { afterEach, describe, it, expect } from 'vitest'
import {
  ROOT_ID, defaultSpecFor, emptyWorkbench, evaluatePopulations, parseWorkbench, setDefaultScalePool, upgradeGatesToRealValues,
  type Workbench,
} from '../src/core/workbench'
import { parseFcs, type FcsFile } from '../src/core/fcs'
import { makeDemoFcs, mulberry32, writeFcs } from '../src/core/synth'
import { countMask } from '../src/core/stats'
import type { Gate } from '../src/core/gating'

afterEach(() => setDefaultScalePool([]))

const col = (f: FcsFile, name: string): Float32Array => f.columns[f.parameters.findIndex((p) => p.name === name)]
const countInRange = (v: Float32Array, lo: number, hi: number): number => v.filter((x) => x >= lo && x <= hi).length

function wbWith(gates: Gate[], sampleIds: string[]): Workbench {
  const wb = emptyWorkbench('t')
  wb.samples = sampleIds.map((id) => ({ id, name: `${id}.fcs`, source: { kind: 'demo' as const, seed: 1 } }))
  wb.gates = gates
  gates.forEach((g, i) => {
    for (const s of sampleIds) wb.populations.push({ id: `p${i}-${s}`, name: `Gate ${i + 1}`, parentId: ROOT_ID, gateId: g.id, sampleId: s })
  })
  return wb
}

describe('a gate keeps its thresholds when the axis is drawn differently', () => {
  const file = parseFcs(makeDemoFcs(2, 20000))
  const range: Gate = { id: 'r', xParam: 'FL1-A', yParam: '', geometry: { type: 'range', x0: 3000, x1: 200000 } }
  const rect: Gate = { id: 'q', xParam: 'FL1-A', yParam: 'FL2-A', geometry: { type: 'rectangle', x0: 3000, x1: 200000, y0: -1000, y1: 1000 } }

  it('counts the events between the raw values, not between two positions on the screen', () => {
    const wb = wbWith([range], ['s'])
    const n = countMask(evaluatePopulations(wb, file, 's').get('p0-s')!, 0)
    expect(Math.abs(n - countInRange(col(file, 'FL1-A'), 3000, 200000))).toBeLessThanOrEqual(10)
    expect(n).toBeGreaterThan(5000)
  })

  it('changing the scale (width, extra negative decades, even the type) does not change which events are inside', () => {
    const wb = wbWith([range, rect], ['s'])
    const before = [...evaluatePopulations(wb, file, 's')].filter(([id]) => id !== ROOT_ID).map(([, m]) => countMask(m, 0))
    for (const spec of [
      { type: 'biex' as const, max: 262144, positiveDecades: 4.5, widthDecades: 1.6, extraNegativeDecades: 2.2 },
      { type: 'biex' as const, max: 262144, positiveDecades: 6, widthDecades: 0.3, extraNegativeDecades: 0 },
      { type: 'arcsinh' as const, min: -2000, max: 262144, cofactor: 150 },
    ]) {
      const changed: Workbench = { ...wb, transforms: { 'FL1-A': spec, 'FL2-A': spec } }
      const after = [...evaluatePopulations(changed, file, 's')].filter(([id]) => id !== ROOT_ID).map(([, m]) => countMask(m, 0))
      for (let i = 0; i < before.length; i++) expect(Math.abs(after[i] - before[i])).toBeLessThanOrEqual(10)
    }
  })

  it('a rectangle also keeps the events it had when only one axis changes', () => {
    const wb = wbWith([rect], ['s'])
    const a = countMask(evaluatePopulations(wb, file, 's').get('p0-s')!, 0)
    const b = countMask(evaluatePopulations({ ...wb, transforms: { 'FL2-A': { type: 'biex', max: 262144, positiveDecades: 4.5, widthDecades: 1.9, extraNegativeDecades: 1 } } }, file, 's').get('p0-s')!, 0)
    expect(Math.abs(a - b)).toBeLessThanOrEqual(10)
  })
})

describe('the same gate in another sample is the same threshold', () => {
  // two samples whose fluorescence sits at very different levels, so each would get a different axis on its own
  const lowRand = mulberry32(1)
  const make = (shift: number, n = 6000): FcsFile =>
    parseFcs(writeFcs([{ name: 'FSC-A', range: 16777216 }, { name: 'FL1-H', range: 16777216 }],
      [Float32Array.from({ length: n }, () => 100000 + lowRand() * 100000), Float32Array.from({ length: n }, () => shift * Math.pow(10, lowRand() * 3) - 300 * lowRand())]))
  const wt = make(500)
  const mutant = make(40000)
  const gate: Gate = { id: 'g', xParam: 'FL1-H', yParam: '', geometry: { type: 'range', x0: 1000, x1: 100000 } }

  it('counts exactly the events inside those values in each sample', () => {
    const wb = wbWith([gate], ['wt', 'm'])
    for (const [id, f] of [['wt', wt], ['m', mutant]] as const) {
      const n = countMask(evaluatePopulations(wb, f, id).get(`p0-${id}`)!, 0)
      expect(Math.abs(n - countInRange(col(f, 'FL1-H'), 1000, 100000))).toBeLessThanOrEqual(10)
    }
  })

  it('the baseline sample has most events inside and the shifted one has many outside: the outliers can be read off', () => {
    const wb = wbWith([gate], ['wt', 'm'])
    const inside = (id: string, f: FcsFile): number => countMask(evaluatePopulations(wb, f, id).get(`p0-${id}`)!, 0) / f.eventCount
    expect(inside('wt', wt)).toBeGreaterThan(0.6)
    expect(inside('m', mutant)).toBeLessThan(inside('wt', wt) - 0.2)
  })

  it('every sample shares one default scale for a parameter once they are loaded together', () => {
    const alone = defaultSpecFor(wt, 'FSC-A')
    setDefaultScalePool([wt, mutant])
    const a = defaultSpecFor(wt, 'FSC-A')
    const b = defaultSpecFor(mutant, 'FSC-A')
    expect(a).toEqual(b)
    setDefaultScalePool([])
    expect(defaultSpecFor(wt, 'FSC-A')).toEqual(alone)
  })

  it('the shared scale is wide enough for every sample', () => {
    setDefaultScalePool([wt, mutant])
    const spec = defaultSpecFor(wt, 'FL1-H')
    expect(spec.type).toBe('biex')
    const wide = defaultSpecFor(mutant, 'FL1-H')
    expect(spec).toEqual(wide)
    if (spec.type === 'biex') {
      const alone = (setDefaultScalePool([]), defaultSpecFor(mutant, 'FL1-H'))
      if (alone.type === 'biex') expect(spec.widthDecades).toBeGreaterThanOrEqual(alone.widthDecades)
    }
  })

  it('a parameter only one sample has keeps that sample\'s own default', () => {
    const lone = parseFcs(writeFcs([{ name: 'CD99', range: 262144 }], [Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])]))
    setDefaultScalePool([wt, lone])
    expect(defaultSpecFor(lone, 'CD99').type).toBe('biex')
  })
})

describe('older files (gates measured on the screen) are upgraded', () => {
  const f1 = parseFcs(makeDemoFcs(1, 6000))
  const f2 = parseFcs(makeDemoFcs(2, 6000))
  const files = { s1: f1, s2: f2 }

  function legacy(): Workbench {
    const wb = wbWith([
      { id: 'a', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0.18, y0: 0, x1: 0.45, y1: 0.2 } },
      { id: 'b', xParam: 'FL1-A', yParam: '', geometry: { type: 'range', x0: 0.55, x1: 1 } },
    ], ['s1', 's2'])
    return { ...wb, gateSpace: 'display', linkGates: false }
  }
  // the gate objects are shared between samples in this fixture; give every population its own, as a saved file does
  function owned(): Workbench {
    const wb = legacy()
    const gates: Gate[] = []
    wb.populations = wb.populations.map((p) => {
      if (!p.gateId) return p
      const g = wb.gates.find((x) => x.id === p.gateId)!
      const id = `${g.id}-${p.sampleId}`
      gates.push({ ...g, id })
      return { ...p, gateId: id }
    })
    return { ...wb, gates }
  }

  it('keeps the events each gate had', () => {
    const wb = owned()
    const before = new Map<string, number>()
    for (const s of ['s1', 's2'] as const) for (const [id, m] of evaluatePopulations(wb, files[s], s)) if (id !== ROOT_ID) before.set(id, countMask(m, 0))
    const { wb: up, upgraded } = upgradeGatesToRealValues(wb, files)
    expect(upgraded).toBe(true)
    expect(up.gateSpace).toBe('raw')
    for (const s of ['s1', 's2'] as const) for (const [id, m] of evaluatePopulations(up, files[s], s)) if (id !== ROOT_ID) expect(Math.abs(countMask(m, 0) - before.get(id)!)).toBeLessThanOrEqual(12)
  })

  it('writes real values: a scatter rectangle is in instrument units, not 0..1', () => {
    const { wb: up } = upgradeGatesToRealValues(owned(), files)
    const g = up.gates.find((x) => x.id === 'a-s1')!.geometry as { x1: number }
    expect(g.x1).toBeGreaterThan(10000)
  })

  it('does not convert when a sample file is missing, and the workbench keeps working in the older mode', () => {
    const wb = owned()
    const r = upgradeGatesToRealValues(wb, { s1: f1 })
    expect(r.upgraded).toBe(false)
    expect(r.wb.gateSpace).toBe('display')
    expect(r.wb.gates).toEqual(wb.gates)
    expect(countMask(evaluatePopulations(r.wb, f1, 's1').get('p0-s1')!, 0)).toBeGreaterThan(1000)
  })

  it('a workbench with no gates is simply marked as upgraded', () => {
    const r = upgradeGatesToRealValues({ ...emptyWorkbench('x'), gateSpace: 'display' }, {})
    expect(r.wb.gateSpace).toBe('raw')
  })

  it('leaves an already upgraded workbench alone', () => {
    const wb = emptyWorkbench('x')
    expect(upgradeGatesToRealValues(wb, {})).toEqual({ wb, upgraded: false })
  })

  it('the upgrade does not depend on the shared default scale being on', () => {
    setDefaultScalePool([f1, f2])
    const wb = owned()
    const r = upgradeGatesToRealValues(wb, files)
    expect(r.upgraded).toBe(true)
    // it used each file's own scale, as when the gate was drawn; the pool is back afterwards
    expect(defaultSpecFor(f1, 'FSC-A')).toEqual(defaultSpecFor(f2, 'FSC-A'))
  })
})

describe('the file format', () => {
  it('new workbenches measure gates in real values and link them', () => {
    const wb = emptyWorkbench('x')
    expect([wb.gateSpace, wb.linkGates, wb.version]).toEqual(['raw', true, 3])
  })

  it('files from before default to the screen mode and unlinked', () => {
    const old = JSON.parse(JSON.stringify(emptyWorkbench('x')))
    delete old.gateSpace
    delete old.linkGates
    old.version = 2
    const w = parseWorkbench(JSON.stringify(old))
    expect([w.gateSpace, w.linkGates, w.version]).toEqual(['display', false, 3])
  })

  it('round-trips both settings', () => {
    const wb = { ...emptyWorkbench('x'), linkGates: false }
    expect(parseWorkbench(JSON.stringify(wb))).toEqual(wb)
  })

  it('refuses invalid settings', () => {
    for (const patch of [{ gateSpace: 'sideways' }, { linkGates: 'yes' }]) {
      expect(() => parseWorkbench(JSON.stringify({ ...emptyWorkbench('x'), ...patch }))).toThrow(/damaged/)
    }
  })
})
