import { embed, type EmbedAlgo, type EmbedOptions } from '@core/embed'

// Runs an embedding away from the window, so the program stays usable while it works.
interface Job { algo: EmbedAlgo; data: Float32Array; n: number; d: number; options: Partial<EmbedOptions> }

const post = (message: unknown, transfer: Transferable[] = []): void => (self as unknown as Worker).postMessage(message, transfer)

self.onmessage = async (e: MessageEvent<Job>): Promise<void> => {
  const m = e.data
  try {
    const out = await embed(m.algo, m.data, m.n, m.d, m.options, (fraction) => post({ kind: 'progress', fraction }))
    post({ kind: 'done', embedding: out }, [out.buffer])
  } catch (err) {
    post({ kind: 'error', message: (err as Error).message })
  }
}