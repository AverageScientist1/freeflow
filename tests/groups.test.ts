import { describe, it, expect } from 'vitest'
import { adoptGroupGating, applyGateToGroup, findByPath, gatingDiffers, groupIdOf, linkedPeers, namePath, peersOf, samplesInGroup, syncLinked } from '../src/core/groups'
import { DEFAULT_GROUP, ROOT_ID, emptyWorkbench, evaluatePopulations, parseWorkbench, populationsFor, type Population, type Workbench } from '../src/core/workbench'
import { parseFcs } from '../src/core/fcs'
import { makeDemoFcs } from '../src/core/synth'
import { countMask } from '../src/core/stats'

// Gates in these tests are written as screen positions (0..1), which is how files from before real-value gates store them.
const legacyWb = (): Workbench => ({ ...emptyWorkbench('t'), gateSpace: 'display', linkGates: false })

// three samples; s1 has a tree: "Gate A" (scatter rectangle) > "Child B" (range on FL1-A)
function build(): Workbench {
  const wb = legacyWb()
  wb.samples = ['s1', 's2', 's3'].map((id, i) => ({ id, name: `${id}.fcs`, source: { kind: 'demo' as const, seed: i + 1 } }))
  wb.gates = [
    { id: 'gA', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0.18, y0: 0, x1: 0.45, y1: 0.2 } },
    { id: 'gB', xParam: 'FL1-A', yParam: '', geometry: { type: 'range', x0: 0.55, x1: 1 } },
  ]
  wb.populations.push(
    { id: 'pA', name: 'Gate A', parentId: ROOT_ID, gateId: 'gA', sampleId: 's1' },
    { id: 'pB', name: 'Child B', parentId: 'pA', gateId: 'gB', sampleId: 's1' },
  )
  return wb
}

const own = (wb: Workbench, s: string): Population[] => wb.populations.filter((p) => p.sampleId === s)
const apply = (wb: Workbench, popId: string, resync = false, source = 's1'): Workbench => {
  const r = applyGateToGroup(wb, source, popId, resync)
  return { ...wb, populations: r.populations, gates: r.gates }
}

