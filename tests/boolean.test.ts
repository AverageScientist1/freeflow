import { describe, it, expect } from 'vitest'
import { ROOT_ID, combineMasks, emptyWorkbench, evaluatePopulations, parseWorkbench, type Workbench } from '../src/core/workbench'
import { applyGateToGroup, gatingDiffers } from '../src/core/groups'
import { countMask } from '../src/core/stats'
import { parseFcs } from '../src/core/fcs'
import { makeDemoFcs } from '../src/core/synth'

const m = (...v: number[]): Uint8Array => Uint8Array.from(v)

describe('combining masks', () => {
  it('and, or and not', () => {
    const a = m(1, 1, 0, 0)
    const b = m(1, 0, 1, 0)
    expect([...combineMasks('and', [a, b], null, 4)]).toEqual([1, 0, 0, 0])
    expect([...combineMasks('or', [a, b], null, 4)]).toEqual([1, 1, 1, 0])
    expect([...combineMasks('not', [a], null, 4)]).toEqual([0, 0, 1, 1])
  })

  it('never leaves the parent, and a null operand means every event', () => {
    const parent = m(1, 1, 0, 0)
    expect([...combineMasks('or', [m(0, 0, 0, 0), null], parent, 4)]).toEqual([1, 1, 0, 0])
    expect([...combineMasks('not', [m(1, 0, 0, 0)], parent, 4)]).toEqual([0, 1, 0, 0])
  })
})

function build(): { wb: Workbench; file: ReturnType<typeof parseFcs> } {
  const wb = emptyWorkbench('t')
  wb.samples = [{ id: 's1', name: 'a', source: { kind: 'demo', seed: 1 } }, { id: 's2', name: 'b', source: { kind: 'demo', seed: 2 } }]
  wb.gates = [
    { id: 'g1', xParam: 'FL1-A', yParam: '', geometry: { type: 'range', x0: 1000, x1: 1e7 } },
    { id: 'g2', xParam: 'FL2-A', yParam: '', geometry: { type: 'range', x0: 1000, x1: 1e7 } },
  ]
  wb.populations.push(
    // the boolean is listed BEFORE its operands on purpose: order in the file must not matter
    { id: 'b', name: 'Both', parentId: ROOT_ID, gateId: null, sampleId: 's1', bool: { op: 'and', operands: ['p1', 'p2'] } },
    { id: 'p1', name: 'FL1+', parentId: ROOT_ID, gateId: 'g1', sampleId: 's1' },
    { id: 'p2', name: 'FL2+', parentId: ROOT_ID, gateId: 'g2', sampleId: 's1' },
  )
  return { wb, file: parseFcs(makeDemoFcs(1, 6000)) }
}

describe('boolean populations in a Workbench', () => {
  it('counts what is in both, regardless of listing order', () => {
    const { wb, file } = build()
    const masks = evaluatePopulations(wb, file, 's1')
    const [a, b, both] = ['p1', 'p2', 'b'].map((id) => masks.get(id)!)
    let expected = 0
    for (let i = 0; i < file.eventCount; i++) if (a[i] && b[i]) expected++
    expect(countMask(both, file.eventCount)).toBe(expected)
    expect(expected).toBeGreaterThan(0)
    expect(expected).toBeLessThan(countMask(a, file.eventCount))
  })

  it('a boolean with the wrong number of operands counts nothing', () => {
    const { wb, file } = build()
    wb.populations[1].bool = { op: 'and', operands: ['p1'] }
    expect(countMask(evaluatePopulations(wb, file, 's1').get('b')!, file.eventCount)).toBe(0)
  })

  it('is saved and read back, and a damaged one is refused', () => {
    const { wb } = build()
    expect(parseWorkbench(JSON.stringify(wb)).populations.find((p) => p.id === 'b')?.bool).toEqual({ op: 'and', operands: ['p1', 'p2'] })
    for (const bad of [{ op: 'xor', operands: ['p1', 'p2'] }, { op: 'and', operands: ['p1'] }, { op: 'not', operands: ['p1', 'p2'] }, { op: 'and', operands: ['p1', 'nope'] }, { op: 'and', operands: ['b', 'p1'] }]) {
      const copy = structuredClone(wb)
      copy.populations[1].bool = bad as never
      expect(() => parseWorkbench(JSON.stringify(copy)), JSON.stringify(bad)).toThrow(/boolean/)
    }
  })

  it('applying to a group copies it pointing at the copies of its operands', () => {
    const { wb } = build()
    const r = applyGateToGroup(wb, 's1', ROOT_ID, true, ['s2'])
    const mine = r.populations.filter((p) => p.sampleId === 's2')
    const copy = mine.find((p) => p.name === 'Both')!
    const ops = copy.bool!.operands.map((id) => mine.find((p) => p.id === id)?.name).sort()
    expect(ops).toEqual(['FL1+', 'FL2+'])
    expect(copy.bool!.operands).not.toContain('p1') // not the source's populations
    const after = { ...wb, populations: r.populations, gates: r.gates }
    expect(gatingDiffers(after, 's1', 's2')).toBe(false)
    // changing the operation makes the samples differ
    after.populations = after.populations.map((p) => (p.id === copy.id ? { ...p, bool: { op: 'or' as const, operands: p.bool!.operands } } : p))
    expect(gatingDiffers(after, 's1', 's2')).toBe(true)
  })
})
