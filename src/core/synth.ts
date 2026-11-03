// Synthetic FCS data: a writer (used by tests) and a demo sample generator (so the app can be tried
// without any real data). Nothing here is taken from any real instrument or from another program.

export interface SynthParam {
  name: string
  stain?: string
  range: number
}

export interface WriteOptions {
  dataType?: 'F' | 'D' | 'I'
  littleEndian?: boolean
  bits?: number // for dataType I
  extraKeywords?: Record<string, string>
}

export function writeFcs(params: SynthParam[], columns: ArrayLike<number>[], opts: WriteOptions = {}): ArrayBuffer {
  const dataType = opts.dataType ?? 'F'
  const little = opts.littleEndian ?? true
  const bits = dataType === 'F' ? 32 : dataType === 'D' ? 64 : (opts.bits ?? 16)
  const total = columns[0]?.length ?? 0
  const stride = (params.length * bits) / 8
  const delim = '/'
  const pad = (n: number): string => String(n).padStart(10, '0')

  const build = (dataStart: number): string => {
    const kv: [string, string][] = [
      ['$BEGINDATA', pad(dataStart)],
      ['$ENDDATA', pad(dataStart + total * stride - 1)],
      ['$BYTEORD', little ? '1,2,3,4' : '4,3,2,1'],
      ['$DATATYPE', dataType],
      ['$MODE', 'L'],
      ['$NEXTDATA', '0'],
      ['$PAR', String(params.length)],
      ['$TOT', String(total)],
    ]
    params.forEach((p, i) => {
      kv.push([`$P${i + 1}B`, String(bits)], [`$P${i + 1}E`, '0,0'], [`$P${i + 1}N`, p.name], [`$P${i + 1}R`, String(p.range)])
      if (p.stain) kv.push([`$P${i + 1}S`, p.stain])
    })
    for (const [k, v] of Object.entries(opts.extraKeywords ?? {})) kv.push([k, v])
    return delim + kv.map(([k, v]) => `${k}${delim}${v.split(delim).join(delim + delim)}${delim}`).join('')
  }

  const textStart = 256
  const text0 = build(0)
  const dataStart = textStart + text0.length
  const text = build(dataStart)
  const textEnd = textStart + text.length - 1
  const out = new ArrayBuffer(dataStart + total * stride)
  const bytes = new Uint8Array(out)
  const head =
    'FCS3.1    ' + String(textStart).padStart(8) + String(textEnd).padStart(8) + String(dataStart).padStart(8) +
    String(dataStart + total * stride - 1).padStart(8) + '       0       0'
  for (let i = 0; i < head.length; i++) bytes[i] = head.charCodeAt(i)
  for (let i = head.length; i < textStart; i++) bytes[i] = 32
  for (let i = 0; i < text.length; i++) bytes[textStart + i] = text.charCodeAt(i)

  const view = new DataView(out)
  for (let ev = 0; ev < total; ev++) {
    for (let p = 0; p < params.length; p++) {
      const at = dataStart + ev * stride + (p * bits) / 8
      const v = columns[p][ev]
      if (dataType === 'F') view.setFloat32(at, v, little)
      else if (dataType === 'D') view.setFloat64(at, v, little)
      else if (bits === 8) view.setUint8(at, v)
      else if (bits === 16) view.setUint16(at, v, little)
      else view.setUint32(at, v, little)
    }
  }
  return out
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

export const DEMO_PARAMS: SynthParam[] = [
  { name: 'FSC-A', range: 262144 },
  { name: 'SSC-A', range: 262144 },
  { name: 'FSC-H', range: 262144 },
  { name: 'SSC-H', range: 262144 },
  { name: 'FL1-A', stain: 'Marker A FITC', range: 262144 },
  { name: 'FL2-A', stain: 'Marker B PE', range: 262144 },
  { name: 'Time', range: 262144 },
]

// Three scatter populations (debris, lymphocyte-like, large cells); two fluorescence markers with a
// negative and a positive peak, including slightly negative values like compensated data.
export function makeDemoFcs(seed = 1, events = 20000): ArrayBuffer {
  const rand = mulberry32(seed)
  const cols = DEMO_PARAMS.map(() => new Float32Array(events))
  for (let i = 0; i < events; i++) {
    const r = rand()
    let fsc: number, ssc: number
    if (r < 0.1) {
      fsc = 12000 + 5000 * gaussian(rand)
      ssc = 9000 + 4000 * gaussian(rand)
    } else if (r < 0.7) {
      fsc = 80000 + 12000 * gaussian(rand)
      ssc = 25000 + 7000 * gaussian(rand)
    } else {
      fsc = 130000 + 15000 * gaussian(rand)
      ssc = 80000 + 15000 * gaussian(rand)
    }
    fsc = Math.min(Math.max(fsc, 0), 262143)
    ssc = Math.min(Math.max(ssc, 0), 262143)
    const aPos = rand() < 0.35
    const bPos = rand() < 0.5
    const fl1 = aPos ? 20000 * Math.exp(0.35 * gaussian(rand)) : 60 * gaussian(rand)
    const fl2 = bPos ? 8000 * Math.exp(0.4 * gaussian(rand)) : 40 * gaussian(rand)
    cols[0][i] = fsc
    cols[1][i] = ssc
    cols[2][i] = fsc * (0.85 + 0.05 * gaussian(rand))
    cols[3][i] = ssc * (0.85 + 0.05 * gaussian(rand))
    cols[4][i] = fl1
    cols[5][i] = fl2
    cols[6][i] = (i / events) * 60
  }
  return writeFcs(DEMO_PARAMS, cols)
}