describe('groups', () => {
  it('every sample is in All Samples; custom groups hold only their members', () => {
    const wb = build()
    wb.groups = [{ id: 'g1', name: 'Treated' }]
    wb.groupOf = { s1: 'g1', s2: 'g1' }
    expect(groupIdOf(wb, 's3')).toBe(DEFAULT_GROUP)
    expect(groupIdOf(wb, 's1')).toBe('g1')
    expect(samplesInGroup(wb, DEFAULT_GROUP).map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(samplesInGroup(wb, 'g1').map((s) => s.id)).toEqual(['s1', 's2'])
    expect(peersOf(wb, 's1')).toEqual(['s2'])
    expect(peersOf(wb, 's3')).toEqual(['s1', 's2']) // not in a custom group: every other sample
  })

  it('a membership that points to a missing group counts as no group', () => {
    const wb = build()
    wb.groupOf = { s1: 'gone' }
    expect(groupIdOf(wb, 's1')).toBe(DEFAULT_GROUP)
  })

  it('finds populations by their name path', () => {
    const wb = build()
    expect(namePath(wb.populations, 'pB')).toEqual(['Gate A', 'Child B'])
    expect(namePath(wb.populations, ROOT_ID)).toEqual([])
    expect(findByPath(wb.populations, 's1', ['Gate A', 'Child B'])?.id).toBe('pB')
    expect(findByPath(wb.populations, 's2', ['Gate A'])).toBeUndefined()
    expect(findByPath(wb.populations, 's2', [])?.id).toBe(ROOT_ID)
  })
})

describe('apply gate to group', () => {
  it('copies the population and its children to the other samples, leaving the source alone', () => {
    const wb = apply(build(), 'pA')
    for (const s of ['s2', 's3']) {
      const mine = own(wb, s)
      expect(mine.map((p) => p.name)).toEqual(['Gate A', 'Child B'])
      expect(mine[0].parentId).toBe(ROOT_ID)
      expect(mine[1].parentId).toBe(mine[0].id) // the child hangs under the copy, not under the original
    }
    expect(own(wb, 's1').map((p) => p.id)).toEqual(['pA', 'pB'])
    expect(wb.gates.length).toBe(2 + 2 * 2) // every copy has its own gates
  })

  it('copies are independent: changing one gate does not change the others', () => {
    const wb = apply(build(), 'pA')
    const copyGate = wb.gates.find((g) => g.id === own(wb, 's2')[0].gateId)!
    ;(copyGate.geometry as { x1: number }).x1 = 0.99
    expect((wb.gates.find((g) => g.id === 'gA')!.geometry as { x1: number }).x1).toBe(0.45)
    const s3 = wb.gates.find((g) => g.id === own(wb, 's3')[0].gateId)!
    expect((s3.geometry as { x1: number }).x1).toBe(0.45)
  })

  it('replaces a population with the same name and drops what was below it', () => {
    let wb = build()
    wb.gates.push({ id: 'old', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0, y0: 0, x1: 0.1, y1: 0.1 } })
    wb.populations.push(
      { id: 'oA', name: 'Gate A', parentId: ROOT_ID, gateId: 'old', sampleId: 's2' },
      { id: 'oX', name: 'Leftover', parentId: 'oA', gateId: null, sampleId: 's2' },
      { id: 'oZ', name: 'Other', parentId: ROOT_ID, gateId: null, sampleId: 's2' },
    )
    wb = apply(wb, 'pA')
    const names = own(wb, 's2').map((p) => p.name)
    expect(names.filter((n) => n === 'Gate A')).toHaveLength(1)
    expect(names).not.toContain('Leftover')
    expect(names).toContain('Other') // a different population is not touched
    expect(names).toContain('Child B')
    expect(wb.gates.some((g) => g.id === 'old')).toBe(false) // the replaced gate is not left behind
  })

  it('applying a child needs its parent in the other samples, and says which ones lack it', () => {
    const r = applyGateToGroup(build(), 's1', 'pB', false)
    expect(r.applied).toEqual([])
    expect(r.skipped.map((s) => s.sampleId)).toEqual(['s2', 's3'])
    expect(r.skipped[0].reason).toMatch(/Gate A/)
  })

  it('applying a child works once the parent exists there, and replaces the old child', () => {
    let wb = apply(build(), 'pA')
    ;(wb.gates.find((g) => g.id === 'gB')!.geometry as { x0: number }).x0 = 0.7
    wb = apply(wb, 'pB')
    for (const s of ['s2', 's3']) {
      const kids = own(wb, s).filter((p) => p.name === 'Child B')
      expect(kids).toHaveLength(1)
      expect((wb.gates.find((g) => g.id === kids[0].gateId)!.geometry as { x0: number }).x0).toBe(0.7)
    }
  })

  it('only the samples of the custom group receive it', () => {
    const wb0 = build()
    wb0.groups = [{ id: 'g1', name: 'Treated' }]
    wb0.groupOf = { s1: 'g1', s2: 'g1' }
    const wb = apply(wb0, 'pA')
    expect(own(wb, 's2')).toHaveLength(2)
    expect(own(wb, 's3')).toHaveLength(0)
  })

  it('does nothing when there are no other samples or the population is the root', () => {
    const single = build()
    single.samples = [single.samples[0]]
    expect(applyGateToGroup(single, 's1', 'pA', false).applied).toEqual([])
    const r = applyGateToGroup(build(), 's1', ROOT_ID, false)
    expect(r.applied).toEqual([])
    expect(r.populations).toEqual(build().populations)
  })

  it('applying twice does not duplicate anything', () => {
    const once = apply(build(), 'pA')
    const twice = apply(once, 'pA')
    expect(own(twice, 's2')).toHaveLength(2)
    expect(twice.gates).toHaveLength(once.gates.length)
  })

  it('a copy counts the same events as the original when the data is the same', () => {
    const file = parseFcs(makeDemoFcs(7, 4000))
    const wb = apply(build(), 'pA')
    const m1 = evaluatePopulations(wb, file, 's1')
    const m2 = evaluatePopulations(wb, file, 's2')
    const find = (s: string, name: string): Population => own(wb, s).find((p) => p.name === name)!
    for (const name of ['Gate A', 'Child B']) {
      expect(countMask(m2.get(find('s2', name).id)!, 0)).toBe(countMask(m1.get(find('s1', name).id)!, 0))
    }
    expect(countMask(m1.get('pA')!, 0)).toBeGreaterThan(1000)
  })
})

