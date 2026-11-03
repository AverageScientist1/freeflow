import { describe, it, expect } from 'vitest'
import { pointInPolygon, gateContains, applyGate, histogram, handlesOf, applyHandle, moveGeometry, geometryBounds, toDisplayGeometry, fromDisplayGeometry, type Axis, type Gate } from '../src/core/gating'
import { makeScale } from '../src/core/transform'
import { mulberry32 } from '../src/core/synth'
import { countMask, freqOfParent, median, mean, cv } from '../src/core/stats'

const square: [number, number][] = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]

describe('gating', () => {
  it('tests points against a polygon', () => {
    expect(pointInPolygon(0.5, 0.5, square)).toBe(true)
    expect(pointInPolygon(0.1, 0.5, square)).toBe(false)
    const concave: [number, number][] = [[0, 0], [1, 0], [1, 1], [0.5, 0.2], [0, 1]]
    expect(pointInPolygon(0.5, 0.1, concave)).toBe(true)
    expect(pointInPolygon(0.5, 0.9, concave)).toBe(false)
  })

  it('accepts a rectangle drawn in any drag direction', () => {
    const r = { type: 'rectangle' as const, x0: 0.8, y0: 0.9, x1: 0.2, y1: 0.1 }
    expect(gateContains(r, 0.5, 0.5)).toBe(true)
    expect(gateContains(r, 0.9, 0.5)).toBe(false)
  })

  it('tests points against an ellipse', () => {
    const e = { type: 'ellipse' as const, cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.1 }
    expect(gateContains(e, 0.5, 0.5)).toBe(true)
    expect(gateContains(e, 0.69, 0.5)).toBe(true)
    expect(gateContains(e, 0.71, 0.5)).toBe(false)
    expect(gateContains(e, 0.5, 0.61)).toBe(false)
    // a corner of the bounding box is outside the ellipse
    expect(gateContains(e, 0.68, 0.59)).toBe(false)
  })

  it('tests a range on the X axis only, in either order', () => {
    const r = { type: 'range' as const, x0: 0.7, x1: 0.3 }
    expect(gateContains(r, 0.5, 99)).toBe(true)
    expect(gateContains(r, 0.2, 0)).toBe(false)
  })

  it('applies a gate inside a parent mask', () => {
    const xs = Float32Array.from([0.5, 0.5, 0.1, 0.5])
    const ys = Float32Array.from([0.5, 0.5, 0.1, 0.5])
    const gate: Gate = { id: 'g', xParam: 'x', yParam: 'y', geometry: { type: 'polygon', points: square } }
    expect(Array.from(applyGate(gate, xs, ys, null))).toEqual([1, 1, 0, 1])
    expect(Array.from(applyGate(gate, xs, ys, Uint8Array.from([1, 0, 1, 1])))).toEqual([1, 0, 0, 1])
  })

  it('applies an ellipse gate and a range gate to columns', () => {
    const xs = Float32Array.from([0.5, 0.9, 0.5, 0.2])
    const ys = Float32Array.from([0.5, 0.5, 0.9, 0.2])
    const ell: Gate = { id: 'e', xParam: 'x', yParam: 'y', geometry: { type: 'ellipse', cx: 0.5, cy: 0.5, rx: 0.1, ry: 0.1 } }
    expect(Array.from(applyGate(ell, xs, ys, null))).toEqual([1, 0, 0, 0])
    const range: Gate = { id: 'r', xParam: 'x', yParam: '', geometry: { type: 'range', x0: 0.4, x1: 0.6 } }
    expect(Array.from(applyGate(range, xs, null, null))).toEqual([1, 0, 1, 0])
    expect(Array.from(applyGate(range, xs, null, Uint8Array.from([0, 1, 1, 1])))).toEqual([0, 0, 1, 0])
  })

  it('a two-dimensional gate without a second column gives an empty population', () => {
    const gate: Gate = { id: 'g', xParam: 'x', yParam: 'y', geometry: { type: 'rectangle', x0: 0, y0: 0, x1: 1, y1: 1 } }
    expect(Array.from(applyGate(gate, Float32Array.from([0.5]), null, null))).toEqual([0])
  })

  it('gives an empty population for an empty input', () => {
    const gate: Gate = { id: 'g', xParam: 'x', yParam: 'y', geometry: { type: 'polygon', points: square } }
    expect(applyGate(gate, new Float32Array(0), new Float32Array(0), null).length).toBe(0)
  })
})

