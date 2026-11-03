// Gates live in display space (0..1 on both axes, after the axis transform), so a gate keeps its
// place on screen and is independent of the raw value range.

export type Point = [number, number]

export type GateGeometry =
  | { type: 'polygon'; points: Point[] }
  | { type: 'rectangle'; x0: number; y0: number; x1: number; y1: number }
  | { type: 'ellipse'; cx: number; cy: number; rx: number; ry: number } // axis-aligned in this version
  | { type: 'range'; x0: number; x1: number } // one dimension, used on histograms
  // One quarter of a plot cut by a vertical and a horizontal line crossing at (cx, cy). A quadrant gate is four of
  // these sharing the same `link`, so moving the crosshair moves all four.
  | { type: 'quadrant'; cx: number; cy: number; q: Quadrant; link: string }

export type Quadrant = 'nw' | 'ne' | 'se' | 'sw'

export interface Gate {
  id: string
  xParam: string
  yParam: string // empty for range gates
  geometry: GateGeometry
}

export function pointInPolygon(x: number, y: number, pts: Point[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function gateContains(g: GateGeometry, x: number, y: number): boolean {
  switch (g.type) {
    case 'rectangle':
      return x >= Math.min(g.x0, g.x1) && x <= Math.max(g.x0, g.x1) && y >= Math.min(g.y0, g.y1) && y <= Math.max(g.y0, g.y1)
    case 'range':
      return x >= Math.min(g.x0, g.x1) && x <= Math.max(g.x0, g.x1)
    case 'ellipse': {
      const dx = (x - g.cx) / g.rx
      const dy = (y - g.cy) / g.ry
      return dx * dx + dy * dy <= 1
    }
    case 'quadrant': {
      // half-open so that every event lands in exactly one quarter, even on the lines
      const east = x >= g.cx
      const north = y >= g.cy
      return g.q === 'ne' ? east && north : g.q === 'nw' ? !east && north : g.q === 'se' ? east && !north : !east && !north
    }
    case 'polygon':
      return pointInPolygon(x, y, g.points)
  }
}

// xs and ys are the already-transformed columns (ys may be null for a range gate).
// parent is the parent population mask (or null = all events).
export function applyGate(gate: Gate, xs: Float32Array, ys: Float32Array | null, parent: Uint8Array | null): Uint8Array {
  const n = xs.length
  const mask = new Uint8Array(n)
  const g = gate.geometry
  if (g.type !== 'range' && !ys) return mask
  let bx0 = -Infinity, bx1 = Infinity, by0 = -Infinity, by1 = Infinity
  if (g.type === 'polygon') {
    bx0 = by0 = Infinity
    bx1 = by1 = -Infinity
    for (const [px, py] of g.points) {
      if (px < bx0) bx0 = px
      if (px > bx1) bx1 = px
      if (py < by0) by0 = py
      if (py > by1) by1 = py
    }
  } else if (g.type === 'ellipse') {
    bx0 = g.cx - g.rx; bx1 = g.cx + g.rx; by0 = g.cy - g.ry; by1 = g.cy + g.ry
  }
  // a quarter has no tight bounding box to skip with: its own test is already cheap
  for (let i = 0; i < n; i++) {
    if (parent && !parent[i]) continue
    const x = xs[i]
    if (x < bx0 || x > bx1) continue
    const y = ys ? ys[i] : 0
    if (y < by0 || y > by1) continue
    if (gateContains(g, x, y)) mask[i] = 1
  }
  return mask
}

// ---- Gates are stored in the real values of the data ("FL1-H between 1,000 and 100,000"), so changing how an axis is
// drawn never moves a gate off its events, and the same gate means the same thresholds in every sample. Drawing,
// hit-testing and counting happen in display space (0..1 after the axis scale), so a stored gate is converted
// first. Rectangles, ranges and quadrants cut at the same values on any scale; the vertices of a polygon keep their
// values, and its edges are straight on screen; an ellipse is the one inscribed in the box between its two raw corners.

// What a gate needs from an axis scale: value to position (0..1) and back.
export interface Axis {
  scale(v: number): number
  inverse(x: number): number
}

export function toDisplayGeometry(g: GateGeometry, ax: Axis, ay: Axis): GateGeometry {
  switch (g.type) {
    case 'rectangle': return { type: 'rectangle', x0: ax.scale(g.x0), x1: ax.scale(g.x1), y0: ay.scale(g.y0), y1: ay.scale(g.y1) }
    case 'range': return { type: 'range', x0: ax.scale(g.x0), x1: ax.scale(g.x1) }
    case 'quadrant': return { ...g, cx: ax.scale(g.cx), cy: ay.scale(g.cy) }
    case 'polygon': return { type: 'polygon', points: g.points.map(([x, y]) => [ax.scale(x), ay.scale(y)] as Point) }
    case 'ellipse': {
      const x0 = ax.scale(g.cx - g.rx), x1 = ax.scale(g.cx + g.rx), y0 = ay.scale(g.cy - g.ry), y1 = ay.scale(g.cy + g.ry)
      return { type: 'ellipse', cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: Math.max((x1 - x0) / 2, 1e-6), ry: Math.max((y1 - y0) / 2, 1e-6) }
    }
  }
}

export function fromDisplayGeometry(g: GateGeometry, ax: Axis, ay: Axis): GateGeometry {
  switch (g.type) {
    case 'rectangle': return { type: 'rectangle', x0: ax.inverse(g.x0), x1: ax.inverse(g.x1), y0: ay.inverse(g.y0), y1: ay.inverse(g.y1) }
    case 'range': return { type: 'range', x0: ax.inverse(g.x0), x1: ax.inverse(g.x1) }
    case 'quadrant': return { ...g, cx: ax.inverse(g.cx), cy: ay.inverse(g.cy) }
    case 'polygon': return { type: 'polygon', points: g.points.map(([x, y]) => [ax.inverse(x), ay.inverse(y)] as Point) }
    case 'ellipse': {
      const x0 = ax.inverse(g.cx - g.rx), x1 = ax.inverse(g.cx + g.rx), y0 = ay.inverse(g.cy - g.ry), y1 = ay.inverse(g.cy + g.ry)
      return { type: 'ellipse', cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 }
    }
  }
}

// ---- Editing a gate after it is drawn: handles, resizing and moving. All in display space, clamped to 0..1. ----

export interface Handle {
  id: string
  p: Point
}

const MIN_SIZE = 0.004
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

export function geometryBounds(g: GateGeometry): { x0: number; y0: number; x1: number; y1: number } {
  switch (g.type) {
    case 'rectangle': return { x0: Math.min(g.x0, g.x1), y0: Math.min(g.y0, g.y1), x1: Math.max(g.x0, g.x1), y1: Math.max(g.y0, g.y1) }
    case 'range': return { x0: Math.min(g.x0, g.x1), y0: 0, x1: Math.max(g.x0, g.x1), y1: 1 }
    case 'ellipse': return { x0: g.cx - g.rx, y0: g.cy - g.ry, x1: g.cx + g.rx, y1: g.cy + g.ry }
    case 'quadrant': return { x0: g.q === 'nw' || g.q === 'sw' ? 0 : g.cx, y0: g.q === 'sw' || g.q === 'se' ? 0 : g.cy, x1: g.q === 'nw' || g.q === 'sw' ? g.cx : 1, y1: g.q === 'sw' || g.q === 'se' ? g.cy : 1 }
    case 'polygon': {
      const xs = g.points.map((p) => p[0])
      const ys = g.points.map((p) => p[1])
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
    }
  }
}

// The points a person can grab. Rectangles get corners and edges, ellipses their four extremes,
// ranges their two edges and polygons every vertex.
export function handlesOf(g: GateGeometry): Handle[] {
  if (g.type === 'polygon') return g.points.map((p, i) => ({ id: `v${i}`, p }))
  // the crosshair: its centre moves both lines, the end of each line moves only that line
  if (g.type === 'quadrant') return [{ id: 'c', p: [g.cx, g.cy] }, { id: 'v', p: [g.cx, 0.97] }, { id: 'h', p: [0.97, g.cy] }]
  const b = geometryBounds(g)
  const mx = (b.x0 + b.x1) / 2
  const my = (b.y0 + b.y1) / 2
  if (g.type === 'range') return [{ id: 'w', p: [b.x0, 0.5] }, { id: 'e', p: [b.x1, 0.5] }]
  const edges: Handle[] = [{ id: 'n', p: [mx, b.y1] }, { id: 'e', p: [b.x1, my] }, { id: 's', p: [mx, b.y0] }, { id: 'w', p: [b.x0, my] }]
  if (g.type === 'ellipse') return edges
  return [{ id: 'nw', p: [b.x0, b.y1] }, edges[0], { id: 'ne', p: [b.x1, b.y1] }, edges[1], { id: 'se', p: [b.x1, b.y0] }, edges[2], { id: 'sw', p: [b.x0, b.y0] }, edges[3]]
}

// Moves one handle to p. The side opposite to an edge or corner handle stays where it is.
export function applyHandle(g: GateGeometry, id: string, p: Point): GateGeometry {
  const x = clamp01(p[0])
  const y = clamp01(p[1])
  if (g.type === 'quadrant') {
    const lim = (v: number): number => Math.min(1 - MIN_SIZE, Math.max(MIN_SIZE, v))
    return { ...g, cx: id === 'h' ? g.cx : lim(x), cy: id === 'v' ? g.cy : lim(y) }
  }
  if (g.type === 'polygon') {
    const i = Number(id.slice(1))
    return { type: 'polygon', points: g.points.map((q, k) => (k === i ? ([x, y] as Point) : q)) }
  }
  const b = geometryBounds(g)
  let { x0, y0, x1, y1 } = b
  if (id.includes('w')) x0 = x
  if (id.includes('e')) x1 = x
  if (id.includes('s')) y0 = y
  if (id.includes('n')) y1 = y
  // dragging past the opposite side flips the shape instead of inverting it
  let lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1)
  if (hx - lx < MIN_SIZE) { if (id.includes('w')) lx = hx - MIN_SIZE; else hx = lx + MIN_SIZE }
  if (hy - ly < MIN_SIZE) { if (id.includes('s')) ly = hy - MIN_SIZE; else hy = ly + MIN_SIZE }
  lx = clamp01(lx); hx = clamp01(hx); ly = clamp01(ly); hy = clamp01(hy)
  if (g.type === 'range') return { type: 'range', x0: lx, x1: hx }
  if (g.type === 'rectangle') return { type: 'rectangle', x0: lx, y0: ly, x1: hx, y1: hy }
  return { type: 'ellipse', cx: (lx + hx) / 2, cy: (ly + hy) / 2, rx: (hx - lx) / 2, ry: (hy - ly) / 2 }
}

// Moves the whole gate by (dx, dy), stopping at the edges of the plot so the shape is never cut off.
export function moveGeometry(g: GateGeometry, dx: number, dy: number): GateGeometry {
  if (g.type === 'quadrant') {
    const lim = (v: number): number => Math.min(1 - MIN_SIZE, Math.max(MIN_SIZE, v))
    return { ...g, cx: lim(g.cx + dx), cy: lim(g.cy + dy) }
  }
  const b = geometryBounds(g)
  const mx = Math.min(1 - b.x1, Math.max(-b.x0, dx))
  const my = g.type === 'range' ? 0 : Math.min(1 - b.y1, Math.max(-b.y0, dy))
  switch (g.type) {
    case 'rectangle': return { type: 'rectangle', x0: g.x0 + mx, x1: g.x1 + mx, y0: g.y0 + my, y1: g.y1 + my }
    case 'range': return { type: 'range', x0: g.x0 + mx, x1: g.x1 + mx }
    case 'ellipse': return { ...g, cx: g.cx + mx, cy: g.cy + my }
    case 'polygon': return { type: 'polygon', points: g.points.map(([px, py]) => [px + mx, py + my] as Point) }
  }
}

// Histogram of display coordinates (0..1) in equal bins, restricted to a population, lightly smoothed.
export function histogram(xs: Float32Array, mask: Uint8Array | null, bins = 256): Float64Array {
  const raw = new Float64Array(bins)
  for (let i = 0; i < xs.length; i++) {
    if (mask && !mask[i]) continue
    const b = Math.min(bins - 1, Math.max(0, Math.floor(xs[i] * bins)))
    raw[b]++
  }
  const out = new Float64Array(bins)
  for (let b = 0; b < bins; b++) out[b] = ((raw[b - 1] ?? raw[b]) + raw[b] * 2 + (raw[b + 1] ?? raw[b])) / 4
  return out
}
