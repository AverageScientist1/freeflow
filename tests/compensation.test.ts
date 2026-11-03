import { describe, it, expect } from 'vitest'
import { compensate, invert, isIdentity, parseSpillover, COMP_PREFIX, type CompMatrix } from '../src/core/compensation'
import { parseFcs } from '../src/core/fcs'
import { writeFcs, mulberry32 } from '../src/core/synth'

const close = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol

function multiply(a: number[][], b: number[][]): number[][] {
  return a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)))
}

describe('parseSpillover', () => {
  it('reads $SPILLOVER row by row', () => {
    const r = parseSpillover({ $SPILLOVER: '2,FL1-A,FL2-A,1,0.2,0.05,1' })!
    expect(r.parameters).toEqual(['FL1-A', 'FL2-A'])
    expect(r.values).toEqual([[1, 0.2], [0.05, 1]])
  })

  it('reads the matrix of the real CytoFLEX files (identity 2x2)', () => {
    const r = parseSpillover({ $SPILLOVER: '2,FL1-H,FL1-A,1,0,0,1' })!
    expect(r.parameters).toEqual(['FL1-H', 'FL1-A'])
    expect(isIdentity(r.values)).toBe(true)
  })

  it('accepts the older $SPILL name and tolerates spaces', () => {
    expect(parseSpillover({ $SPILL: ' 1 , FL1-A , 1 ' })!.values).toEqual([[1]])
  })

  it('reads $COMP for the first n parameters', () => {
    const params = [{ index: 1, name: 'A', stain: '', range: 1, bits: 32 }, { index: 2, name: 'B', stain: '', range: 1, bits: 32 }]
    const r = parseSpillover({ $COMP: '2,1,0.1,0,1' }, params)!
    expect(r.parameters).toEqual(['A', 'B'])
    expect(r.values).toEqual([[1, 0.1], [0, 1]])
  })

  const bad: [string, Record<string, string>][] = [
    ['no keyword', {}],
    ['wrong count', { $SPILLOVER: '2,A,B,1,0,0' }],
    ['not a number', { $SPILLOVER: '2,A,B,1,x,0,1' }],
    ['zero size', { $SPILLOVER: '0' }],
    ['duplicate names', { $SPILLOVER: '2,A,A,1,0,0,1' }],
    ['empty name', { $SPILLOVER: '2,A,,1,0,0,1' }],
    ['not an integer count', { $SPILLOVER: '1.5,A,1' }],
    ['infinite value', { $SPILLOVER: '1,A,Infinity' }],
  ]
  for (const [name, kw] of bad) it(`returns null for ${name}`, () => expect(parseSpillover(kw)).toBeNull())
})

describe('invert', () => {
  it('inverts a 2x2', () => {
    const inv = invert([[1, 0.2], [0.05, 1]])!
    const p = multiply([[1, 0.2], [0.05, 1]], inv)
    expect(close(p[0][0], 1) && close(p[1][1], 1) && close(p[0][1], 0) && close(p[1][0], 0)).toBe(true)
  })

  it('inverts a random well-conditioned 6x6 matrix', () => {
    const rand = mulberry32(5)
    const m = Array.from({ length: 6 }, (_, i) => Array.from({ length: 6 }, (_, j) => (i === j ? 1 : rand() * 0.2)))
    const p = multiply(m, invert(m)!)
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) expect(close(p[i][j], i === j ? 1 : 0, 1e-9)).toBe(true)
  })

  it('needs a pivot swap when a diagonal value is zero', () => {
    const inv = invert([[0, 1], [1, 0]])!
    expect(inv).toEqual([[0, 1], [1, 0]])
  })

  it('returns null for singular, non-square or non-finite matrices', () => {
    expect(invert([[1, 2], [2, 4]])).toBeNull()
    expect(invert([[0, 0], [0, 0]])).toBeNull()
    expect(invert([[1, 2, 3], [4, 5, 6]])).toBeNull()
    expect(invert([[1, NaN], [0, 1]])).toBeNull()
    expect(invert([])).toBeNull()
  })
})

