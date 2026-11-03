// Workbench model and the population engine. A Workbench is saved as JSON (.ffwb).

import { applyGate, toDisplayGeometry, fromDisplayGeometry, type Axis, type Gate, type GateGeometry } from './gating'
import { makeScale, transformColumn, fitDefaultSpec, type Scale, type TransformSpec } from './transform'
import type { FcsFile } from './fcs'
import { compensate, type CompMatrix } from './compensation'
import { validColumns, type TableColumn } from './stats'
import { validBlocks, validOverlays, validTiles, type OverlayItem, type ReportBlock, type SheetTile } from './reportTypes'

export type SampleSource = { kind: 'file'; path: string } | { kind: 'demo'; seed: number }

export interface SampleRef {
  id: string
  name: string
  source: SampleSource
}

// A population made by combining others of the same sample instead of by a gate: events in all of the operands (and),
// in any of them (or), or in the parent but not in the operand (not).
export type BoolOp = 'and' | 'or' | 'not'
export interface BoolSpec {
  op: BoolOp
  operands: string[] // population ids
}

export interface Population {
  id: string
  name: string
  parentId: string | null // null only for the root "All events"
  gateId: string | null
  // The sample that owns this population. Each sample has its own gating tree below the shared root;
  // "apply to group" copies a tree to other samples. Missing (older files) means it applies to every sample.
  sampleId?: string | null
  bool?: BoolSpec // set for a boolean population (it has no gate)
}

export interface Group {
  id: string
  name: string
  // The group this one sits in (a subgroup). Absent for a top-level group. A subgroup has its own gating; gates of the group above
  // reach it only when they are applied to the group.
  parentId?: string | null
}

// Every sample is always in "All Samples"; custom groups add a second membership level on top of it.
export const DEFAULT_GROUP = 'all'
export const DEFAULT_GROUP_NAME = 'All Samples'

export interface Compensation {
  matrices: CompMatrix[]
  assignments: Record<string, string> // sample id -> matrix id
}

export interface Workbench {
  format: 'freeflow-workbench'
  version: 3
  name: string
  samples: SampleRef[]
  groups: Group[] // custom groups only; "All Samples" is implicit
  groupOf: Record<string, string> // sample id -> custom group id (absent: only in All Samples)
  gates: Gate[]
  populations: Population[]
  transforms: Record<string, TransformSpec> // keyed by parameter name
  compensation: Compensation
  // Where gate shapes are measured. 'raw': in the real values of the data (the current way: changing a scale never moves a gate
  // off its events and a gate means the same thresholds in every sample). 'display': in screen position 0..1, as files
  // from before this change were written; they are converted when their sample files can be read.
  gateSpace: 'raw' | 'display'
  // When on, the gating of the samples in a group is kept the same: a gate drawn, moved, renamed or deleted in one
  // sample is mirrored to the others of its group. Off in files from before it existed.
  linkGates: boolean
  // Columns of the Tables and Charts modes (which statistic of which population). Missing in older files.
  table?: TableColumn[]
  // The blocks of the report (Reports mode). Missing in older files.
  report?: ReportBlock[]
  // The plots of the Sheet view. Missing in older files.
  sheet?: SheetTile[]
  // Populations drawn over the open plot. Missing in older files.
  overlays?: OverlayItem[]
}

export const ROOT_ID = 'root'

export const newId = (): string => globalThis.crypto.randomUUID()

export function emptyWorkbench(name = 'Untitled'): Workbench {
  return {
    format: 'freeflow-workbench',
    version: 3,
    name,
    samples: [],
    groups: [],
    groupOf: {},
    gates: [],
    populations: [{ id: ROOT_ID, name: 'All events', parentId: null, gateId: null }],
    transforms: {},
    compensation: { matrices: [], assignments: {} },
    gateSpace: 'raw',
    linkGates: true,
  }
}

