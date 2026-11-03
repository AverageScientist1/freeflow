import { describe, it, expect } from 'vitest'
import { applyGateToGroup, groupDepth, groupSubtree, groupTree, linkedPeers, peersOf, samplesInGroup, syncLinked } from '../src/core/groups'
import { DEFAULT_GROUP, ROOT_ID, emptyWorkbench, parseWorkbench, type Workbench } from '../src/core/workbench'

// Treated (s1, s2) with two subgroups: Low dose (s3, s4) and High dose (s5); s6 is in no group.
function build(): Workbench {
  const wb = emptyWorkbench('t')
  wb.samples = ['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => ({ id, name: `${id}.fcs`, source: { kind: 'demo' as const, seed: 1 } }))
  wb.groups = [{ id: 'T', name: 'Treated' }, { id: 'L', name: 'Low dose', parentId: 'T' }, { id: 'H', name: 'High dose', parentId: 'T' }]
  wb.groupOf = { s1: 'T', s2: 'T', s3: 'L', s4: 'L', s5: 'H' }
  return wb
}

describe('subgroups', () => {
  const wb = build()

  it('a group holds its own samples and those of the groups below it', () => {
    expect(samplesInGroup(wb, 'T').map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5'])
    expect(samplesInGroup(wb, 'L').map((s) => s.id)).toEqual(['s3', 's4'])
    expect(samplesInGroup(wb, DEFAULT_GROUP)).toHaveLength(6)
    expect(groupSubtree(wb, 'T').sort()).toEqual(['H', 'L', 'T'])
  })

  it('lists groups as a tree and knows how deep each sits', () => {
    expect(groupTree(wb).map((g) => `${'-'.repeat(g.depth)}${g.name}`)).toEqual(['Treated', '-Low dose', '-High dose'])
    expect(groupDepth(wb, 'L')).toBe(1)
    expect(groupDepth(wb, 'T')).toBe(0)
  })

  it('linked gating stays inside a subgroup, so each has gates of its own', () => {
    expect(linkedPeers(wb, 's3')).toEqual(['s4'])
    expect(linkedPeers(wb, 's1')).toEqual(['s2']) // not the samples of the subgroups
    expect(linkedPeers(wb, 's5')).toEqual([])
  })

  it('applying from the group above reaches the subgroups, once; they keep their own gating afterwards', () => {
    expect(peersOf(wb, 's1').sort()).toEqual(['s2', 's3', 's4', 's5'])
    expect(peersOf(wb, 's3')).toEqual(['s4'])
    const w = structuredClone(wb)
    w.gates = [{ id: 'g', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0, y0: 0, x1: 1, y1: 1 } }]
    w.populations.push({ id: 'p', name: 'Cells', parentId: ROOT_ID, gateId: 'g', sampleId: 's1' })
    const r = applyGateToGroup(w, 's1', 'p', false)
    expect(r.applied.sort()).toEqual(['s2', 's3', 's4', 's5'])
    const after = { ...w, populations: r.populations, gates: r.gates }
    // a gate drawn later in High dose does not reach Low dose
    after.gates = [...after.gates, { id: 'g2', xParam: 'FL1-A', yParam: '', geometry: { type: 'range', x0: 1, x1: 2 } }]
    after.populations = [...after.populations, { id: 'p2', name: 'Bright', parentId: after.populations.find((p) => p.sampleId === 's3' && p.name === 'Cells')!.id, gateId: 'g2', sampleId: 's3' }]
    const synced = syncLinked(after, 's3')
    expect(synced.populations.filter((p) => p.sampleId === 's4' && p.name === 'Bright')).toHaveLength(1)
    expect(synced.populations.filter((p) => p.sampleId === 's5' && p.name === 'Bright')).toHaveLength(0)
    expect(synced.populations.filter((p) => p.sampleId === 's1' && p.name === 'Bright')).toHaveLength(0)
  })
})

describe('subgroups in a Workbench file', () => {
  it('round-trip', () => {
    expect(parseWorkbench(JSON.stringify(build())).groups.map((g) => g.parentId ?? null)).toEqual([null, 'T', 'T'])
  })
  it('a subgroup of a missing group, of itself, or in a loop is refused', () => {
    const bad = (mutate: (w: Workbench) => void): string => { const w = build(); mutate(w); return JSON.stringify(w) }
    expect(() => parseWorkbench(bad((w) => { w.groups[1].parentId = 'nope' }))).toThrow(/subgroup/)
    expect(() => parseWorkbench(bad((w) => { w.groups[1].parentId = 'L' }))).toThrow(/subgroup/)
    expect(() => parseWorkbench(bad((w) => { w.groups[0].parentId = 'L' }))).toThrow(/loop/)
  })
})