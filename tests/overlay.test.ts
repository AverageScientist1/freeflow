import { describe, it, expect } from 'vitest'
import { itemsForSamples, normalizeBins, overlayColumns, overlayLabel, smoothBins } from '../src/core/overlay'
import { histogram } from '../src/core/gating'
import { ROOT_ID, emptyWorkbench, parseWorkbench, type Workbench } from '../src/core/workbench'
import { parseFcs } from '../src/core/fcs'
import { makeDemoFcs } from '../src/core/synth'

function build(): { wb: Workbench; files: Record<string, ReturnType<typeof parseFcs>> } {
  const wb = emptyWorkbench('t')
  wb.samples = [
    { id: 's1', name: 'wt.fcs', source: { kind: 'demo', seed: 1 } },
    { id: 's2', name: 'ko.fcs', source: { kind: 'demo', seed: 2 } },
    { id: 's3', name: 'lost.fcs', source: { kind: 'demo', seed: 3 } },
  ]
  wb.gates = [{ id: 'g1', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0, y0: 0, x1: 120000, y1: 60000 } }]
  wb.populations.push({ id: 'p1', name: 'Lymphs', parentId: ROOT_ID, gateId: 'g1', sampleId: 's1' })
  return { wb, files: { s1: parseFcs(makeDemoFcs(1, 5000)), s2: parseFcs(makeDemoFcs(2, 4000)) } }
}

describe('overlay data', () => {
  const { wb, files } = build()

  it('gives the events of a population of another sample on this sample\'s axes', () => {
    const r = overlayColumns(wb, files, { id: 'a', sampleId: 's2', path: [] }, 'FL1-A', null)
    expect(r.note).toBeNull()
    expect(r.data!.events).toBe(4000)
    expect(r.data!.xs.length).toBe(4000)
    expect(r.data!.ys).toBeNull()
    const two = overlayColumns(wb, files, { id: 'a', sampleId: 's1', path: ['Lymphs'] }, 'FSC-A', 'SSC-A')
    expect(two.data!.events).toBeGreaterThan(0)
    expect(two.data!.events).toBeLessThan(5000)
    expect(two.data!.ys!.length).toBe(5000)
    expect(two.data!.mask).not.toBeNull()
  })

  it('says why there is nothing to draw', () => {
    expect(overlayColumns(wb, files, { id: 'a', sampleId: 's3', path: [] }, 'FL1-A', null).note).toMatch(/not loaded/)
    expect(overlayColumns(wb, files, { id: 'a', sampleId: 's2', path: ['Lymphs'] }, 'FL1-A', null).note).toMatch(/no such population/)
    expect(overlayColumns(wb, files, { id: 'a', sampleId: 's2', path: [] }, 'NOPE', null).note).toMatch(/no parameter NOPE/)
  })

  it('uses the same scale for the same parameter, so the same value lands in the same place', () => {
    const a = overlayColumns(wb, files, { id: 'a', sampleId: 's1', path: [] }, 'FL1-A', null).data!
    const b = overlayColumns(wb, files, { id: 'b', sampleId: 's1', path: [] }, 'FL1-A', null).data!
    expect([...a.xs.slice(0, 10)]).toEqual([...b.xs.slice(0, 10)])
    const bins = histogram(a.xs, a.mask, 64)
    expect(bins.reduce((x, y) => x + y, 0)).toBe(5000)
  })

  it('labels an overlay with the sample and the population', () => {
    expect(overlayLabel(wb, { id: 'a', sampleId: 's1', path: ['Lymphs'] })).toBe('wt · Lymphs')
    expect(overlayLabel(wb, { id: 'a', sampleId: 's2', path: [] })).toBe('ko · All events')
  })

  it('offers a population only for the samples that have it', () => {
    let n = 0
    const items = itemsForSamples(wb, ['s1', 's2'], ['Lymphs'], () => `i${n++}`)
    expect(items.map((i) => i.sampleId)).toEqual(['s1'])
    expect(itemsForSamples(wb, ['s1', 's2'], [], () => `x${n++}`).length).toBe(2)
  })
})

describe('curves', () => {
  it('smoothing keeps the total and softens a spike', () => {
    const bins = Float64Array.from([0, 0, 10, 0, 0])
    const s = smoothBins(bins, 1)
    expect([...s]).toEqual([0, 2.5, 5, 2.5, 0])
    expect(smoothBins(bins, 3).reduce((a, b) => a + b, 0)).toBeCloseTo(10, 9)
    expect(smoothBins(bins, 0)).toBe(bins)
  })

  it('normalizing makes the tallest bin 100 and leaves an empty curve alone', () => {
    expect([...normalizeBins(Float64Array.from([1, 4, 2]))]).toEqual([25, 100, 50])
    expect([...normalizeBins(new Float64Array(3))]).toEqual([0, 0, 0])
  })
})
describe('overlays in the Workbench file', () => {
  it('round-trips and refuses a damaged list', () => {
    const wb = emptyWorkbench('t')
    wb.overlays = [{ id: 'a', sampleId: 's1', path: ['Lymphs'] }]
    expect(parseWorkbench(JSON.stringify(wb)).overlays).toEqual(wb.overlays)
    expect(() => parseWorkbench(JSON.stringify({ ...wb, overlays: [{ id: 'a', sampleId: 5, path: [] }] }))).toThrow(/overlay/)
    expect(() => parseWorkbench(JSON.stringify({ ...wb, overlays: [{ id: 'a', sampleId: 's', path: 'x' }] }))).toThrow(/overlay/)
  })
})
