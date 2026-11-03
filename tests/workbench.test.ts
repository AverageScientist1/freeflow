import { describe, it, expect } from 'vitest'
import { emptyWorkbench, evaluatePopulations, parseWorkbench, descendants, nextGateName, ROOT_ID, type Workbench } from '../src/core/workbench'
import { parseFcs } from '../src/core/fcs'
import { makeDemoFcs } from '../src/core/synth'
import { countMask, freqOfParent } from '../src/core/stats'

// Gates in these tests are written as screen positions (0..1), which is how files from before real-value gates store them.
const legacyWb = (): Workbench => ({ ...emptyWorkbench('t'), gateSpace: 'display', linkGates: false })

function withGates(): Workbench {
  const wb = legacyWb()
  // lymphocyte-like cluster in linear scatter space: FSC-A around 80000/262144 = 0.31, SSC-A around 0.1
  wb.gates.push({ id: 'g1', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0.2, y0: 0.0, x1: 0.42, y1: 0.2 } })
  wb.populations.push({ id: 'p1', name: 'Lymphs', parentId: ROOT_ID, gateId: 'g1' })
  // a gate inside p1 on the marker A fluorescence: positive peak sits high on the biex axis
  wb.gates.push({ id: 'g2', xParam: 'FL1-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0.6, y0: 0, x1: 1, y1: 1 } })
  wb.populations.push({ id: 'p2', name: 'A+', parentId: 'p1', gateId: 'g2' })
  return wb
}

describe('population engine', () => {
  const file = parseFcs(makeDemoFcs(3, 5000))
  const wb = withGates()
  const masks = evaluatePopulations(wb, file)

  it('root is every event, children are subsets of their parents', () => {
    expect(masks.get(ROOT_ID)).toBeNull()
    const p1 = masks.get('p1')!
    const p2 = masks.get('p2')!
    const c1 = countMask(p1, file.eventCount)
    const c2 = countMask(p2, file.eventCount)
    expect(c1).toBeGreaterThan(2000)
    expect(c1).toBeLessThan(4000)
    expect(c2).toBeGreaterThan(0)
    expect(c2).toBeLessThan(c1)
    for (let i = 0; i < p2.length; i++) if (p2[i]) expect(p1[i]).toBe(1)
  })

  it('the positive fraction matches what the generator made (about 35%)', () => {
    const f = freqOfParent(countMask(masks.get('p2')!, 0), countMask(masks.get('p1')!, 0))
    expect(f).toBeGreaterThan(25)
    expect(f).toBeLessThan(45)
  })

  it('an unused gate on a missing parameter gives an empty population, not a crash', () => {
    const w2 = withGates()
    w2.gates.push({ id: 'g3', xParam: 'NOPE', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0, y0: 0, x1: 1, y1: 1 } })
    w2.populations.push({ id: 'p3', name: 'X', parentId: ROOT_ID, gateId: 'g3' })
    expect(countMask(evaluatePopulations(w2, file).get('p3')!, 0)).toBe(0)
  })

  it('lists descendants for cascade deletes', () => {
    expect(descendants(wb.populations, 'p1')).toEqual(['p2'])
    expect(descendants(wb.populations, ROOT_ID).sort()).toEqual(['p1', 'p2'])
  })
})

describe('range and ellipse gates in the population engine', () => {
  const file = parseFcs(makeDemoFcs(3, 5000))

  it('a range gate on a positive peak gives about 35% of the parent', () => {
    const wb = legacyWb()
    wb.gates.push({ id: 'r', xParam: 'FL1-A', yParam: '', geometry: { type: 'range', x0: 0.55, x1: 1 } })
    wb.populations.push({ id: 'p', name: 'A+', parentId: ROOT_ID, gateId: 'r' })
    const m = evaluatePopulations(wb, file).get('p')!
    const pct = (countMask(m, 0) / file.eventCount) * 100
    expect(pct).toBeGreaterThan(30)
    expect(pct).toBeLessThan(40)
  })

  it('an ellipse around the main scatter cluster catches most of its events', () => {
    const wb = legacyWb()
    // main cluster: FSC-A about 80000 of 262144 = 0.31, SSC-A about 25000 of 262144 = 0.095
    wb.gates.push({ id: 'e', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'ellipse', cx: 0.31, cy: 0.1, rx: 0.14, ry: 0.07 } })
    wb.populations.push({ id: 'p', name: 'Lymphs', parentId: ROOT_ID, gateId: 'e' })
    const pct = (countMask(evaluatePopulations(wb, file).get('p')!, 0) / file.eventCount) * 100
    expect(pct).toBeGreaterThan(50)
    expect(pct).toBeLessThan(62)
  })

  it('files with the new gate types are accepted and damaged ones refused', () => {
    const wb = legacyWb()
    wb.gates.push({ id: 'r', xParam: 'FL1-A', yParam: '', geometry: { type: 'range', x0: 0.1, x1: 0.2 } })
    wb.gates.push({ id: 'e', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1 } })
    expect(() => parseWorkbench(JSON.stringify(wb))).not.toThrow()
    ;(wb.gates[1].geometry as { rx: number }).rx = 0
    expect(() => parseWorkbench(JSON.stringify(wb))).toThrow(/damaged/)
    ;(wb.gates[1].geometry as { rx: number }).rx = 0.1
    ;(wb.gates[0].geometry as { x1: unknown }).x1 = 'a'
    expect(() => parseWorkbench(JSON.stringify(wb))).toThrow(/damaged/)
  })
})