// The populations a sample sees: the shared root, its own, and any older file-wide ones.
export function populationsFor(wb: Pick<Workbench, 'populations'>, sampleId: string | null | undefined): Population[] {
  return wb.populations.filter((p) => p.id === ROOT_ID || p.sampleId == null || p.sampleId === sampleId)
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function validGeometry(g: unknown): boolean {
  if (typeof g !== 'object' || g === null) return false
  const o = g as Record<string, unknown>
  if (o.type === 'rectangle') return [o.x0, o.y0, o.x1, o.y1].every(isNum)
  if (o.type === 'range') return isNum(o.x0) && isNum(o.x1)
  if (o.type === 'quadrant') return isNum(o.cx) && isNum(o.cy) && ['nw', 'ne', 'se', 'sw'].includes(o.q as string) && typeof o.link === 'string'
  if (o.type === 'ellipse') return [o.cx, o.cy, o.rx, o.ry].every(isNum) && (o.rx as number) > 0 && (o.ry as number) > 0
  if (o.type === 'polygon')
    return Array.isArray(o.points) && o.points.length >= 3 && o.points.every((p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))
  return false
}

// Reads a Workbench and refuses anything the app could not draw, so a damaged file gives a clear error instead of a crash.
export function parseWorkbench(json: string): Workbench {
  const w = JSON.parse(json) as Omit<Workbench, 'version'> & { version: number }
  // files written under the earlier working name "flowgate" are accepted too
  const fmt = w ? (w.format as string) : ''
  if (!w || (fmt !== 'freeflow-workbench' && fmt !== 'flowgate-workbench') || (w.version !== 1 && w.version !== 2 && w.version !== 3)) throw new Error('Not a supported Workbench file')
  w.format = 'freeflow-workbench'
  if (!Array.isArray(w.samples) || !Array.isArray(w.gates) || !Array.isArray(w.populations)) throw new Error('Workbench file is damaged')
  // older files measured gates on the screen and did not link them
  const ws = w as unknown as { gateSpace?: unknown; linkGates?: unknown }
  if (ws.gateSpace === undefined) ws.gateSpace = 'display'
  if (ws.linkGates === undefined) ws.linkGates = false
  if ((ws.gateSpace !== 'raw' && ws.gateSpace !== 'display') || typeof ws.linkGates !== 'boolean') throw new Error('Workbench file is damaged: gate settings are invalid')
  if (w.table !== undefined && !validColumns(w.table)) throw new Error('Workbench file is damaged: the table definition is invalid')
  if (w.report !== undefined && !validBlocks(w.report)) throw new Error('Workbench file is damaged: the report definition is invalid')
  if (w.sheet !== undefined && !validTiles(w.sheet)) throw new Error('Workbench file is damaged: the sheet definition is invalid')
  if (w.overlays !== undefined && !validOverlays(w.overlays)) throw new Error('Workbench file is damaged: the overlay list is invalid')
  // version 1 had no groups
  if (w.groups === undefined) w.groups = []
  if (w.groupOf === undefined) w.groupOf = {}
  if (!Array.isArray(w.groups) || w.groups.some((g) => !g || typeof g.id !== 'string' || typeof g.name !== 'string' || g.id === DEFAULT_GROUP) || typeof w.groupOf !== 'object' || w.groupOf === null)
    throw new Error('Workbench file is damaged: groups are invalid')
  if (typeof w.transforms !== 'object' || w.transforms === null) throw new Error('Workbench file is damaged: no transforms')
  // files saved before compensation existed have no such section
  if (w.compensation === undefined) w.compensation = { matrices: [], assignments: {} }
  const c = w.compensation
  if (!c || !Array.isArray(c.matrices) || typeof c.assignments !== 'object' || c.assignments === null) throw new Error('Workbench file is damaged: compensation section is invalid')
  for (const m of c.matrices) {
    const n = Array.isArray(m?.parameters) ? m.parameters.length : -1
    if (!m || typeof m.id !== 'string' || typeof m.name !== 'string' || n < 1 || !m.parameters.every((p) => typeof p === 'string') ||
      !Array.isArray(m.values) || m.values.length !== n || !m.values.every((r) => Array.isArray(r) && r.length === n && r.every(isNum)))
      throw new Error(`Workbench file is damaged: matrix "${m?.name ?? '?'}" is invalid`)
  }
  const matrixIds = new Set(c.matrices.map((m) => m.id))
  for (const id of Object.values(c.assignments)) if (!matrixIds.has(id)) throw new Error('Workbench file is damaged: a sample points to a missing matrix')
  for (const s of w.samples)
    if (!s || typeof s.id !== 'string' || typeof s.name !== 'string' || !s.source || (s.source.kind !== 'file' && s.source.kind !== 'demo'))
      throw new Error('Workbench file is damaged: a sample entry is invalid')
  for (const g of w.gates) {
    if (!g || typeof g.id !== 'string' || typeof g.xParam !== 'string' || typeof g.yParam !== 'string' || !validGeometry(g.geometry))
      throw new Error(`Workbench file is damaged: gate ${g?.id ?? '?'} has no valid shape`)
  }
  const popIds = new Set(w.populations.map((p) => p?.id))
  if (!popIds.has(ROOT_ID)) throw new Error('Workbench file is damaged: no root population')
  const gateIds = new Set(w.gates.map((g) => g.id))
  const sampleIds = new Set(w.samples.map((s) => s.id))
  const groupIds = new Set(w.groups.map((g) => g.id))
  for (const [sid, gid] of Object.entries(w.groupOf))
    if (!sampleIds.has(sid) || !groupIds.has(gid)) throw new Error('Workbench file is damaged: a sample points to a missing group')
  for (const g of w.groups) {
    if (g.parentId != null && (typeof g.parentId !== 'string' || g.parentId === g.id || !groupIds.has(g.parentId))) throw new Error('Workbench file is damaged: a subgroup points to a missing group')
    // a group cannot sit inside itself, however many levels apart
    let cur: string | null | undefined = g.parentId
    for (let hops = 0; cur; hops++) { if (cur === g.id || hops > w.groups.length) throw new Error('Workbench file is damaged: groups sit inside each other in a loop'); cur = w.groups.find((x) => x.id === cur)?.parentId }
  }
  const byId = new Map(w.populations.map((p) => [p.id, p]))
  for (const p of w.populations) {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string') throw new Error('Workbench file is damaged: a population is invalid')
    if (p.id !== ROOT_ID && (!p.parentId || !popIds.has(p.parentId))) throw new Error(`Workbench file is damaged: population "${p.name}" has no valid parent`)
    if (p.gateId && !gateIds.has(p.gateId)) throw new Error(`Workbench file is damaged: population "${p.name}" points to a missing gate`)
    if (p.sampleId != null && !sampleIds.has(p.sampleId)) throw new Error(`Workbench file is damaged: population "${p.name}" belongs to a missing sample`)
    if (p.bool !== undefined) {
      const b = p.bool as { op?: unknown; operands?: unknown }
      const okOp = b && (b.op === 'and' || b.op === 'or' || b.op === 'not')
      const ops = b && Array.isArray(b.operands) ? (b.operands as unknown[]) : null
      if (!okOp || !ops || !ops.every((o) => typeof o === 'string' && popIds.has(o as string) && o !== p.id) || (b.op === 'not' ? ops.length !== 1 : ops.length < 2))
        throw new Error(`Workbench file is damaged: the boolean population "${p.name}" is invalid`)
    }
    const parent = p.parentId ? byId.get(p.parentId) : undefined
    if (parent && parent.id !== ROOT_ID && p.sampleId != null && parent.sampleId != null && parent.sampleId !== p.sampleId)
      throw new Error(`Workbench file is damaged: population "${p.name}" sits under another sample's population`)
  }
  return migrateToPerSample(w)
}

// Files from before groups shared one gating tree between all samples. Give every sample its own copy so
// each can be changed alone, and so "apply to group" has something to copy.
function migrateToPerSample(w: Omit<Workbench, 'version'> & { version: number }): Workbench {
  w.version = 3
  const legacy = w.populations.filter((p) => p.id !== ROOT_ID && p.sampleId == null)
  if (legacy.length === 0 || w.samples.length === 0) return w as Workbench
  const keep = w.populations.filter((p) => !legacy.includes(p))
  const gates = w.gates.filter((g) => !legacy.some((p) => p.gateId === g.id))
  const out = [...keep]
  const newGates = [...gates]
  for (const s of w.samples) {
    const ids = new Map<string, string>([[ROOT_ID, ROOT_ID]])
    for (const p of legacy) ids.set(p.id, newId())
    for (const p of legacy) {
      let gateId: string | null = null
      const g = p.gateId ? w.gates.find((x) => x.id === p.gateId) : undefined
      if (g) { gateId = newId(); newGates.push({ ...g, id: gateId, geometry: structuredClone(g.geometry) }) }
      out.push({ id: ids.get(p.id)!, name: p.name, parentId: ids.get(p.parentId ?? ROOT_ID) ?? ROOT_ID, gateId, sampleId: s.id })
    }
  }
  w.populations = out
  w.gates = newGates
  return w as Workbench
}

// Smallest "Gate N" not already used, so names stay unique after deletions.
export function nextGateName(pops: Population[]): string {
  const used = new Set(pops.map((p) => p.name))
  let n = 1
  while (used.has(`Gate ${n}`)) n++
  return `Gate ${n}`
}

export function descendants(pops: Population[], id: string): string[] {
  const out: string[] = []
  const walk = (pid: string): void => {
    for (const p of pops) if (p.parentId === pid) { out.push(p.id); walk(p.id) }
  }
  walk(id)
  return out
}

export function columnIndex(file: FcsFile, name: string): number {
  return file.parameters.findIndex((p) => p.name === name)
}

const defaultCache = new WeakMap<FcsFile, Map<string, TransformSpec>>()

// The default scale for a parameter taken from one file alone: by parameter type, fitted to that file's data.
function perFileDefault(file: FcsFile, name: string): TransformSpec {
  let perFile = defaultCache.get(file)
  if (!perFile) { perFile = new Map(); defaultCache.set(file, perFile) }
  let spec = perFile.get(name)
  if (!spec) {
    const idx = columnIndex(file, name)
    spec = fitDefaultSpec(name, idx >= 0 ? file.parameters[idx].range : 0, idx >= 0 ? file.columns[idx] : undefined)
    perFile.set(name, spec)
  }
  return spec
}

// With several samples loaded, a parameter gets ONE default scale that fits all of them, so the same parameter looks
// the same in every sample (which is what makes comparing a sample with a reference sample readable).
let pool: FcsFile[] = []
const pooled = new Map<string, TransformSpec>()

export function setDefaultScalePool(files: FcsFile[]): void {
  pool = files
  pooled.clear()
}

function combineSpecs(specs: TransformSpec[]): TransformSpec {
  const first = specs[0]
  if (first.type === 'linear' && specs.every((s) => s.type === 'linear')) {
    const l = specs as Extract<TransformSpec, { type: 'linear' }>[]
    return { type: 'linear', min: Math.min(...l.map((s) => s.min)), max: Math.max(...l.map((s) => s.max)) }
  }
  if (first.type === 'biex' && specs.every((s) => s.type === 'biex')) {
    const b = specs as Extract<TransformSpec, { type: 'biex' }>[]
    return { ...first, max: Math.max(...b.map((s) => s.max)), widthDecades: Math.max(...b.map((s) => s.widthDecades)) }
  }
  return first
}

// The axis scale used when the person has not set one.
export function defaultSpecFor(file: FcsFile, name: string): TransformSpec {
  if (pool.length >= 2 && columnIndex(file, name) >= 0) {
    const cached = pooled.get(name)
    if (cached) return cached
    const members = pool.filter((f) => columnIndex(f, name) >= 0)
    if (members.length >= 2) {
      const spec = combineSpecs(members.map((f) => perFileDefault(f, name)))
      pooled.set(name, spec)
      return spec
    }
  }
  return perFileDefault(file, name)
}

export function scaleFor(wb: Workbench, file: FcsFile, paramName: string): Scale {
  return makeScale(wb.transforms[paramName] ?? defaultSpecFor(file, paramName))
}

// A gate that has no second parameter (a range on a histogram) has no Y axis: any value stays as it is.
export const NO_AXIS: Axis = { scale: (v) => v, inverse: (x) => x }

// A gate's shape as it is drawn and tested on this sample: its real values turned into positions on the axes.
export function gateGeometryOnScreen(wb: Pick<Workbench, 'gateSpace'>, geometry: GateGeometry, ax: Axis, ay: Axis): GateGeometry {
  return wb.gateSpace === 'raw' ? toDisplayGeometry(geometry, ax, ay) : geometry
}

// The reverse, for a shape the person has just drawn or dragged.
export function gateGeometryForStorage(wb: Pick<Workbench, 'gateSpace'>, geometry: GateGeometry, ax: Axis, ay: Axis): GateGeometry {
  return wb.gateSpace === 'raw' ? fromDisplayGeometry(geometry, ax, ay) : geometry
}

// Files from before gates were stored in real values: measure every gate with the scales the sample had when it was
// drawn (each file on its own, as before) and keep its real values. If a gate cannot be converted because the file of
// its sample is not available, nothing is converted and the Workbench stays in the older mode, which still works.
export function upgradeGatesToRealValues(wb: Workbench, files: Record<string, FcsFile | undefined>): { wb: Workbench; upgraded: boolean } {
  if (wb.gateSpace === 'raw') return { wb, upgraded: false }
  if (wb.gates.length === 0) return { wb: { ...wb, gateSpace: 'raw' }, upgraded: true }
  const savedPool = pool
  setDefaultScalePool([]) // the scales of the time: each file fitted alone
  try {
    const converted = new Map<string, Gate>()
    for (const g of wb.gates) {
      const owner = wb.populations.find((p) => p.gateId === g.id)
      const raw = owner?.sampleId ? files[owner.sampleId] : undefined
      if (!raw) return { wb, upgraded: false }
      const m = wb.compensation.matrices.find((x) => x.id === wb.compensation.assignments[owner!.sampleId!])
      const file = m ? compensate(raw, m).file : raw
      if (columnIndex(file, g.xParam) < 0 || (g.geometry.type !== 'range' && columnIndex(file, g.yParam) < 0)) return { wb, upgraded: false }
      const ax = scaleFor(wb, file, g.xParam)
      const ay = g.geometry.type === 'range' ? NO_AXIS : scaleFor(wb, file, g.yParam)
      converted.set(g.id, { ...g, geometry: fromDisplayGeometry(g.geometry, ax, ay) })
    }
    return { wb: { ...wb, gateSpace: 'raw', gates: wb.gates.map((g) => converted.get(g.id) ?? g) }, upgraded: true }
  } finally {
    setDefaultScalePool(savedPool)
  }
}

// Returns the mask of every population for one sample (null for the root: all events).
export function evaluatePopulations(wb: Workbench, file: FcsFile, sampleId?: string | null): Map<string, Uint8Array | null> {
  const masks = new Map<string, Uint8Array | null>([[ROOT_ID, null]])
  const cache = new Map<string, Float32Array>()
  const col = (name: string): Float32Array | null => {
    const idx = columnIndex(file, name)
    if (idx < 0) return null
    const spec = JSON.stringify(wb.transforms[name] ?? 'default')
    const key = `${name}|${spec}`
    let c = cache.get(key)
    if (!c) { c = transformColumn(file.columns[idx], scaleFor(wb, file, name)); cache.set(key, c) }
    return c
  }
  // without a sample id every population counts (used by tests and by older callers)
  const mine = sampleId === undefined ? wb.populations : populationsFor(wb, sampleId)
  const ordered = mine.filter((p) => p.id !== ROOT_ID)
  // parents always come before children because populations are created top-down; resolve by passes anyway
  let remaining = ordered
  while (remaining.length) {
    const next: Population[] = []
    for (const p of remaining) {
      if (p.parentId && !masks.has(p.parentId)) { next.push(p); continue }
      if (p.bool) {
        if (!p.bool.operands.every((o) => masks.has(o))) { next.push(p); continue }
        masks.set(p.id, !boolIsValid(p.bool) ? new Uint8Array(file.eventCount) : combineMasks(p.bool.op, p.bool.operands.map((o) => masks.get(o) ?? null), masks.get(p.parentId ?? ROOT_ID) ?? null, file.eventCount))
        continue
      }
      const gate = wb.gates.find((g) => g.id === p.gateId)
      const xs = gate ? col(gate.xParam) : null
      const oneD = gate?.geometry.type === 'range'
      const ys = gate && !oneD ? col(gate.yParam) : null
      // a gate on a parameter this sample lacks yields an empty population, flagged by a zero mask
      if (gate && xs && (oneD || ys)) {
        // the gate's real values become positions on this sample's axes, then it is tested like any shape on screen
        const onScreen = gateGeometryOnScreen(wb, gate.geometry, scaleFor(wb, file, gate.xParam), oneD ? NO_AXIS : scaleFor(wb, file, gate.yParam))
        masks.set(p.id, applyGate({ ...gate, geometry: onScreen }, xs, ys, masks.get(p.parentId ?? ROOT_ID) ?? null))
      } else {
        masks.set(p.id, new Uint8Array(file.eventCount))
      }
    }
    if (next.length === remaining.length) break // orphaned populations: stop instead of looping forever
    remaining = next
  }
  return masks
}


// The mask of a boolean population. A null mask means every event. The result never goes outside the parent.
export function combineMasks(op: BoolOp, operands: (Uint8Array | null)[], parent: Uint8Array | null, n: number): Uint8Array {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    let v: boolean
    if (op === 'and') v = operands.every((m) => (m ? m[i] === 1 : true))
    else if (op === 'or') v = operands.some((m) => (m ? m[i] === 1 : true))
    else v = operands[0] ? operands[0][i] !== 1 : false
    out[i] = v && (parent ? parent[i] === 1 : true) ? 1 : 0
  }
  return out
}

// 'not' takes exactly one operand; 'and' and 'or' take two or more. Anything else counts no events.
export const boolIsValid = (b: BoolSpec): boolean => (b.op === 'not' ? b.operands.length === 1 : b.operands.length >= 2)
