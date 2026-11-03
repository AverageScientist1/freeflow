import { describe, it, expect } from 'vitest'
import { buildClusterInput, clusterCsv, kmeans, summarizeClusters, zScores } from '../src/core/cluster'
import { tsne, umap } from '../src/core/embed'
import { ROOT_ID, emptyWorkbench, type Workbench } from '../src/core/workbench'
import { parseFcs } from '../src/core/fcs'
import { makeDemoFcs, mulberry32 } from '../src/core/synth'

// Three well separated groups of events in five dimensions.
function blobs(perBlob = 100, d = 5, seed = 3): { X: Float32Array; truth: Uint16Array; n: number } {
  const r = mulberry32(seed)
  const g = (): number => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
  const centres = [[0.2, 0.2, 0.2, 0.2, 0.2], [0.8, 0.2, 0.8, 0.2, 0.5], [0.5, 0.8, 0.2, 0.8, 0.8]]
  const n = perBlob * 3
  const X = new Float32Array(n * d)
  const truth = new Uint16Array(n)
  for (let b = 0; b < 3; b++)
    for (let i = 0; i < perBlob; i++) {
      const row = b * perBlob + i
      truth[row] = b
      for (let c = 0; c < d; c++) X[row * d + c] = centres[b][c] + 0.03 * g()
    }
  return { X, truth, n }
}

// How well labels match the truth: the share of events whose cluster's most common true group is their own.
function purity(labels: ArrayLike<number>, truth: ArrayLike<number>, k: number): number {
  const counts = Array.from({ length: k }, () => new Array<number>(3).fill(0))
  for (let i = 0; i < labels.length; i++) counts[labels[i]][truth[i]]++
  return counts.reduce((a, row) => a + Math.max(...row), 0) / labels.length
}

describe('k-means', () => {
  const { X, truth, n } = blobs()
  it('finds the three groups and is repeatable', () => {
    const a = kmeans(X, n, 5, 3, 7)
    expect(purity(a.labels, truth, 3)).toBeGreaterThan(0.98)
    expect([...kmeans(X, n, 5, 3, 7).labels]).toEqual([...a.labels])
  })
  it('copes with more clusters than events and with one cluster', () => {
    expect(kmeans(X.slice(0, 10), 2, 5, 9, 1).labels.length).toBe(2)
    expect(new Set(kmeans(X, n, 5, 1, 1).labels).size).toBe(1)
  })
})

describe('embeddings', () => {
  const { X, truth, n } = blobs(80)
  it('t-SNE keeps the groups apart in two dimensions, and gives the same picture for the same seed', () => {
    const e = tsne(X, n, 5, { iterations: 300, seed: 5 })
    expect(e.length).toBe(n * 2)
    expect(e.every(Number.isFinite)).toBe(true)
    expect(purity(kmeans(e, n, 2, 3, 1).labels, truth, 3)).toBeGreaterThan(0.95)
    expect([...tsne(X, n, 5, { iterations: 300, seed: 5 }).slice(0, 8)]).toEqual([...e.slice(0, 8)])
  })

  it('UMAP keeps the groups apart too', async () => {
    const e = await umap(X, n, 5, { seed: 2, neighbors: 10 })
    expect(e.length).toBe(n * 2)
    expect(e.every(Number.isFinite)).toBe(true)
    expect(purity(kmeans(e, n, 2, 3, 1).labels, truth, 3)).toBeGreaterThan(0.95)
  }, 60000)

  it('reports progress', () => {
    const seen: number[] = []
    tsne(X.slice(0, 40 * 5), 40, 5, { iterations: 30 }, (f) => seen.push(f))
    expect(seen.length).toBeGreaterThan(0)
    expect(Math.max(...seen)).toBeLessThan(1)
  })
})