describe('compensate', () => {
  const S = [[1, 0.2], [0.05, 1]] // FL1 spills 20% into FL2; FL2 spills 5% into FL1
  const matrix: CompMatrix = { id: 'm', name: 'm', parameters: ['FL1-A', 'FL2-A'], values: S, source: 'manual' }

  // true signals, then the observed ones = true x S
  const rand = mulberry32(11)
  const n = 2000
  const t1 = Float32Array.from({ length: n }, () => (rand() < 0.4 ? 20000 * (0.7 + rand() * 0.6) : (rand() - 0.5) * 200))
  const t2 = Float32Array.from({ length: n }, () => (rand() < 0.5 ? 8000 * (0.7 + rand() * 0.6) : (rand() - 0.5) * 100))
  const o1 = t1.map((v, i) => v * S[0][0] + t2[i] * S[1][0])
  const o2 = t1.map((v, i) => v * S[0][1] + t2[i] * S[1][1])
  const scatter = Float32Array.from({ length: n }, (_, i) => 1000 + i)
  const file = parseFcs(writeFcs(
    [{ name: 'FSC-A', range: 262144 }, { name: 'FL1-A', range: 262144 }, { name: 'FL2-A', range: 262144 }],
    [scatter, o1, o2],
  ))

  it('recovers the true signals from the observed ones', () => {
    const { file: c, error } = compensate(file, matrix)
    expect(error).toBeNull()
    const a = c.columns[c.parameters.findIndex((p) => p.name === COMP_PREFIX + 'FL1-A')]
    const b = c.columns[c.parameters.findIndex((p) => p.name === COMP_PREFIX + 'FL2-A')]
    let worst = 0
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(a[i] - t1[i]) / (Math.abs(t1[i]) + 100), Math.abs(b[i] - t2[i]) / (Math.abs(t2[i]) + 100))
    expect(worst).toBeLessThan(2e-3)
  })

  it('keeps the original columns and adds Comp- columns after them, with the same stain and range', () => {
    const { file: c } = compensate(file, matrix)
    expect(c.parameters.map((p) => p.name)).toEqual(['FSC-A', 'FL1-A', 'FL2-A', 'Comp-FL1-A', 'Comp-FL2-A'])
    expect(c.parameters[3].index).toBe(4)
    expect(c.columns[1]).toBe(file.columns[1]) // untouched, not copied
    expect(c.eventCount).toBe(file.eventCount)
  })

  it('does not change parameters that are not in the matrix', () => {
    const { file: c } = compensate(file, matrix)
    expect(Array.from(c.columns[0])).toEqual(Array.from(scatter))
  })

  it('an identity matrix changes nothing', () => {
    const id: CompMatrix = { ...matrix, values: [[1, 0], [0, 1]] }
    const { file: c } = compensate(file, id)
    for (let i = 0; i < n; i += 97) expect(close(c.columns[3][i], file.columns[1][i], 1e-2)).toBe(true)
  })

  it('creates negative values for background cells, as compensation does', () => {
    const { file: c } = compensate(file, matrix)
    expect(Array.from(c.columns[4]).some((v) => v < 0)).toBe(true)
  })

  it('reports a missing parameter and returns the original file', () => {
    const r = compensate(file, { ...matrix, id: 'x', parameters: ['FL1-A', 'FL9-A'] })
    expect(r.error).toMatch(/FL9-A/)
    expect(r.file).toBe(file)
  })

  it('reports a singular matrix and returns the original file', () => {
    const r = compensate(file, { ...matrix, id: 'y', values: [[1, 2], [2, 4]] })
    expect(r.error).toMatch(/cannot be inverted/)
    expect(r.file).toBe(file)
  })

  it('caches the result per file and matrix values', () => {
    expect(compensate(file, matrix)).toBe(compensate(file, { ...matrix, name: 'renamed' }))
    expect(compensate(file, matrix)).not.toBe(compensate(file, { ...matrix, values: [[1, 0.3], [0.05, 1]] }))
  })

  it('keeps only the latest few results per file', () => {
    const first = compensate(file, { ...matrix, values: [[1, 0.11], [0.05, 1]] })
    for (let k = 0; k < 5; k++) compensate(file, { ...matrix, values: [[1, 0.12 + k / 100], [0.05, 1]] })
    expect(compensate(file, { ...matrix, values: [[1, 0.11], [0.05, 1]] })).not.toBe(first) // evicted, so recomputed
    const latest = compensate(file, { ...matrix, values: [[1, 0.16], [0.05, 1]] })
    expect(compensate(file, { ...matrix, values: [[1, 0.16], [0.05, 1]] })).toBe(latest) // recent ones stay cached
  })

  it('works on a file with zero events', () => {
    const empty = parseFcs(writeFcs([{ name: 'FL1-A', range: 1 }, { name: 'FL2-A', range: 1 }], [[], []]))
    const r = compensate(empty, matrix)
    expect(r.error).toBeNull()
    expect(r.file.columns[2].length).toBe(0)
  })
})