describe('linked gating', () => {
  const linked = (): Workbench => ({ ...build(), linkGates: true })

  it('links a sample to the others of its custom group, or to the other ungrouped samples', () => {
    const wb = linked()
    wb.groups = [{ id: 'g1', name: 'Pair' }]
    wb.groupOf = { s1: 'g1', s2: 'g1' }
    expect(linkedPeers(wb, 's1')).toEqual(['s2'])
    expect(linkedPeers(wb, 's3')).toEqual([]) // s3 is the only sample outside the group
    const free = linked()
    expect(linkedPeers(free, 's1')).toEqual(['s2', 's3'])
  })

  it('mirrors the gating of the edited sample to its peers, leaving the edited one untouched', () => {
    const wb = syncLinked(linked(), 's1')
    expect(own(wb, 's1').map((p) => p.id)).toEqual(['pA', 'pB'])
    for (const s of ['s2', 's3']) {
      expect(own(wb, s).map((p) => p.name)).toEqual(['Gate A', 'Child B'])
      const gates = own(wb, s).map((p) => wb.gates.find((g) => g.id === p.gateId)!.geometry)
      expect(gates).toEqual([wb.gates.find((g) => g.id === 'gA')!.geometry, wb.gates.find((g) => g.id === 'gB')!.geometry]) // the same values
    }
  })

  it('mirrors a deletion and a rename too', () => {
    let wb = syncLinked(linked(), 's1')
    wb = { ...wb, populations: wb.populations.map((p) => (p.id === 'pA' ? { ...p, name: 'Renamed' } : p)) }
    wb = syncLinked(wb, 's1')
    expect(own(wb, 's2').map((p) => p.name)).toEqual(['Renamed', 'Child B'])
    wb = { ...wb, populations: wb.populations.filter((p) => p.sampleId !== 's1' || p.id === ROOT_ID) }
    wb = syncLinked(wb, 's1')
    expect(own(wb, 's2')).toHaveLength(0)
    expect(own(wb, 's3')).toHaveLength(0)
  })

  it('does nothing when linking is off, there are no peers, or no sample is given', () => {
    expect(syncLinked({ ...build(), linkGates: false }, 's1').populations).toEqual(build().populations)
    const single = linked()
    single.samples = [single.samples[0]]
    expect(syncLinked(single, 's1')).toBe(single)
    expect(syncLinked(linked(), null).populations).toEqual(linked().populations)
  })

  it('only touches the family of the edited sample', () => {
    const wb = linked()
    wb.groups = [{ id: 'g1', name: 'Pair' }]
    wb.groupOf = { s1: 'g1', s2: 'g1' }
    wb.populations.push({ id: 'keep', name: 'Mine', parentId: ROOT_ID, gateId: null, sampleId: 's3' })
    const after = syncLinked(wb, 's1')
    expect(own(after, 's2').map((p) => p.name)).toEqual(['Gate A', 'Child B'])
    expect(own(after, 's3').map((p) => p.name)).toEqual(['Mine']) // s3 is not in the group
  })

  it('a sample that joins takes the gating the group already has', () => {
    const wb = adoptGroupGating(syncLinked(linked(), 's1'), 's3')
    expect(own(wb, 's3').map((p) => p.name)).toEqual(['Gate A', 'Child B'])
    expect({ ...build(), linkGates: false }.linkGates).toBe(false)
    expect(adoptGroupGating({ ...build(), linkGates: false }, 's3').populations).toEqual(build().populations)
    const alone = linked()
    alone.samples = [alone.samples[2]]
    expect(adoptGroupGating(alone, 's3')).toBe(alone)
  })

  it('syncing twice gives the same result, with no growth', () => {
    const once = syncLinked(linked(), 's1')
    const twice = syncLinked(once, 's1')
    expect(twice.populations).toHaveLength(once.populations.length)
    expect(twice.gates).toHaveLength(once.gates.length)
  })

  it('tells whether two samples have different gating, ignoring ids and quadrant links', () => {
    const wb = syncLinked(linked(), 's1')
    expect(gatingDiffers(wb, 's1', 's2')).toBe(false)
    const moved = { ...wb, gates: wb.gates.map((g) => (g.id === own(wb, 's2')[0].gateId ? { ...g, geometry: { type: 'rectangle' as const, x0: 0, y0: 0, x1: 0.1, y1: 0.1 } } : g)) }
    expect(gatingDiffers(moved, 's1', 's2')).toBe(true)
    expect(gatingDiffers(linked(), 's1', 's2')).toBe(true) // s2 has nothing
  })

  it('keeps every gate of a mirrored quadrant on a link of its own per sample', () => {
    const wb = linked()
    for (const q of ['nw', 'ne', 'se', 'sw'] as const) {
      wb.gates.push({ id: `q-${q}`, xParam: 'FL1-A', yParam: 'FL2-A', geometry: { type: 'quadrant', cx: 5000, cy: 5000, q, link: 'L1' } })
      wb.populations.push({ id: `pq-${q}`, name: `Q ${q}`, parentId: ROOT_ID, gateId: `q-${q}`, sampleId: 's1' })
    }
    const after = syncLinked(wb, 's1')
    const linkOf = (s: string): Set<string> => new Set(own(after, s).filter((p) => p.name.startsWith('Q ')).map((p) => (after.gates.find((g) => g.id === p.gateId)!.geometry as { link: string }).link))
    expect(linkOf('s2').size).toBe(1)
    expect(linkOf('s3').size).toBe(1)
    expect([...linkOf('s2')][0]).not.toBe([...linkOf('s3')][0])
    expect([...linkOf('s2')][0]).not.toBe('L1')
  })
})