function build(): { wb: Workbench; files: Record<string, ReturnType<typeof parseFcs>> } {
  const wb = emptyWorkbench('t')
  wb.samples = [
    { id: 's1', name: 'wt.fcs', source: { kind: 'demo', seed: 1 } },
    { id: 's2', name: 'ko.fcs', source: { kind: 'demo', seed: 2 } },
    { id: 's3', name: 'gone.fcs', source: { kind: 'demo', seed: 3 } },
  ]
  wb.gates = [{ id: 'g1', xParam: 'FSC-A', yParam: 'SSC-A', geometry: { type: 'rectangle', x0: 0, y0: 0, x1: 120000, y1: 60000 } }]
  wb.populations.push({ id: 'p1', name: 'Lymphs', parentId: ROOT_ID, gateId: 'g1', sampleId: 's1' })
  return { wb, files: { s1: parseFcs(makeDemoFcs(1, 6000)), s2: parseFcs(makeDemoFcs(2, 3000)) } }
}

describe('cluster input from samples', () => {
  const { wb, files } = build()
  const params = ['FSC-A', 'SSC-A', 'FL1-A']

  it('takes the same number of events from each sample and remembers where each came from', () => {
    const c = buildClusterInput(wb, files, ['s1', 's2', 's3'], [], params, 1000)
    expect(c.n).toBe(2000) // 1000 from each of the two samples that load
    expect(c.d).toBe(3)
    expect(c.sampleIds).toEqual(['s1', 's2'])
    expect([...c.sample].filter((v) => v === 0).length).toBe(1000)
    expect(c.skipped).toEqual([{ sampleId: 's3', reason: 'its file is not loaded' }])
    expect(c.data.every((v) => v >= -0.2 && v <= 1.2)).toBe(true) // on the scale of the plots
  })

  it('takes fewer when the sample has fewer, and only from the chosen population', () => {
    const all = buildClusterInput(wb, files, ['s1'], [], params, 99999)
    expect(all.n).toBe(6000)
    const lymph = buildClusterInput(wb, files, ['s1'], ['Lymphs'], params, 99999)
    expect(lymph.n).toBeGreaterThan(500)
    expect(lymph.n).toBeLessThan(6000)
    expect(buildClusterInput(wb, files, ['s2'], ['Lymphs'], params, 100).skipped[0].reason).toMatch(/no such population/)
  })

  it('is repeatable, and says which parameter is missing', () => {
    const a = buildClusterInput(wb, files, ['s1'], [], params, 500, 4)
    const b = buildClusterInput(wb, files, ['s1'], [], params, 500, 4)
    expect([...a.data.slice(0, 30)]).toEqual([...b.data.slice(0, 30)])
    expect(buildClusterInput(wb, files, ['s1'], [], ['NOPE'], 10).skipped[0].reason).toMatch(/no parameter NOPE/)
  })
})

describe('summary, heat map scores and CSV', () => {
  const input = { n: 4, d: 2, data: Float32Array.from([0, 1, 0.2, 0.8, 1, 0, 0.8, 0.2]), sample: Uint16Array.from([0, 1, 0, 1]), sampleIds: ['a', 'b'], params: ['P1', 'P2'], skipped: [] }
  const labels = Uint16Array.from([0, 0, 1, 1])

  it('counts, takes medians and splits by sample', () => {
    const s = summarizeClusters(input, labels, 2)
    expect(s.counts).toEqual([2, 2])
    expect(s.median[0][0]).toBeCloseTo(0.1, 6)
    expect(s.median[1][1]).toBeCloseTo(0.1, 6)
    expect(s.bySample).toEqual([[1, 1], [1, 1]])
  })

  it('z-scores each parameter across clusters', () => {
    const z = zScores([[0.1, 0.9], [0.9, 0.1]])
    expect(z[0][0]).toBeCloseTo(-1, 9)
    expect(z[1][0]).toBeCloseTo(1, 9)
    expect(zScores([[0.5, 0.5], [0.5, 0.5]]).flat().every((v) => v === 0)).toBe(true)
  })

  it('writes one row per event', () => {
    const csv = clusterCsv(input, ['P1', 'P2'], Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]), labels, (id) => `${id}.fcs`, { decimal: ',', delimiter: ';' })
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('Sample;Embedding 1;Embedding 2;Cluster;P1;P2')
    expect(lines).toHaveLength(5)
    expect(lines[1]).toBe('a.fcs;1;2;1;0;1')
    expect(lines[2]).toBe('b.fcs;3;4;1;0,2;0,8')
  })
})
