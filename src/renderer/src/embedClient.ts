import type { EmbedAlgo, EmbedOptions } from '@core/embed'

export interface EmbedJob { promise: Promise<Float32Array>; cancel: () => void }

// Starts an embedding in a worker. Without worker support it runs in the page (slower for the window, same result).
export function runEmbedding(algo: EmbedAlgo, data: Float32Array, n: number, d: number, options: Partial<EmbedOptions>, onProgress: (fraction: number) => void): EmbedJob {
  if (typeof Worker === 'undefined') {
    return { promise: import('@core/embed').then((m) => m.embed(algo, data, n, d, options, onProgress)), cancel: () => undefined }
  }
  const worker = new Worker(new URL('./clusterWorker.ts', import.meta.url), { type: 'module' })
  let reject: (e: Error) => void = () => undefined
  const promise = new Promise<Float32Array>((res, rej) => {
    reject = rej
    worker.onmessage = (e: MessageEvent<{ kind: string; fraction?: number; embedding?: Float32Array; message?: string }>): void => {
      const m = e.data
      if (m.kind === 'progress') onProgress(m.fraction ?? 0)
      else if (m.kind === 'done') { worker.terminate(); res(m.embedding as Float32Array) }
      else { worker.terminate(); rej(new Error(m.message ?? 'The embedding failed')) }
    }
    worker.onerror = (e): void => { worker.terminate(); rej(new Error(e.message || 'The embedding worker could not start')) }
    worker.postMessage({ algo, data, n, d, options })
  })
  return { promise, cancel: () => { worker.terminate(); reject(new Error('Cancelled')) } }
}