describe('editing a gate', () => {
  const rect = { type: 'rectangle' as const, x0: 0.2, y0: 0.3, x1: 0.6, y1: 0.7 }
  const ell = { type: 'ellipse' as const, cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.1 }
  const poly = { type: 'polygon' as const, points: [[0.2, 0.2], [0.8, 0.2], [0.5, 0.8]] as [number, number][] }
  const range = { type: 'range' as const, x0: 0.3, x1: 0.6 }

  it('offers the expected handles for each shape', () => {
    expect(handlesOf(rect).map((h) => h.id).sort()).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w'])
    expect(handlesOf(ell).map((h) => h.id).sort()).toEqual(['e', 'n', 's', 'w'])
    expect(handlesOf(range).map((h) => h.id).sort()).toEqual(['e', 'w'])
    expect(handlesOf(poly).map((h) => h.id)).toEqual(['v0', 'v1', 'v2'])
    expect(handlesOf(rect).find((h) => h.id === 'ne')!.p).toEqual([0.6, 0.7])
  })

  it('resizing a corner keeps the opposite corner fixed', () => {
    const r = applyHandle(rect, 'ne', [0.9, 0.95]) as typeof rect
    expect(r).toEqual({ type: 'rectangle', x0: 0.2, y0: 0.3, x1: 0.9, y1: 0.95 })
  })

  it('resizing an edge changes one side only', () => {
    const r = applyHandle(rect, 'w', [0.1, 0.9]) as typeof rect
    expect([r.x0, r.x1, r.y0, r.y1]).toEqual([0.1, 0.6, 0.3, 0.7])
  })

  it('dragging an edge past the other side flips the shape instead of inverting it', () => {
    const r = applyHandle(rect, 'e', [0.1, 0.5]) as typeof rect
    expect(Math.min(r.x0, r.x1)).toBe(0.1)
    expect(Math.max(r.x0, r.x1)).toBe(0.2)
  })

  it('never makes a shape thinner than the minimum and keeps it inside the plot', () => {
    const r = applyHandle(rect, 'e', [0.2, 0.5]) as typeof rect
    expect(r.x1 - r.x0).toBeGreaterThanOrEqual(0.004 - 1e-12)
    const out = applyHandle(rect, 'ne', [5, -3]) as typeof rect
    for (const v of [out.x0, out.x1, out.y0, out.y1]) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })

  it('resizes an ellipse from its extremes', () => {
    const e = applyHandle(ell, 'e', [0.9, 0.5]) as typeof ell
    expect(e.cx).toBeCloseTo(0.6, 9)
    expect(e.rx).toBeCloseTo(0.3, 9)
    expect(e.cy).toBe(0.5)
    expect(e.ry).toBeCloseTo(0.1, 9)
  })

  it('moves a range edge and keeps x0 below x1', () => {
    expect(applyHandle(range, 'w', [0.1, 0.5])).toEqual({ type: 'range', x0: 0.1, x1: 0.6 })
    const r = applyHandle(range, 'e', [0.2, 0.5]) as typeof range
    expect(r.x0).toBeLessThan(r.x1)
  })

  it('moves one polygon vertex and leaves the others', () => {
    const p = applyHandle(poly, 'v1', [0.9, 0.1]) as typeof poly
    expect(p.points).toEqual([[0.2, 0.2], [0.9, 0.1], [0.5, 0.8]])
  })

  it('moves a whole gate and stops at the edges of the plot', () => {
    expect(moveGeometry(rect, 0.1, -0.1)).toEqual({ type: 'rectangle', x0: 0.2 + 0.1, x1: 0.6 + 0.1, y0: 0.3 - 0.1, y1: 0.7 - 0.1 })
    const stuck = moveGeometry(rect, 5, 5) as typeof rect
    expect(stuck.x1).toBeCloseTo(1, 9)
    expect(stuck.y1).toBeCloseTo(1, 9)
    expect(stuck.x1 - stuck.x0).toBeCloseTo(0.4, 9) // the size did not change
    const left = moveGeometry(poly, -5, 0) as typeof poly
    expect(Math.min(...left.points.map((q) => q[0]))).toBeCloseTo(0, 9)
  })

  it('a range moves sideways only', () => {
    expect(moveGeometry(range, 0.1, 0.5)).toEqual({ type: 'range', x0: 0.4, x1: 0.7 })
  })

  it('moving an ellipse keeps its size', () => {
    const e = moveGeometry(ell, 0.2, 0.2) as typeof ell
    expect([e.rx, e.ry]).toEqual([0.2, 0.1])
    expect(gateContains(e, e.cx, e.cy)).toBe(true)
  })

  it('what is inside changes with the edit: a larger rectangle contains a point the old one did not', () => {
    expect(gateContains(rect, 0.8, 0.5)).toBe(false)
    expect(gateContains(applyHandle(rect, 'e', [0.9, 0.5]), 0.8, 0.5)).toBe(true)
  })
})

