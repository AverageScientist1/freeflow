// Groups and "apply gate to group". Each sample owns its gating tree; applying copies a tree (or part of it)
// to the other samples of the group, so each sample can still be adjusted on its own afterwards.

import {
  DEFAULT_GROUP, ROOT_ID, descendants, newId,
  type Population, type SampleRef, type Workbench,
} from './workbench'
import type { Gate } from './gating'

export function groupIdOf(wb: Pick<Workbench, 'groups' | 'groupOf'>, sampleId: string): string {
  const g = wb.groupOf[sampleId]
  return g && wb.groups.some((x) => x.id === g) ? g : DEFAULT_GROUP
}

// How many groups sit above this one (0 for a top-level group).
export function groupDepth(wb: Pick<Workbench, 'groups'>, groupId: string): number {
  let depth = 0
  let cur = wb.groups.find((g) => g.id === groupId)
  while (cur?.parentId) { depth++; cur = wb.groups.find((g) => g.id === cur!.parentId); if (depth > 50) break }
  return depth
}

// The group and every group below it (its subgroups, their subgroups, and so on).
export function groupSubtree(wb: Pick<Workbench, 'groups'>, groupId: string): string[] {
  const out = [groupId]
  for (let i = 0; i < out.length; i++) for (const g of wb.groups) if (g.parentId === out[i] && !out.includes(g.id)) out.push(g.id)
  return out
}

// Groups as a tree read top to bottom: each group followed by its subgroups, with how deep it sits.
export function groupTree(wb: Pick<Workbench, 'groups'>): { id: string; name: string; depth: number }[] {
  const out: { id: string; name: string; depth: number }[] = []
  const known = new Set(wb.groups.map((g) => g.id))
  const walk = (parent: string | null, depth: number): void => {
    for (const g of wb.groups) {
      const p = g.parentId && known.has(g.parentId) ? g.parentId : null
      if (p === parent && !out.some((o) => o.id === g.id)) { out.push({ id: g.id, name: g.name, depth }); walk(g.id, depth + 1) }
    }
  }
  walk(null, 0)
  return out
}

// The names of a group and of the groups it sits in, from the top: "NCP1 › October 30".
export function groupPathName(wb: Pick<Workbench, 'groups'>, groupId: string): string {
  const parts: string[] = []
  let cur = wb.groups.find((g) => g.id === groupId)
  while (cur && parts.length < 20) { parts.unshift(cur.name); const p: string | null | undefined = cur.parentId; cur = p ? wb.groups.find((g) => g.id === p) : undefined }
  return parts.join(' › ')
}

// The groups as a tree, with what it takes to draw the branches: whether each group is the last of its siblings, and for every level above
// it whether that level still has siblings coming (a vertical line is drawn through the rows between them).
export interface GroupLine { id: string; name: string; depth: number; isLast: boolean; guides: boolean[]; hasChildren: boolean; parent: string | null }

export function groupTreeLines(wb: Pick<Workbench, 'groups'>): GroupLine[] {
  const known = new Set(wb.groups.map((g) => g.id))
  const kids = (parent: string | null) => wb.groups.filter((g) => ((g.parentId && known.has(g.parentId) ? g.parentId : null) === parent))
  const out: GroupLine[] = []
  const walk = (parent: string | null, depth: number, guides: boolean[]): void => {
    const list = kids(parent)
    list.forEach((g, i) => {
      if (out.some((o) => o.id === g.id)) return
      const isLast = i === list.length - 1
      out.push({ id: g.id, name: g.name, depth, isLast, guides, hasChildren: kids(g.id).length > 0, parent })
      walk(g.id, depth + 1, [...guides, !isLast])
    })
  }
  walk(null, 0, [])
  return out
}

// "All Samples" holds every sample; a group holds the samples assigned to it and to the groups below it.
export function samplesInGroup(wb: Pick<Workbench, 'samples' | 'groups' | 'groupOf'>, groupId: string): SampleRef[] {
  if (groupId === DEFAULT_GROUP) return wb.samples
  const ids = new Set(groupSubtree(wb, groupId))
  return wb.samples.filter((s) => ids.has(groupIdOf(wb, s.id)))
}

