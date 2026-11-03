// Two-dimensional embeddings: t-SNE (written here, exact, for a few thousand events) and UMAP (the umap-js library).
// Both are repeatable for a given seed. They run in a worker (see clusterWorker.ts) because they take seconds.

import { UMAP } from 'umap-js'
import { mulberry32 } from './synth'

export type EmbedAlgo = 'umap' | 'tsne'
export interface EmbedOptions {
  seed: number
  neighbors: number // UMAP: size of the neighbourhood
  minDist: number // UMAP: how tightly points may pack
  perplexity: number // t-SNE
  iterations: number // t-SNE
}
export const DEFAULT_EMBED: EmbedOptions = { seed: 1, neighbors: 15, minDist: 0.1, perplexity: 30, iterations: 500 }

type Progress = (fraction: number) => void

function gauss(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand())
}

export function tsne(X: Float32Array, n: number, d: number, o: Partial<EmbedOptions> = {}, onProgress?: Progress): Float32Array {
  const opt = { ...DEFAULT_EMBED, ...o }
  const perp = Math.max(2, Math.min(opt.perplexity, (n - 1) / 3))
  const rand = mulberry32(opt.seed)
  // squared distances
  const D = new Float32Array(n * n)
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      let s = 0
      for (let c = 0; c < d; c++) { const v = X[i * d + c] - X[j * d + c]; s += v * v }
      D[i * n + j] = s; D[j * n + i] = s
    }
  // conditional probabilities with the precision chosen so each row has the wanted perplexity
  const P = new Float64Array(n * n)
  const target = Math.log(perp)
  for (let i = 0; i < n; i++) {
    let beta = 1, lo = 0, hi = Infinity
    for (let t = 0; t < 50; t++) {
      let sum = 0
      for (let j = 0; j < n; j++) if (j !== i) { const v = Math.exp(-D[i * n + j] * beta); P[i * n + j] = v; sum += v }
      sum = Math.max(sum, 1e-300)
      let h = 0
      for (let j = 0; j < n; j++) if (j !== i) { const p = P[i * n + j] / sum; P[i * n + j] = p; if (p > 1e-300) h -= p * Math.log(p) }
      const diff = h - target
      if (Math.abs(diff) < 1e-5) break
      if (diff > 0) { lo = beta; beta = hi === Infinity ? beta * 2 : (beta + hi) / 2 } else { hi = beta; beta = (beta + lo) / 2 }
    }
  }
  // symmetrize
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) { const v = (P[i * n + j] + P[j * n + i]) / (2 * n); P[i * n + j] = v; P[j * n + i] = v }
  const Y = new Float64Array(n * 2)
  for (let i = 0; i < Y.length; i++) Y[i] = gauss(rand) * 1e-2
  const vel = new Float64Array(n * 2)
  const gain = new Float64Array(n * 2).fill(1)
  const grad = new Float64Array(n * 2)
  const num = new Float64Array(n * n)
  const lr = Math.max(50, n / 12)
  const exagUntil = Math.min(120, Math.floor(opt.iterations / 4))
  for (let it = 0; it < opt.iterations; it++) {
    let sumQ = 0
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = Y[i * 2] - Y[j * 2], dy = Y[i * 2 + 1] - Y[j * 2 + 1]
        const v = 1 / (1 + dx * dx + dy * dy)
        num[i * n + j] = v; num[j * n + i] = v; sumQ += 2 * v
      }
    sumQ = Math.max(sumQ, 1e-12)
    const exag = it < exagUntil ? 12 : 1
    grad.fill(0)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (i === j) continue
        const m = (exag * P[i * n + j] - num[i * n + j] / sumQ) * num[i * n + j]
        grad[i * 2] += 4 * m * (Y[i * 2] - Y[j * 2])
        grad[i * 2 + 1] += 4 * m * (Y[i * 2 + 1] - Y[j * 2 + 1])
      }
    const momentum = it < exagUntil ? 0.5 : 0.8
    for (let k = 0; k < n * 2; k++) {
      gain[k] = Math.sign(grad[k]) === Math.sign(vel[k]) ? gain[k] * 0.8 : gain[k] + 0.2
      if (gain[k] < 0.01) gain[k] = 0.01
      vel[k] = momentum * vel[k] - lr * gain[k] * grad[k]
      Y[k] += vel[k]
    }
    // keep the middle at zero
    let mx = 0, my = 0
    for (let i = 0; i < n; i++) { mx += Y[i * 2]; my += Y[i * 2 + 1] }
    mx /= n; my /= n
    for (let i = 0; i < n; i++) { Y[i * 2] -= mx; Y[i * 2 + 1] -= my }
    if (onProgress && it % 10 === 0) onProgress(it / opt.iterations)
  }
  return Float32Array.from(Y)
}

export async function umap(X: Float32Array, n: number, d: number, o: Partial<EmbedOptions> = {}, onProgress?: Progress): Promise<Float32Array> {
  const opt = { ...DEFAULT_EMBED, ...o }
  const rows: number[][] = []
  for (let i = 0; i < n; i++) rows.push(Array.from(X.subarray(i * d, (i + 1) * d)))
  const model = new UMAP({ nComponents: 2, nNeighbors: Math.max(2, Math.min(opt.neighbors, n - 1)), minDist: opt.minDist, random: mulberry32(opt.seed) })
  const epochs = model.initializeFit(rows)
  for (let e = 0; e < epochs; e++) {
    model.step()
    if (onProgress && e % 5 === 0) onProgress(e / epochs)
  }
  const out = model.getEmbedding()
  const flat = new Float32Array(n * 2)
  out.forEach((p, i) => { flat[i * 2] = p[0]; flat[i * 2 + 1] = p[1] })
  return flat
}

export async function embed(algo: EmbedAlgo, X: Float32Array, n: number, d: number, o: Partial<EmbedOptions> = {}, onProgress?: Progress): Promise<Float32Array> {
  return algo === 'umap' ? umap(X, n, d, o, onProgress) : tsne(X, n, d, o, onProgress)
}