describe('quadrant gates and groups', () => {
  function withQuadrant(): Workbench {
    const wb = build()
    const link = 'L1'
    for (const q of ['nw', 'ne', 'se', 'sw'] as const) {
      wb.gates.push({ id: `g-${q}`, xParam: 'FL1-A', yParam: 'FL2-A', geometry: { type: 'quadrant', cx: 0.5, cy: 0.5, q, link } })
      wb.populations.push({ id: `p-${q}`, name: `Q ${q}`, parentId: 'pA', gateId: `g-${q}`, sampleId: 's1' })
    }
    return wb
  }

  it('applying one quarter brings all four, each copy with a link of its own', () => {
    const wb = apply(withQuadrant(), 'p-ne')
    // 'Gate A' must exist first in the others for the quarters to have a parent
    const withParent = apply(apply(withQuadrant(), 'pA'), 'p-ne')
    for (const s of ['s2', 's3']) {
      const quarters = own(withParent, s).filter((p) => p.name.startsWith('Q '))
      expect(quarters.map((p) => p.name).sort()).toEqual(['Q ne', 'Q nw', 'Q se', 'Q sw'])
      const links = new Set(quarters.map((p) => (withParent.gates.find((g) => g.id === p.gateId)!.geometry as { link: string }).link))
      expect(links.size).toBe(1)
      expect([...links][0]).not.toBe('L1')
    }
    const l2 = (withParent.gates.find((g) => g.id === own(withParent, 's2').find((p) => p.name === 'Q ne')!.gateId)!.geometry as { link: string }).link
    const l3 = (withParent.gates.find((g) => g.id === own(withParent, 's3').find((p) => p.name === 'Q ne')!.gateId)!.geometry as { link: string }).link
    expect(l2).not.toBe(l3) // two samples never share a crosshair
    expect(own(wb, 's2')).toHaveLength(0) // without the parent present, nothing was applied
  })
})