describe('gates in real values', () => {
  const lin: Axis = makeScale({ type: 'linear', min: 0, max: 1000 })
  const biex: Axis = makeScale({ type: 'biex', max: 262144, positiveDecades: 4.5, widthDecades: 0.5, extraNegativeDecades: 0 })

  it('every shape survives the trip to the screen and back', () => {
    const shapes = [
      { type: 'rectangle' as const, x0: 100, y0: 200, x1: 700, y1: 800 },
      { type: 'range' as const, x0: 150, x1: 650 },
      { type: 'quadrant' as const, cx: 400, cy: 600, q: 'ne' as const, link: 'L' },
      { type: 'polygon' as const, points: [[100, 100], [900, 200], [500, 800]] as [number, number][] },
      { type: 'ellipse' as const, cx: 500, cy: 500, rx: 200, ry: 100 },
    ]
    for (const g of shapes) {
      const back = fromDisplayGeometry(toDisplayGeometry(g, lin, lin), lin, lin)
      const rounded = JSON.parse(JSON.stringify(back, (_, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)))
      expect(rounded).toEqual(g)
    }
  })

  it('a threshold means the same value on any scale: the same events are inside', () => {
    // raw values spread over several decades, including negatives
    const values = Float32Array.from({ length: 4000 }, (_, i) => (i % 4 === 0 ? -50 + (i % 97) : Math.pow(10, 1 + ((i % 500) / 500) * 5)))
    const gate: Gate = { id: 'g', xParam: 'x', yParam: '', geometry: { type: 'range', x0: 1e3, x1: 1e5 } }
    const inRaw = values.filter((v) => v >= 1e3 && v <= 1e5).length
    for (const ax of [biex, makeScale({ type: 'biex', max: 262144, positiveDecades: 4.5, widthDecades: 1.2, extraNegativeDecades: 1 }), makeScale({ type: 'arcsinh', min: -1000, max: 262144, cofactor: 150 })]) {
      const disp = toDisplayGeometry(gate.geometry, ax, ax)
      const xs = Float32Array.from(values, (v) => ax.scale(v))
      const n = applyGate({ ...gate, geometry: disp }, xs, null, null).reduce((a, b) => a + b, 0)
      expect(Math.abs(n - inRaw)).toBeLessThanOrEqual(8) // only events within rounding of the edge may differ
    }
  })

  it('a rectangle cuts at the same values whatever the scale', () => {
    const g = { type: 'rectangle' as const, x0: 500, x1: 5000, y0: 500, y1: 5000 }
    const a = toDisplayGeometry(g, biex, biex) as typeof g
    const widened = makeScale({ type: 'biex', max: 262144, positiveDecades: 4.5, widthDecades: 1.5, extraNegativeDecades: 2 })
    const b = toDisplayGeometry(g, widened, widened) as typeof g
    expect(a.x0).not.toBeCloseTo(b.x0, 2) // it moves on the screen...
    expect(biex.inverse(a.x0)).toBeCloseTo(widened.inverse(b.x0), 0) // ...but it is the same value
    expect(biex.inverse(a.y1)).toBeCloseTo(5000, 0)
  })

  it('values beyond the axis stick to its ends instead of producing nonsense', () => {
    const g = toDisplayGeometry({ type: 'range', x0: -1e9, x1: 1e9 }, lin, lin) as { x0: number; x1: number }
    expect(g.x0).toBe(0)
    expect(g.x1).toBe(1)
  })
})

