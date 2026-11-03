import { describe, it, expect } from 'vitest'
import { tilesFromGates } from '../src/core/sheet'
import { ROOT_ID, emptyWorkbench, parseWorkbench, type Workbench } from '../src/core/workbench'

function build(): Workbench {
  const wb = emptyWorkbench('t')
  wb.samples = [{ id: 's1', name: 'a', source: { kind: 'demo', seed: 1 } }]
  wb.gates = [
    { id: 'g1', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0, y0: 0, x1: 1, y1: 1 } },
    { id: 'g2', xParam: 'FL1-A', yParam: 'FL2-A', geometry: { type: 'quadrant', cx: 1, cy: 1, q: 'ne', link: 'L' } },
    { id: 'g3', xParam: 'FL1-A', yParam: 'FL2-A', geometry: { type: 'quadrant', cx: 1, cy: 1, q: 'nw', link: 'L' } },
    { id: 'g4', xParam: 'FL1-A', yParam: '', geometry: { type: 'range', x0: 1, x1: 2 } },
  ]
  wb.populations.push(
    { id: 'p1', name: 'Cells', parentId: ROOT_ID, gateId: 'g1', sampleId: 's1' },
    { id: 'p2', name: 'A+B+', parentId: 'p1', gateId: 'g2', sampleId: 's1' },
    { id: 'p3', name: 'A-B+', parentId: 'p1', gateId: 'g3', sampleId: 's1' },
    { id: 'p4', name: 'A+', parentId: 'p2', gateId: 'g4', sampleId: 's1' },
    { id: 'pb', name: 'Either', parentId: ROOT_ID, gateId: null, sampleId: 's1', bool: { op: 'or', operands: ['p2', 'p3'] } },
  )
  return wb
}

describe('sheet from gates', () => {
  it('makes one plot per gate on its parent, merging the quarters of a quadrant, in tree order', () => {
    let n = 0
    const tiles = tilesFromGates(build(), 's1', () => `t${n++}`)
    expect(tiles.map((t) => [t.path.join('/'), t.x, t.y, t.plot])).toEqual([
      ['', 'FSC-A', 'SSC-A', 'pseudocolor'],
      ['Cells', 'FL1-A', 'FL2-A', 'pseudocolor'],
      ['Cells/A+B+', 'FL1-A', '', 'histogram'],
    ])
    expect(new Set(tiles.map((t) => t.id)).size).toBe(3)
  })

  it('is empty for a sample without gates', () => {
    expect(tilesFromGates(emptyWorkbench('t'), 's1', () => 'x')).toEqual([])
  })
})

describe('sheet in the Workbench file', () => {
  it('round-trips and refuses a damaged one', () => {
    const wb = emptyWorkbench('t')
    wb.sheet = [{ id: 'a', path: ['Cells'], x: 'FSC-A', y: 'SSC-A', plot: 'zebra' }]
    expect(parseWorkbench(JSON.stringify(wb)).sheet).toEqual(wb.sheet)
    expect(() => parseWorkbench(JSON.stringify({ ...wb, sheet: [{ id: 'a', path: [], x: 'x', y: 'y', plot: 'bubble' }] }))).toThrow(/sheet/)
    expect(() => parseWorkbench(JSON.stringify({ ...wb, sheet: [{ id: 'a', path: 'Cells', x: 'x', y: 'y', plot: 'zebra' }] }))).toThrow(/sheet/)
  })
})