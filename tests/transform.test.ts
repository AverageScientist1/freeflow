import { describe, it, expect } from 'vitest'
import { makeScale, fitDefaultSpec, type TransformSpec } from '../src/core/transform'

const biex: TransformSpec = { type: 'biex', max: 262144, positiveDecades: 4.5, widthDecades: 0.5, extraNegativeDecades: 0 }

describe('biexponential (logicle)', () => {
  const s = makeScale(biex)

  it('maps the maximum to 1 and the bottom of the range to a non-negative position', () => {
    expect(s.scale(262144)).toBeCloseTo(1, 4)
    expect(s.scale(-1e9)).toBeGreaterThanOrEqual(0)
    expect(s.scale(1e12)).toBe(1)
  })

  it('puts zero at the linear-to-log transition and is monotonic', () => {
    const z = s.scale(0)
    expect(z).toBeGreaterThan(0)
    expect(z).toBeLessThan(0.5)
    let prev = -1
    for (const v of [-1000, -100, -10, 0, 10, 100, 1000, 1e4, 1e5, 262144]) {
      const x = s.scale(v)
      expect(x).toBeGreaterThan(prev)
      prev = x
    }
  })

  it('is symmetric about zero while the negative side is still on the axis', () => {
    const z = s.scale(0)
    let checked = 0
    for (const v of [1, 5, 10, 30, 100, 5000]) {
      if (s.scale(-v) <= 0) continue // with no extra negative decades, very negative values sit on the axis edge
      expect(s.scale(-v) - z).toBeCloseTo(-(s.scale(v) - z), 3)
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(3)
  })

  it('pins very negative values to the axis edge when there are no extra negative decades', () => {
    expect(s.scale(-1e6)).toBe(0)
  })

  it('round-trips values through scale and inverse', () => {
    for (const v of [-3, 0, 7, 250, 4000, 90000, 262144]) {
      const back = s.inverse(s.scale(v))
      expect(Math.abs(back - v)).toBeLessThan(Math.max(1e-2, Math.abs(v) * 2e-3))
    }
  })

  it('shows about 4.5 decades above zero in log-like fashion at high values', () => {
    const d = s.scale(262144) - s.scale(26214.4)
    const d2 = s.scale(26214.4) - s.scale(2621.44)
    expect(d / d2).toBeGreaterThan(0.95)
    expect(d / d2).toBeLessThan(1.05)
  })

  it('supports extra negative decades', () => {
    const t = makeScale({ ...biex, extraNegativeDecades: 1 })
    expect(t.scale(0)).toBeGreaterThan(s.scale(0))
    expect(t.scale(-50)).toBeGreaterThan(0)
    expect(t.scale(-50)).toBeGreaterThan(s.scale(-50))
  })

  it('gives ticks with labels and increasing positions', () => {
    const ticks = s.ticks()
    expect(ticks.some((t) => t.label === '0')).toBe(true)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].x).toBeGreaterThanOrEqual(ticks[i - 1].x)
  })
})

describe('fitDefaultSpec', () => {
  const col = (f: (i: number) => number, n = 1000): Float32Array => Float32Array.from({ length: n }, (_, i) => f(i))

  it('fits a linear axis to data that uses a small slice of a huge declared range', () => {
    // like a CytoFLEX: declared range 16,777,216, bulk of the events near 150,000
    const data = col((i) => 60000 + (i / 1000) * 1000000)
    const s = fitDefaultSpec('FSC-A', 16777216, data)
    expect(s.type).toBe('linear')
    if (s.type === 'linear') {
      expect(s.max).toBeGreaterThanOrEqual(1000000)
      expect(s.max).toBeLessThanOrEqual(5000000)
    }
  })

  it('keeps the declared range when the data already uses a good part of it', () => {
    const data = col((i) => 20000 + (i / 1000) * 200000)
    expect(fitDefaultSpec('FSC-A', 262144, data)).toEqual({ type: 'linear', min: 0, max: 262144 })
  })

  it('leaves fluorescence on a biexponential scale', () => {
    expect(fitDefaultSpec('FL1-A', 16777216, col((i) => i)).type).toBe('biex')
  })

  it('widens the biexponential linear region to fit the negative values', () => {
    // negatives down to about -20,000 on a 16.7M axis need a wider linear region than the default 0.5
    const data = col((i) => (i < 100 ? -20000 + i * 150 : 100 + i * 50))
    const s = fitDefaultSpec('FL1-A', 16777216, data)
    expect(s.type).toBe('biex')
    if (s.type === 'biex') {
      expect(s.widthDecades).toBeGreaterThan(0.6)
      expect(s.widthDecades).toBeLessThanOrEqual(s.positiveDecades / 2)
      expect(makeScale(s).scale(-15000)).toBeGreaterThan(0.01) // no longer pinned to the edge
    }
  })

  it('keeps the default width when there are almost no negatives', () => {
    const data = col((i) => i + 1)
    const s = fitDefaultSpec('FL1-A', 262144, data)
    expect(s.type === 'biex' && s.widthDecades).toBe(0.5)
  })

  it('does not fit on a handful of events', () => {
    expect(fitDefaultSpec('FSC-A', 16777216, col((i) => i, 5))).toEqual({ type: 'linear', min: 0, max: 16777216 })
  })
})

describe('other scales', () => {
  it('linear', () => {
    const s = makeScale({ type: 'linear', min: 0, max: 1000 })
    expect(s.scale(500)).toBe(0.5)
    expect(s.scale(-5)).toBe(0)
    expect(s.inverse(0.25)).toBe(250)
  })

  it('log clamps below the minimum and maps decades evenly', () => {
    const s = makeScale({ type: 'log', min: 1, max: 1e4 })
    expect(s.scale(0.1)).toBe(0)
    expect(s.scale(100)).toBeCloseTo(0.5, 6)
    expect(s.inverse(0.75)).toBeCloseTo(1000, 3)
  })

  it('arcsinh round-trips', () => {
    const s = makeScale({ type: 'arcsinh', min: -1000, max: 100000, cofactor: 150 })
    for (const v of [-500, 0, 300, 50000]) expect(s.inverse(s.scale(v))).toBeCloseTo(v, 3)
  })
})