// The samples a gate is applied to: the others of the sample's custom group, or every other sample when it has none.
export function peersOf(wb: Pick<Workbench, 'samples' | 'groups' | 'groupOf'>, sampleId: string): string[] {
  return samplesInGroup(wb, groupIdOf(wb, sampleId)).map((s) => s.id).filter((id) => id !== sampleId)
}

// Names from the first level below the root down to the population. Empty for the root.
export function namePath(pops: Population[], id: string): string[] {
  const out: string[] = []
  let cur = pops.find((p) => p.id === id)
  while (cur && cur.id !== ROOT_ID) {
    out.unshift(cur.name)
    cur = pops.find((p) => p.id === cur!.parentId)
  }
  return out
}

// The population of a sample reached by following names from the root. An empty path is the root.
export function findByPath(pops: Population[], sampleId: string, path: string[]): Population | undefined {
  let cur = pops.find((p) => p.id === ROOT_ID)
  for (const name of path) {
    if (!cur) return undefined
    const parentId: string = cur.id
    cur = pops.find((p) => p.parentId === parentId && p.name === name && (p.sampleId === sampleId || p.sampleId == null))
  }
  return cur
}

export interface ApplyResult {
  populations: Population[]
  gates: Gate[]
  applied: string[] // sample ids that received the gating
  skipped: { sampleId: string; reason: string }[]
}

// Copies the selected population and everything below it to the other samples of the group.
// A population with the same name under the same parent is replaced. With resync, the other samples lose their
// whole gating tree first and receive the source sample's whole tree instead.
export function applyGateToGroup(wb: Workbench, sourceSampleId: string, popId: string, resync: boolean, targets?: string[]): ApplyResult {
  const mine = wb.populations.filter((p) => p.id !== ROOT_ID && (p.sampleId === sourceSampleId || p.sampleId == null))
  const selected = mine.find((p) => p.id === popId)
  if (!resync && !selected) return { populations: wb.populations, gates: wb.gates, applied: [], skipped: [] }

  const gateById = (id: string | null): Gate | undefined => (id ? wb.gates.find((g) => g.id === id) : undefined)
  // The four quarters of a quadrant gate travel together; anything else travels alone.
  const tops: Population[] = resync ? [] : [selected!]
  const selGate = !resync ? gateById(selected!.gateId) : undefined
  if (selGate?.geometry.type === 'quadrant') {
    const link = selGate.geometry.link
    for (const p of mine) {
      const g = gateById(p.gateId)
      if (p.id !== selected!.id && p.parentId === selected!.parentId && g?.geometry.type === 'quadrant' && g.geometry.link === link) tops.push(p)
    }
  }
  const ordered = resync ? mine : tops.flatMap((t) => [t, ...descendants(mine, t.id).map((id) => mine.find((p) => p.id === id)!)])
  const parentPath = !resync && selected!.parentId ? namePath(wb.populations, selected!.parentId) : []
  let pops = [...wb.populations]
  const applied: string[] = []
  const skipped: ApplyResult['skipped'] = []
  const gateOf = (id: string | null): Gate | undefined => (id ? wb.gates.find((g) => g.id === id) : undefined)
  const newGates: Gate[] = []

  for (const target of targets ?? peersOf(wb, sourceSampleId)) {
    let parentForCopy: string = ROOT_ID
    if (resync) {
      pops = pops.filter((p) => p.id === ROOT_ID || p.sampleId !== target)
    } else {
      const parent = findByPath(pops, target, parentPath)
      if (!parent) { skipped.push({ sampleId: target, reason: `it has no "${parentPath.join(' / ')}" population to put the gate under` }); continue }
      parentForCopy = parent.id
      for (const top of tops) {
        const existing = pops.find((p) => p.sampleId === target && p.parentId === parent.id && p.name === top.name)
        if (existing) {
          const gone = new Set([existing.id, ...descendants(pops, existing.id)])
          pops = pops.filter((p) => !gone.has(p.id))
        }
      }
    }
    const ids = new Map<string, string>()
    const links = new Map<string, string>() // each copy of a quadrant gate gets its own link
    for (const p of ordered) {
      const id = newId()
      ids.set(p.id, id)
      const isTop = resync ? p.parentId === ROOT_ID : tops.some((t) => t.id === p.id)
      const g = gateOf(p.gateId)
      let gateId: string | null = null
      if (g) {
        gateId = newId()
        const geometry = structuredClone(g.geometry)
        if (geometry.type === 'quadrant') {
          if (!links.has(geometry.link)) links.set(geometry.link, newId())
          geometry.link = links.get(geometry.link)!
        }
        newGates.push({ ...g, id: gateId, geometry })
      }
      pops.push({ id, name: p.name, parentId: isTop ? parentForCopy : (ids.get(p.parentId ?? ROOT_ID) ?? ROOT_ID), gateId, sampleId: target, ...(p.bool ? { bool: { op: p.bool.op, operands: p.bool.operands } } : {}) })
    }
    // a boolean population points at populations by id: its copy must point at the copies (or, for an operand that was not
    // copied, at the population of the target with the same name path). An operand that cannot be found is left out,
    // which makes the boolean invalid for its operation, so it counts nothing instead of something wrong.
    for (const p of ordered) {
      if (!p.bool) continue
      const copy = pops.find((q) => q.id === ids.get(p.id))!
      copy.bool = { op: p.bool.op, operands: p.bool.operands.flatMap((o) => {
        const inCopy = ids.get(o)
        if (inCopy) return [inCopy]
        const found = findByPath(pops, target, namePath(wb.populations, o))
        return found ? [found.id] : []
      }) }
    }
    applied.push(target)
  }

  const gates = [...wb.gates, ...newGates].filter((g) => pops.some((p) => p.gateId === g.id))
  return { populations: pops, gates, applied, skipped }
}