describe('quadrant gates', () => {
  const four = (cx: number, cy: number): Gate[] =>
    (['nw', 'ne', 'se', 'sw'] as const).map((q) => ({ id: q, xParam: 'x', yParam: 'y', geometry: { type: 'quadrant' as const, cx, cy, q, link: 'L' } }))

  it('every event falls in exactly one quarter, even on the lines', () => {
    const rand = mulberry32(3)
    const n = 5000
    const xs = Float32Array.from({ length: n }, (_, i) => (i % 7 === 0 ? 0.4 : rand()))
    const ys = Float32Array.from({ length: n }, (_, i) => (i % 5 === 0 ? 0.6 : rand()))
    const masks = four(0.4, 0.6).map((g) => applyGate(g, xs, ys, null))
    for (let i = 0; i < n; i++) expect(masks.reduce((s, m) => s + m[i], 0)).toBe(1)
    expect(masks.map((m) => countMask(m, n)).reduce((a, b) => a + b, 0)).toBe(n)
  })

  it('puts the quarters where their names say', () => {
    const [nw, ne, se, sw] = four(0.5, 0.5).map((g) => g.geometry)
    expect(gateContains(nw, 0.2, 0.8)).toBe(true)
    expect(gateContains(ne, 0.8, 0.8)).toBe(true)
    expect(gateContains(se, 0.8, 0.2)).toBe(true)
    expect(gateContains(sw, 0.2, 0.2)).toBe(true)
    expect(gateContains(ne, 0.2, 0.2)).toBe(false)
  })

  it('works inside a parent mask', () => {
    const xs = Float32Array.from([0.8, 0.8, 0.2])
    const ys = Float32Array.from([0.8, 0.8, 0.8])
    const ne = four(0.5, 0.5)[1]
    expect(Array.from(applyGate(ne, xs, ys, Uint8Array.from([1, 0, 1])))).toEqual([1, 0, 0])
  })

  it('offers the crosshair handles; the line ends move one line, the centre both', () => {
    const g = four(0.4, 0.6)[1].geometry
    expect(handlesOf(g).map((h) => h.id)).toEqual(['c', 'v', 'h'])
    const v = applyHandle(g, 'v', [0.7, 0.2]) as { cx: number; cy: number }
    expect([v.cx, v.cy]).toEqual([0.7, 0.6]) // the vertical line's end moves only that line
    const h = applyHandle(g, 'h', [0.1, 0.3]) as { cx: number; cy: number }
    expect([h.cx, h.cy]).toEqual([0.4, 0.3])
    const c = applyHandle(g, 'c', [0.2, 0.3]) as { cx: number; cy: number }
    expect([c.cx, c.cy]).toEqual([0.2, 0.3])
  })

  it('keeps every quarter non-empty: the crosshair cannot reach the edge', () => {
    const g = four(0.4, 0.6)[1].geometry
    const c = applyHandle(g, 'c', [5, -5]) as { cx: number; cy: number }
    expect(c.cx).toBeLessThan(1)
    expect(c.cy).toBeGreaterThan(0)
    const m = moveGeometry(g, 9, 9) as { cx: number; cy: number }
    expect(m.cx).toBeLessThan(1)
    expect(m.cy).toBeLessThan(1)
  })

  it('has the quarter as its bounds', () => {
    expect(geometryBounds(four(0.4, 0.6)[1].geometry)).toEqual({ x0: 0.4, y0: 0.6, x1: 1, y1: 1 })
    expect(geometryBounds(four(0.4, 0.6)[3].geometry)).toEqual({ x0: 0, y0: 0, x1: 0.4, y1: 0.6 })
  })
})

describe('histogram', () => {
  it('counts events per bin and keeps the total roughly unchanged by smoothing', () => {
    const xs = Float32Array.from({ length: 1000 }, (_, i) => (i % 100) / 100)
    const h = histogram(xs, null, 100)
    expect(h.length).toBe(100)
    expect(h.reduce((a, b) => a + b, 0)).toBeCloseTo(1000, 0)
  })

  it('only counts the events of the population', () => {
    const xs = Float32Array.from([0.1, 0.1, 0.9])
    const h = histogram(xs, Uint8Array.from([1, 0, 1]), 10)
    expect(h.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 5)
  })

  it('puts a value of exactly 1 in the last bin and ignores nothing out of range', () => {
    const h = histogram(Float32Array.from([1, 0, 1.2, -0.3]), null, 4)
    expect(h.reduce((a, b) => a + b, 0)).toBeCloseTo(4, 5)
  })

  it('handles no events', () => {
    expect(histogram(new Float32Array(0), null, 8).every((v) => v === 0)).toBe(true)
  })
})

describe('stats', () => {
  const v = Float32Array.from([1, 2, 3, 4, 100])
  const mask = Uint8Array.from([1, 1, 1, 1, 0])

  it('counts and percentages', () => {
    expect(countMask(mask, 5)).toBe(4)
    expect(countMask(null, 5)).toBe(5)
    expect(freqOfParent(4, 5)).toBe(80)
    expect(freqOfParent(0, 0)).toBeNaN()
  })

  it('median, mean and CV over a population', () => {
    expect(median(v, mask)).toBe(2.5)
    expect(median(v, null)).toBe(3)
    expect(mean(v, mask)).toBe(2.5)
    expect(cv(Float32Array.from([2, 4, 4, 4, 5, 5, 7, 9]), null)).toBeCloseTo(42.8, 1)
  })

  it('returns NaN rather than a wrong number for empty populations', () => {
    const none = new Uint8Array(5)
    expect(median(v, none)).toBeNaN()
    expect(mean(v, none)).toBeNaN()
    expect(cv(v, none)).toBeNaN()
  })
})
