import { describe, it, expect } from 'vitest'
import { bandImage, contourLevels, contourSegments, densityField, outlierPoints, sampleField } from '../src/core/contour'
import { mulberry32 } from '../src/core/synth'

// One round population in the middle of the plot plus a few events scattered over the whole plot.
function cloud(): { xs: Float32Array; ys: Float32Array } {
  const r = mulberry32(7)
  const gauss = (): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < 20000; i++) { xs.push(0.5 + 0.07 * gauss()); ys.push(0.5 + 0.07 * gauss()) }
  for (let i = 0; i < 40; i++) { xs.push(0.02 + 0.96 * r()); ys.push(0.02 + 0.96 * r()) }
  return { xs: Float32Array.from(xs), ys: Float32Array.from(ys) }
}

describe('density field', () => {
  const { xs, ys } = cloud()
  const f = densityField(xs, ys, null)

  it('keeps the events: smoothing moves counts around but does not lose them', () => {
    expect(f.total).toBe(20040)
    expect(f.values.reduce((a, b) => a + b, 0)).toBeCloseTo(20040, 3)
  })

  it('is highest in the middle and zero far from the events', () => {
    expect(sampleField(f, 0.5, 0.5)).toBeGreaterThan(sampleField(f, 0.7, 0.5))
    expect(sampleField(f, -0.1, 0.5)).toBe(0)
    const mid = f.n / 2
    expect(sampleField(f, 0.5, 0.5)).toBeGreaterThan(f.values[mid * f.n + mid] * 0.7)
  })

  it('only counts events inside the mask', () => {
    const mask = new Uint8Array(xs.length)
    for (let i = 0; i < 100; i++) mask[i] = 1
    expect(densityField(xs, ys, mask).total).toBe(100)
  })

  it('ignores values that are not numbers', () => {
    expect(densityField(Float32Array.from([NaN, 0.5]), Float32Array.from([0.5, 0.5]), null).total).toBe(1)
  })
})

describe('contour levels', () => {
  const { xs, ys } = cloud()
  const f = densityField(xs, ys, null)

  it('rise strictly, and enclose from about 5% up to about 95% of the events', () => {
    const levels = contourLevels(f, 10)
    expect(levels.length).toBeGreaterThanOrEqual(8)
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1])
    const enclosed = (lvl: number): number => f.values.reduce((a, v) => a + (v >= lvl ? v : 0), 0) / 20040
    expect(enclosed(levels[levels.length - 1])).toBeGreaterThanOrEqual(0.05)
    expect(enclosed(levels[levels.length - 1])).toBeLessThan(0.2)
    expect(enclosed(levels[0])).toBeGreaterThanOrEqual(0.93)
    expect(enclosed(levels[0])).toBeLessThan(1)
  })

  it('has none without events', () => {
    expect(contourLevels(densityField(new Float32Array(0), new Float32Array(0), null), 10)).toEqual([])
  })
})

describe('contour lines', () => {
  const { xs, ys } = cloud()
  const f = densityField(xs, ys, null)
  const level = contourLevels(f, 5)[2]
  const seg = contourSegments(f, level)

  it('make a closed ring around the population', () => {
    expect(seg.length / 4).toBeGreaterThan(12)
    const key = (x: number, y: number): string => `${x.toFixed(4)},${y.toFixed(4)}`
    const ends = new Map<string, number>()
    for (let i = 0; i < seg.length; i += 4) {
      ends.set(key(seg[i], seg[i + 1]), (ends.get(key(seg[i], seg[i + 1])) ?? 0) + 1)
      ends.set(key(seg[i + 2], seg[i + 3]), (ends.get(key(seg[i + 2], seg[i + 3])) ?? 0) + 1)
    }
    // every point of a closed line is the end of two segments
    expect([...ends.values()].every((c) => c === 2)).toBe(true)
  })

  it('stay at the same distance from the middle of a round population', () => {
    const radii: number[] = []
    for (let i = 0; i < seg.length; i += 2) radii.push(Math.hypot(seg[i] - 0.5, seg[i + 1] - 0.5))
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length
    expect(mean).toBeGreaterThan(0.03)
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(mean * 0.35)
  })

  it('lie on the level: the field there is the level', () => {
    for (let i = 0; i < seg.length; i += 8) {
      const mx = (seg[i] + seg[i + 2]) / 2
      const my = (seg[i + 1] + seg[i + 3]) / 2
      expect(sampleField(f, mx, my)).toBeGreaterThan(level * 0.7)
      expect(sampleField(f, mx, my)).toBeLessThan(level * 1.3)
    }
  })

  it('draw nothing above the highest value or for a flat field', () => {
    expect(contourSegments(f, Math.max(...f.values) * 2).length).toBe(0)
  })
})

describe('zebra bands and outliers', () => {
  const { xs, ys } = cloud()
  const f = densityField(xs, ys, null)
  const levels = contourLevels(f, 8)

  it('count levels inward: the middle is the innermost band and the corner is outside', () => {
    const size = 64
    const bands = bandImage(f, levels, size)
    expect(bands[(size / 2) * size + size / 2]).toBe(levels.length)
    expect(bands[0]).toBe(0)
    expect(bands.length).toBe(size * size)
  })

  it('finds the scattered events and not the population', () => {
    const out = outlierPoints(xs, ys, null, f, levels[0])
    const n = out.length / 2
    expect(n).toBeGreaterThan(10)
    expect(n).toBeLessThan(1500) // the thin tail of the population beyond the 95% contour, plus the 40 scattered events
    let inside = 0
    for (let i = 0; i < out.length; i += 2) if (Math.hypot(out[i] - 0.5, out[i + 1] - 0.5) < 0.1) inside++
    expect(inside).toBeLessThan(n * 0.2)
  })

  it('caps the number of outliers drawn', () => {
    expect(outlierPoints(xs, ys, null, f, Infinity, 1000).length / 2).toBeLessThanOrEqual(1000)
  })
})
