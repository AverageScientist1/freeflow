// Axis transforms. Every scale maps a raw value to a display coordinate in [0, 1] and back.
// Biexponential follows the Logicle function from Parks, Roederer and Moore (Cytometry A, 2006).

export type TransformSpec =
  | { type: 'linear'; min: number; max: number }
  | { type: 'log'; min: number; max: number }
  | { type: 'arcsinh'; min: number; max: number; cofactor: number }
  | { type: 'biex'; max: number; positiveDecades: number; widthDecades: number; extraNegativeDecades: number }

export interface Tick {
  x: number // display coordinate, 0..1
  label: string
  major: boolean
}

export interface Scale {
  spec: TransformSpec
  scale(v: number): number
  inverse(x: number): number
  ticks(): Tick[]
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻',
}
export function powerLabel(exp: number, negative = false): string {
  return (negative ? '-' : '') + '10' + String(exp).split('').map((c) => SUPERSCRIPTS[c] ?? c).join('')
}

function niceStep(range: number, target: number): number {
  const raw = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const n = raw / mag
  return (n >= 5 ? 10 : n >= 2 ? 5 : n >= 1 ? 2 : 1) * mag
}

function formatNumber(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `${v / 1e6}M`
  if (a >= 1e3) return `${v / 1e3}K`
  return String(v)
}

function linearScale(spec: Extract<TransformSpec, { type: 'linear' }>): Scale {
  const span = spec.max - spec.min
  return {
    spec,
    scale: (v) => clamp01((v - spec.min) / span),
    inverse: (x) => spec.min + x * span,
    ticks() {
      const step = niceStep(span, 5)
      const out: Tick[] = []
      for (let v = Math.ceil(spec.min / step) * step; v <= spec.max + 1e-9; v += step)
        out.push({ x: (v - spec.min) / span, label: formatNumber(Math.round(v * 1e6) / 1e6), major: true })
      return out
    },
  }
}

function logScale(spec: Extract<TransformSpec, { type: 'log' }>): Scale {
  const lo = Math.log10(Math.max(spec.min, 1e-12))
  const hi = Math.log10(spec.max)
  return {
    spec,
    scale: (v) => clamp01((Math.log10(Math.max(v, spec.min)) - lo) / (hi - lo)),
    inverse: (x) => Math.pow(10, lo + x * (hi - lo)),
    ticks() {
      const out: Tick[] = []
      for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) out.push({ x: (e - lo) / (hi - lo), label: powerLabel(e), major: true })
      return out
    },
  }
}

function arcsinhScale(spec: Extract<TransformSpec, { type: 'arcsinh' }>): Scale {
  const f = (v: number): number => Math.asinh(v / spec.cofactor)
  const lo = f(spec.min)
  const hi = f(spec.max)
  return {
    spec,
    scale: (v) => clamp01((f(v) - lo) / (hi - lo)),
    inverse: (x) => spec.cofactor * Math.sinh(lo + x * (hi - lo)),
    ticks() {
      const out: Tick[] = [{ x: clamp01((0 - lo) / (hi - lo)), label: '0', major: true }]
      for (let e = 2; Math.pow(10, e) <= spec.max; e++) {
        out.push({ x: clamp01((f(Math.pow(10, e)) - lo) / (hi - lo)), label: powerLabel(e), major: true })
        if (-Math.pow(10, e) >= spec.min) out.push({ x: clamp01((f(-Math.pow(10, e)) - lo) / (hi - lo)), label: powerLabel(e, true), major: true })
      }
      return out
    },
  }
}

// Solve 2 (ln d - ln b) + w (b + d) = 0 for d in (0, b]; g is increasing in d.
function solveD(b: number, w: number): number {
  if (w === 0) return b
  let lo = 0
  let hi = b
  for (let i = 0; i < 200; i++) {
    const d = (lo + hi) / 2
    const g = 2 * (Math.log(d) - Math.log(b)) + w * (b + d)
    if (g < 0) lo = d
    else hi = d
  }
  return (lo + hi) / 2
}

const LUT_SIZE = 8192

