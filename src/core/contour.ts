// Contour and zebra plots. The events of a population are counted on a coarse grid over the plot (display coordinates,
// 0 to 1), smoothed a little, and levels are chosen so that each contour encloses a given share of the events. Events
// outside the outermost contour are "outliers" and can be drawn as dots.

export const FIELD_SIZE = 64

export interface DensityField {
  n: number // the field is n by n cells
  values: Float64Array // smoothed event count of each cell, row 0 at the bottom (y = 0)
  total: number // events counted
}

const clampCell = (v: number, n: number): number => Math.min(n - 1, Math.max(0, Math.floor(v * n)))

// [1 2 1] / 4 along rows then columns; the edges repeat their own value, so counts near the border are kept.
function blur(src: Float64Array, n: number): Float64Array {
  const tmp = new Float64Array(n * n)
  const out = new Float64Array(n * n)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const l = src[y * n + Math.max(0, x - 1)]
      const r = src[y * n + Math.min(n - 1, x + 1)]
      tmp[y * n + x] = (l + 2 * src[y * n + x] + r) / 4
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = tmp[Math.max(0, y - 1) * n + x]
      const d = tmp[Math.min(n - 1, y + 1) * n + x]
      out[y * n + x] = (u + 2 * tmp[y * n + x] + d) / 4
    }
  return out
}

export function densityField(xs: Float32Array, ys: Float32Array, mask: Uint8Array | null, n = FIELD_SIZE, passes = 2): DensityField {
  let values: Float64Array = new Float64Array(n * n)
  let total = 0
  for (let i = 0; i < xs.length; i++) {
    if (mask && !mask[i]) continue
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue
    values[clampCell(ys[i], n) * n + clampCell(xs[i], n)]++
    total++
  }
  for (let p = 0; p < passes; p++) values = blur(values, n)
  return { n, values, total }
}

// Density thresholds, lowest first. Contour k encloses about the stated share of the events: from 5% (the innermost, highest
// density) to 95% (the outermost). Repeated thresholds (few events or a very narrow population) are merged.
export function contourLevels(field: DensityField, count: number): number[] {
  const cells = Array.from(field.values).filter((v) => v > 0).sort((a, b) => b - a)
  const mass = cells.reduce((a, b) => a + b, 0)
  if (cells.length === 0 || mass === 0 || count < 1) return []
  const share = (i: number): number => (count === 1 ? 0.5 : 0.05 + (0.9 * i) / (count - 1))
  const out: number[] = []
  let acc = 0
  let k = 0
  for (let c = 0; c < cells.length && k < count; c++) {
    acc += cells[c]
    // halfway between this cell's density and the next lower one, so a line never passes exactly through a grid point
    const level = (cells[c] + (cells[c + 1] ?? 0)) / 2
    while (k < count && acc / mass >= share(k)) { out.push(level); k++ }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}
// Bilinear value of the field at a point of the plot, between the centres of the cells. Outside the plot it is zero.
export function sampleField(f: DensityField, x: number, y: number): number {
  if (x < 0 || x > 1 || y < 0 || y > 1) return 0
  const fx = x * f.n - 0.5
  const fy = y * f.n - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const at = (cx: number, cy: number): number => (cx < 0 || cy < 0 || cx >= f.n || cy >= f.n ? 0 : f.values[cy * f.n + cx])
  return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
}

// Marching squares: line segments (x0, y0, x1, y1 in plot coordinates) along the places where the field equals `level`.
// The field is padded with a ring of zeros so contours close at the edge of the plot instead of ending there.
export function contourSegments(f: DensityField, level: number): Float32Array {
  const N = f.n + 2
  const g = (i: number, j: number): number => (i < 1 || j < 1 || i > f.n || j > f.n ? 0 : f.values[(j - 1) * f.n + (i - 1)])
  const px = (i: number): number => (i - 0.5) / f.n
  const out: number[] = []
  const edge = (i: number, j: number, side: 'b' | 'r' | 't' | 'l'): [number, number] => {
    // cell corners: a (i,j) bottom-left, b (i+1,j), c (i+1,j+1), d (i,j+1)
    const lerp = (v0: number, v1: number): number => (v1 === v0 ? 0.5 : (level - v0) / (v1 - v0))
    switch (side) {
      case 'b': return [px(i) + lerp(g(i, j), g(i + 1, j)) / f.n, px(j)]
      case 'r': return [px(i + 1), px(j) + lerp(g(i + 1, j), g(i + 1, j + 1)) / f.n]
      case 't': return [px(i) + lerp(g(i, j + 1), g(i + 1, j + 1)) / f.n, px(j + 1)]
      default: return [px(i), px(j) + lerp(g(i, j), g(i, j + 1)) / f.n]
    }
  }
  const seg = (i: number, j: number, s1: 'b' | 'r' | 't' | 'l', s2: 'b' | 'r' | 't' | 'l'): void => {
    const [ax, ay] = edge(i, j, s1)
    const [bx, by] = edge(i, j, s2)
    out.push(ax, ay, bx, by)
  }
  for (let j = 0; j < N - 1; j++)
    for (let i = 0; i < N - 1; i++) {
      const a = g(i, j), b = g(i + 1, j), c = g(i + 1, j + 1), d = g(i, j + 1)
      const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0)
      const centre = (a + b + c + d) / 4 >= level
      switch (code) {
        case 1: case 14: seg(i, j, 'l', 'b'); break
        case 2: case 13: seg(i, j, 'b', 'r'); break
        case 3: case 12: seg(i, j, 'l', 'r'); break
        case 4: case 11: seg(i, j, 'r', 't'); break
        case 6: case 9: seg(i, j, 'b', 't'); break
        case 7: case 8: seg(i, j, 'l', 't'); break
        case 5: if (centre) { seg(i, j, 'l', 't'); seg(i, j, 'b', 'r') } else { seg(i, j, 'l', 'b'); seg(i, j, 'r', 't') } break
        case 10: if (centre) { seg(i, j, 'l', 'b'); seg(i, j, 'r', 't') } else { seg(i, j, 'b', 'r'); seg(i, j, 'l', 't') } break
        default: break
      }
    }
  return Float32Array.from(out)
}

// Which band every pixel of a size x size picture falls in: the number of levels at or below its density (0: outside the
// outermost contour). Row 0 is the bottom of the plot. Used to fill the plot for the zebra style.
export function bandImage(f: DensityField, levels: number[], size: number): Uint8Array {
  const out = new Uint8Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = sampleField(f, (x + 0.5) / size, (y + 0.5) / size)
      let band = 0
      while (band < levels.length && v >= levels[band]) band++
      out[y * size + x] = band
    }
  return out
}

// The events below the outermost contour, as plot positions (x, y pairs). At most `cap` are returned, evenly spread.
export function outlierPoints(xs: Float32Array, ys: Float32Array, mask: Uint8Array | null, f: DensityField, lowest: number, cap = 20000): Float32Array {
  const idx: number[] = []
  for (let i = 0; i < xs.length; i++) {
    if (mask && !mask[i]) continue
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue
    if (sampleField(f, xs[i], ys[i]) < lowest) idx.push(i)
  }
  const step = Math.max(1, Math.ceil(idx.length / cap))
  const out: number[] = []
  for (let k = 0; k < idx.length; k += step) out.push(xs[idx[k]], ys[idx[k]])
  return Float32Array.from(out)
}
