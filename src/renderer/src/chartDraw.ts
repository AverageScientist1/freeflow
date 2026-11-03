// Bar chart drawn on a canvas. The same function draws the picture on screen and the larger one that is exported as PNG.

export interface ChartBar {
  label: string
  value: number | null
  color: string
  error?: number | null // half-height of the error bar (the SD of a group)
  dots?: number[] // the samples behind a group bar
}

export interface ChartColors { bg: string; text: string; axis: string; grid: string }

export const CHART_PALETTE = ['#3f8fd1', '#e8772b', '#2fb36a', '#c6a21a', '#9b59b6', '#c0392b', '#17a2b8', '#7f8c8d']

import { summarizeByGroup, type TableRow } from '@core/table'

// Bars for one table column (the first value of each row): one per sample, or the mean and SD of each group with the samples as dots.
export function barsFor(rows: TableRow[], by: 'sample' | 'group'): { bars: ChartBar[]; groupNames: string[] } {
  const groupNames: string[] = []
  const colorOf = (g: string): string => {
    if (!groupNames.includes(g)) groupNames.push(g)
    return CHART_PALETTE[groupNames.indexOf(g) % CHART_PALETTE.length]
  }
  const bars: ChartBar[] = by === 'sample'
    ? rows.map((r) => ({ label: r.name.replace(/\.fcs$/i, ''), value: r.values[0], color: colorOf(r.group) }))
    : summarizeByGroup(rows, 0).map((g) => ({ label: `${g.group} (n=${g.n})`, value: g.mean, error: g.sd, dots: g.values.map((x) => x.value), color: colorOf(g.group) }))
  return { bars, groupNames }
}

// A step of 1, 2 or 5 times a power of ten, giving about `target` intervals over the range.
export function niceStep(range: number, target = 5): number {
  if (!(range > 0)) return 1
  const raw = range / target
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / p
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p
}

export function niceRange(lo: number, hi: number): { min: number; max: number; step: number } {
  const min0 = Math.min(0, lo)
  const max0 = Math.max(0, hi)
  const step = niceStep(max0 - min0 || 1)
  return { min: Math.floor(min0 / step) * step, max: Math.ceil(max0 / step) * step || step, step }
}

const tickText = (v: number, step: number): string => {
  const decimals = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)))
  return Math.abs(v) >= 100000 ? v.toExponential(1) : v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function drawChart(ctx: CanvasRenderingContext2D, W: number, H: number, bars: ChartBar[], yLabel: string, title: string, c: ChartColors, k = 1): void {
  ctx.save()
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, W, H)
  const font = (px: number, weight = '400'): string => `${weight} ${px * k}px system-ui, "Segoe UI", sans-serif`
  const rotate = bars.length > 7 || bars.some((b) => b.label.length > 12)
  const left = 72 * k
  const right = 20 * k
  const top = (title ? 36 : 18) * k
  const bottom = (rotate ? 110 : 48) * k
  const pw = W - left - right
  const ph = H - top - bottom
  if (pw <= 10 || ph <= 10) { ctx.restore(); return }

  const vals: number[] = []
  for (const b of bars) {
    if (b.value === null) continue
    vals.push(b.value, b.value + (b.error ?? 0), b.value - (b.error ?? 0), ...(b.dots ?? []))
  }
  const { min, max, step } = niceRange(vals.length ? Math.min(...vals) : 0, vals.length ? Math.max(...vals) : 1)
  const y = (v: number): number => top + ph - ((v - min) / (max - min)) * ph

  if (title) { ctx.fillStyle = c.text; ctx.font = font(14, '600'); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(title, left, 22 * k) }
  ctx.font = font(11)
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let v = min; v <= max + step / 2; v += step) {
    const yy = y(v)
    ctx.strokeStyle = c.grid
    ctx.lineWidth = 1 * k
    ctx.beginPath(); ctx.moveTo(left, yy); ctx.lineTo(left + pw, yy); ctx.stroke()
    ctx.fillStyle = c.text
    ctx.fillText(tickText(v, step), left - 6 * k, yy)
  }
  ctx.strokeStyle = c.axis
  ctx.lineWidth = 1.5 * k
  ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, top + ph); ctx.lineTo(left + pw, top + ph); ctx.stroke()
  // the zero line when the axis goes below it
  if (min < 0) { ctx.beginPath(); ctx.moveTo(left, y(0)); ctx.lineTo(left + pw, y(0)); ctx.stroke() }

  ctx.save()
  ctx.translate(16 * k, top + ph / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textAlign = 'center'
  ctx.fillStyle = c.text
  ctx.font = font(12)
  ctx.fillText(yLabel, 0, 0)
  ctx.restore()

  const slot = pw / Math.max(1, bars.length)
  const bw = Math.min(70 * k, slot * 0.62)
  bars.forEach((b, i) => {
    const cx = left + slot * (i + 0.5)
    if (b.value !== null) {
      ctx.fillStyle = b.color
      const y0 = y(0)
      const y1 = y(b.value)
      ctx.fillRect(cx - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)))
      if (b.error != null && Number.isFinite(b.error)) {
        ctx.strokeStyle = c.text
        ctx.lineWidth = 1.5 * k
        ctx.beginPath()
        ctx.moveTo(cx, y(b.value - b.error)); ctx.lineTo(cx, y(b.value + b.error))
        ctx.moveTo(cx - 6 * k, y(b.value - b.error)); ctx.lineTo(cx + 6 * k, y(b.value - b.error))
        ctx.moveTo(cx - 6 * k, y(b.value + b.error)); ctx.lineTo(cx + 6 * k, y(b.value + b.error))
        ctx.stroke()
      }
      for (const d of b.dots ?? []) {
        ctx.beginPath(); ctx.arc(cx, y(d), 3.5 * k, 0, Math.PI * 2)
        ctx.fillStyle = c.bg; ctx.fill()
        ctx.strokeStyle = c.text; ctx.lineWidth = 1.5 * k; ctx.stroke()
      }
    }
    ctx.fillStyle = c.text
    ctx.font = font(11)
    const label = b.label.length > 26 ? `${b.label.slice(0, 25)}…` : b.label
    if (rotate) {
      ctx.save()
      ctx.translate(cx, top + ph + 8 * k)
      ctx.rotate(-Math.PI / 4)
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, 0, 0)
      ctx.restore()
    } else {
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(label, cx, top + ph + 8 * k)
    }
  })
  ctx.restore()
}