function biexScale(spec: Extract<TransformSpec, { type: 'biex' }>): Scale {
  const T = spec.max
  const M = spec.positiveDecades
  const W = spec.widthDecades
  const A = spec.extraNegativeDecades
  const w = W / (M + A)
  const x2 = A / (M + A)
  const x1 = x2 + w
  const x0 = x2 + 2 * w
  const b = (M + A) * Math.LN10
  const d = solveD(b, w)
  const cA = Math.exp(x0 * (b + d))
  const mfA = Math.exp(b * x1) - cA / Math.exp(d * x1)
  const a = T / (Math.exp(b) - mfA - cA / Math.exp(d))
  const c = cA * a
  const f = -mfA * a

  const biexp = (x: number): number => a * Math.exp(b * x) - c * Math.exp(-d * x) + f
  const inverse = (s: number): number => {
    const neg = s < x1
    const t = neg ? 2 * x1 - s : s
    const v = biexp(t)
    return neg ? -v : v
  }

  // Lookup table of biexp on [x1, 1]: monotonic, used to invert for the forward scale.
  const xs = new Float64Array(LUT_SIZE)
  const vs = new Float64Array(LUT_SIZE)
  for (let i = 0; i < LUT_SIZE; i++) {
    xs[i] = x1 + ((1 - x1) * i) / (LUT_SIZE - 1)
    vs[i] = biexp(xs[i])
  }
  vs[0] = 0 // exact zero at the origin of the positive branch
  const scalePositive = (v: number): number => {
    if (v <= 0) return x1
    if (v >= vs[LUT_SIZE - 1]) return 1
    let lo = 0
    let hi = LUT_SIZE - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (vs[mid] <= v) lo = mid
      else hi = mid
    }
    const t = (v - vs[lo]) / (vs[hi] - vs[lo])
    return xs[lo] + t * (xs[hi] - xs[lo])
  }
  const scale = (v: number): number => {
    if (v === 0) return x1
    return clamp01(v < 0 ? 2 * x1 - scalePositive(-v) : scalePositive(v))
  }

  return {
    spec,
    scale,
    inverse: (x) => inverse(clamp01(x)),
    ticks() {
      const out: Tick[] = [{ x: scale(0), label: '0', major: true }]
      const maxExp = Math.floor(Math.log10(T))
      for (let e = 2; e <= maxExp; e++) {
        out.push({ x: scale(Math.pow(10, e)), label: powerLabel(e), major: true })
        const nx = scale(-Math.pow(10, e))
        if (nx > 0.001) out.push({ x: nx, label: powerLabel(e, true), major: true })
      }
      return out.sort((p, q) => p.x - q.x)
    },
  }
}

export function makeScale(spec: TransformSpec): Scale {
  switch (spec.type) {
    case 'linear': return linearScale(spec)
    case 'log': return logScale(spec)
    case 'arcsinh': return arcsinhScale(spec)
    case 'biex': return biexScale(spec)
  }
}

export function transformColumn(column: Float32Array, scale: Scale): Float32Array {
  const out = new Float32Array(column.length)
  for (let i = 0; i < column.length; i++) out[i] = scale.scale(column[i])
  return out
}

function niceCeil(v: number): number {
  if (!(v > 0)) return 1
  const exp = Math.floor(Math.log10(v))
  const m = v / Math.pow(10, exp)
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * Math.pow(10, exp)
}

// Logicle width from the negative values, as suggested in Parks et al. 2006: W = (M - log10(T / |r|)) / 2,
// where r is the 5th percentile of the negative values. Without enough negatives the default width stays.
function fitBiexWidth(base: Extract<TransformSpec, { type: 'biex' }>, column: Float32Array): TransformSpec {
  const negatives: number[] = []
  for (const v of column) if (v < 0) negatives.push(v)
  if (negatives.length < 5) return base
  negatives.sort((a, b) => a - b)
  const r = Math.abs(negatives[Math.floor((negatives.length - 1) * 0.05)])
  const w = (base.positiveDecades - Math.log10(base.max / r)) / 2
  return { ...base, widthDecades: Math.round(Math.min(base.positiveDecades / 2, Math.max(base.widthDecades, w)) * 100) / 100 }
}

// Like defaultSpec, but a linear axis is fitted to the data when the bulk of the events uses a small
// slice of the declared range (some instruments declare 2^24 while scatter sits below 10^6).
// Data that already uses a reasonable part of the range keeps the declared range.
export function fitDefaultSpec(name: string, range: number, column?: Float32Array): TransformSpec {
  const base = defaultSpec(name, range)
  if (!column || column.length < 10) return base
  if (base.type === 'biex') return fitBiexWidth(base, column)
  if (base.type !== 'linear') return base
  const sorted = Float32Array.from(column).sort()
  const q = (p: number): number => sorted[Math.floor((sorted.length - 1) * p)]
  if (!(q(0.5) < base.max / 16)) return base
  return { type: 'linear', min: 0, max: Math.min(base.max, niceCeil(q(0.99) * 1.1)) }
}

// Sensible defaults by parameter name: scatter and time are linear, everything else biexponential.
export function defaultSpec(name: string, range: number): TransformSpec {
  const max = range > 0 ? range : 262144
  if (/^(FSC|SSC)/i.test(name) || /^time$/i.test(name) || /^event/i.test(name)) return { type: 'linear', min: 0, max }
  return { type: 'biex', max, positiveDecades: 4.5, widthDecades: 0.5, extraNegativeDecades: 0 }
}