// ---- Linked gating: keeping the samples of a group on the same gates ----

// Who is kept in step with a sample: the other samples of its custom group, or, when it is in none, the other samples
// that are in no custom group either (a custom group is its own gating family).
export function linkedPeers(wb: Pick<Workbench, 'samples' | 'groups' | 'groupOf'>, sampleId: string): string[] {
  const gid = groupIdOf(wb, sampleId)
  return wb.samples.filter((s) => s.id !== sampleId && groupIdOf(wb, s.id) === gid).map((s) => s.id)
}

// The whole gating tree of `from`, copied over the trees of `to` (each copy with its own gates).
function copyTree(wb: Workbench, from: string, to: string[]): Workbench {
  if (to.length === 0) return wb
  const r = applyGateToGroup(wb, from, ROOT_ID, true, to)
  return { ...wb, populations: r.populations, gates: r.gates }
}

// After a gate was drawn, moved, renamed or deleted in `sampleId`, the samples linked to it get the same gating.
export function syncLinked(wb: Workbench, sampleId: string | null): Workbench {
  if (!wb.linkGates || !sampleId) return wb
  return copyTree(wb, sampleId, linkedPeers(wb, sampleId))
}

// A sample that joins a linked group (added to it, or moved into it) takes the gating the group already has.
export function adoptGroupGating(wb: Workbench, sampleId: string): Workbench {
  if (!wb.linkGates) return wb
  const peers = linkedPeers(wb, sampleId)
  return peers.length ? copyTree(wb, peers[0], [sampleId]) : wb
}

// Whether two samples have different gating, comparing what each population is called and where it cuts.
export function gatingDiffers(wb: Workbench, a: string, b: string): boolean {
  const describe = (sid: string): string[] => {
    const pops = wb.populations.filter((p) => p.id !== ROOT_ID && p.sampleId === sid)
    return pops.map((p) => {
      const g = p.gateId ? wb.gates.find((x) => x.id === p.gateId) : undefined
      const geometry = g ? { ...g.geometry, link: undefined } : null // the link id of a quadrant differs between copies by design
      const bool = p.bool ? { op: p.bool.op, operands: p.bool.operands.map((o) => namePath(wb.populations, o).join('/')).sort() } : null
      return JSON.stringify([namePath(wb.populations, p.id), g?.xParam, g?.yParam, geometry, bool])
    }).sort()
  }
  const da = describe(a)
  const db = describe(b)
  return da.length !== db.length || da.some((x, i) => x !== db[i])
}