describe('compensation section of a Workbench file', () => {
  const withMatrix = (): Workbench => {
    const wb = legacyWb()
    wb.samples = [{ id: 's1', name: 'a.fcs', source: { kind: 'demo', seed: 1 } }]
    wb.compensation.matrices = [{ id: 'm1', name: 'M', parameters: ['FL1-A', 'FL2-A'], values: [[1, 0.1], [0, 1]], source: 'manual' }]
    wb.compensation.assignments = { s1: 'm1' }
    return wb
  }

  it('round-trips matrices and assignments', () => {
    const wb = withMatrix()
    expect(parseWorkbench(JSON.stringify(wb)).compensation).toEqual(wb.compensation)
  })

  it('files saved before compensation existed still open, with an empty section', () => {
    const wb = withMatrix() as Partial<Workbench>
    delete wb.compensation
    expect(parseWorkbench(JSON.stringify(wb)).compensation).toEqual({ matrices: [], assignments: {} })
  })

  const bad: [string, (w: Workbench) => void][] = [
    ['a matrix that is not square', (w) => { w.compensation.matrices[0].values = [[1, 0], [0, 1], [0, 0]] }],
    ['a matrix with a non-number', (w) => { (w.compensation.matrices[0].values[0] as unknown[])[1] = 'x' }],
    ['a matrix whose size differs from its parameters', (w) => { w.compensation.matrices[0].parameters = ['FL1-A'] }],
    ['an assignment to a missing matrix', (w) => { w.compensation.assignments = { s1: 'gone' } }],
    ['a compensation section that is not an object', (w) => { (w as unknown as { compensation: unknown }).compensation = 5 }],
  ]
  for (const [name, mutate] of bad)
    it(`refuses ${name}`, () => {
      const w = withMatrix()
      mutate(w)
      expect(() => parseWorkbench(JSON.stringify(w))).toThrow(/damaged/)
    })
})

describe('nextGateName', () => {
  it('fills the first free number instead of counting gates', () => {
    const wb = withGates()
    wb.populations = [wb.populations[0], { id: 'a', name: 'Gate 2', parentId: ROOT_ID, gateId: null }, { id: 'b', name: 'Gate 3', parentId: ROOT_ID, gateId: null }]
    expect(nextGateName(wb.populations)).toBe('Gate 1')
    wb.populations.push({ id: 'c', name: 'Gate 1', parentId: ROOT_ID, gateId: null })
    expect(nextGateName(wb.populations)).toBe('Gate 4')
  })
})

describe('parseWorkbench validation', () => {
  const clone = (): Workbench => JSON.parse(JSON.stringify(withGates()))
  const bad: [string, (w: Workbench) => void][] = [
    ['gate without geometry', (w) => { delete (w.gates[0] as { geometry?: unknown }).geometry }],
    ['rectangle with a non-number', (w) => { (w.gates[0].geometry as { x0: unknown }).x0 = 'a' }],
    ['polygon with two points', (w) => { w.gates[0].geometry = { type: 'polygon', points: [[0, 0], [1, 1]] } }],
    ['population with a missing parent', (w) => { w.populations[1].parentId = 'nope' }],
    ['population pointing at a missing gate', (w) => { w.populations[1].gateId = 'nope' }],
    ['no root population', (w) => { w.populations = w.populations.slice(1) }],
    ['missing transforms', (w) => { delete (w as { transforms?: unknown }).transforms }],
    ['invalid sample', (w) => { w.samples = [{ id: 1 } as never] }],
  ]
  for (const [name, mutate] of bad)
    it(`refuses ${name}`, () => {
      const w = clone()
      mutate(w)
      expect(() => parseWorkbench(JSON.stringify(w))).toThrow(/damaged/)
    })
  it('accepts a good file', () => {
    expect(() => parseWorkbench(JSON.stringify(withGates()))).not.toThrow()
  })
})

describe('workbench file', () => {
  it('round-trips through JSON', () => {
    const wb = withGates()
    expect(parseWorkbench(JSON.stringify(wb))).toEqual(wb)
  })
  it('rejects other JSON', () => {
    expect(() => parseWorkbench('{"a":1}')).toThrow()
    expect(() => parseWorkbench('not json')).toThrow()
  })
})