describe('resync', () => {
  it('gives the other samples exactly the source tree and removes what they had', () => {
    let wb = build()
    wb.populations.push({ id: 'x1', name: 'Mine only', parentId: ROOT_ID, gateId: null, sampleId: 's2' })
    wb = apply(wb, 'pA', true)
    for (const s of ['s2', 's3']) expect(own(wb, s).map((p) => p.name)).toEqual(['Gate A', 'Child B'])
    expect(own(wb, 's1').map((p) => p.id)).toEqual(['pA', 'pB'])
  })

  it('leaves no unused gates behind', () => {
    let wb = build()
    wb = apply(wb, 'pA')
    wb = apply(wb, 'pA', true)
    const used = new Set(wb.populations.map((p) => p.gateId).filter(Boolean))
    expect(wb.gates.every((g) => used.has(g.id))).toBe(true)
    expect(wb.gates).toHaveLength(6)
  })

  it('works when the source has no gating: the others are emptied', () => {
    let wb = apply(build(), 'pA')
    wb = { ...wb, populations: wb.populations.filter((p) => p.sampleId !== 's1'), gates: wb.gates.filter((g) => !['gA', 'gB'].includes(g.id)) }
    wb = apply(wb, ROOT_ID, true)
    expect(own(wb, 's2')).toHaveLength(0)
    expect(own(wb, 's3')).toHaveLength(0)
  })
})

describe('older Workbench files', () => {
  it('give every sample its own copy of the shared gating', () => {
    const wb = build()
    wb.populations = [wb.populations[0], { id: 'pA', name: 'Gate A', parentId: ROOT_ID, gateId: 'gA' }, { id: 'pB', name: 'Child B', parentId: 'pA', gateId: 'gB' }]
    const old = { ...wb, version: 1 } as unknown as Record<string, unknown>
    delete old.groups
    delete old.groupOf
    const loaded = parseWorkbench(JSON.stringify(old))
    expect(loaded.version).toBe(3)
    expect(loaded.groups).toEqual([])
    for (const s of ['s1', 's2', 's3']) {
      const mine = own(loaded, s)
      expect(mine.map((p) => p.name)).toEqual(['Gate A', 'Child B'])
      expect(mine[1].parentId).toBe(mine[0].id)
    }
    expect(new Set(loaded.populations.map((p) => p.id)).size).toBe(loaded.populations.length)
    expect(loaded.gates).toHaveLength(6)
    expect(populationsFor(loaded, 's2').map((p) => p.name)).toEqual(['All events', 'Gate A', 'Child B'])
  })

  it('keep shared gating as it is when there are no samples to give copies to', () => {
    const wb = legacyWb()
    wb.gates = [{ id: 'gA', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0, y0: 0, x1: 1, y1: 1 } }]
    wb.populations.push({ id: 'pA', name: 'Gate A', parentId: ROOT_ID, gateId: 'gA' })
    expect(parseWorkbench(JSON.stringify(wb)).populations).toHaveLength(2)
  })

  const bad: [string, (w: Workbench) => void][] = [
    ['a sample in a missing group', (w) => { w.groupOf = { s1: 'nope' } }],
    ['a group that uses the reserved id', (w) => { w.groups = [{ id: DEFAULT_GROUP, name: 'x' }] }],
    ['a population of a missing sample', (w) => { w.populations[1].sampleId = 'ghost' }],
    ['a population under another sample\'s population', (w) => { w.populations[2].sampleId = 's2' }],
    ['groups that are not a list', (w) => { (w as unknown as { groups: unknown }).groups = 5 }],
  ]
  for (const [name, mutate] of bad)
    it(`refuse ${name}`, () => {
      const w = build()
      mutate(w)
      expect(() => parseWorkbench(JSON.stringify(w))).toThrow(/damaged/)
    })

  it('round-trip groups and per-sample populations', () => {
    const wb = build()
    wb.groups = [{ id: 'g1', name: 'Treated' }]
    wb.groupOf = { s2: 'g1' }
    expect(parseWorkbench(JSON.stringify(wb))).toEqual(wb)
  })
})
