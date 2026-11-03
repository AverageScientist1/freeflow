import { useEffect, useRef } from 'react'
import type { FcsFile } from '@core/fcs'
import { compensate } from '@core/compensation'
import { findByPath } from '@core/groups'
import { geometryBounds, histogram, type GateGeometry, type Point } from '@core/gating'
import { transformColumn } from '@core/transform'
import { smoothBins } from '@core/overlay'
import { countMask } from '@core/stats'
import { NO_AXIS, columnIndex, evaluatePopulations, gateGeometryOnScreen, populationsFor, scaleFor, type Workbench } from '@core/workbench'
import { useStore, type PlotType, type ThumbSize } from './store'
import { densityPoints, rawPoints } from './GlPlot'
import { buildDensityLayer, paintDensity, type DensityLayer, type DensityStyle } from './densityPaint'

// Small pictures of a plot, used by the gallery (one plot for every sample) and the sheet (several plots of one sample).

// A thumbnail is width pixels wide and a little less tall.
export const tileDims = (width: number): { w: number; h: number } => ({ w: width, h: Math.round(width * 0.8) })
const PAD = { l: 8, r: 8, t: 22, b: 8 }
const MAX_POINTS = 12000

const cssVar = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim()

function rampColor(t: number, ramp: [number, number, number][]): string {
  const f = Math.min(1, Math.max(0, t)) * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(f))
  const k = f - i
  const c = ramp[i].map((v, j) => Math.round(v + (ramp[i + 1][j] - v) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

function hex(v: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export interface GateDraw { name: string; geometry: GateGeometry; pct: number | null }
export interface Tile {
  sampleId: string
  name: string
  note: string | null // why there is no picture
  dots: { pos: Float32Array; t: Float32Array } | null
  raw: boolean
  layer: DensityLayer | null // contour and zebra plots
  style: DensityStyle
  bins: Float64Array | null
  gates: GateDraw[]
  events: number
}

export interface TileSpec { path: string[]; x: string; y: string; plot: PlotType; levels: number; outliers: boolean; raw: boolean }

// One tile's data. Smooth is the density-coloured view; raw draws every event as it is (dots, or unsmoothed bins).
export function buildTile(wb: Workbench, rawFile: FcsFile | undefined, sampleId: string, name: string, spec: TileSpec): Tile {
  const oneD = spec.plot === 'histogram'
  const base: Tile = { sampleId, name, note: null, dots: null, raw: spec.raw, layer: null, style: spec.plot === 'zebra' ? 'zebra' : 'contour', bins: null, gates: [], events: 0 }
  if (!rawFile) return { ...base, note: 'file not loaded' }
  const matrix = wb.compensation.matrices.find((m) => m.id === wb.compensation.assignments[sampleId])
  const file = matrix ? compensate(rawFile, matrix).file : rawFile
  const pops = populationsFor(wb, sampleId)
  const pop = findByPath(pops, sampleId, spec.path)
  if (!pop) return { ...base, note: 'no such population' }
  const xi = columnIndex(file, spec.x)
  const yi = oneD ? 0 : columnIndex(file, spec.y)
  if (xi < 0 || yi < 0) return { ...base, note: `no parameter ${xi < 0 ? spec.x : spec.y}` }
  const masks = evaluatePopulations(wb, file, sampleId)
  const mask = masks.get(pop.id) ?? null
  const sx = scaleFor(wb, file, spec.x)
  const sy = oneD ? NO_AXIS : scaleFor(wb, file, spec.y)
  const xs = transformColumn(file.columns[xi], sx)
  const ys = oneD ? xs : transformColumn(file.columns[yi], sy as ReturnType<typeof scaleFor>)
  const events = countMask(mask, file.eventCount)
  // a few thousand events show the shape; every sample draws quickly even with millions
  const stride = Math.max(1, Math.ceil(file.eventCount / MAX_POINTS))
  let sxs = xs
  let sys = ys
  let smask = mask
  if (stride > 1) {
    const n = Math.ceil(file.eventCount / stride)
    sxs = new Float32Array(n); sys = new Float32Array(n)
    const m2 = mask ? new Uint8Array(n) : null
    for (let i = 0, k = 0; i < file.eventCount; i += stride, k++) { sxs[k] = xs[i]; sys[k] = ys[i]; if (m2 && mask) m2[k] = mask[i] }
    smask = m2
  }
  const gates: GateDraw[] = []
  for (const c of pops.filter((p) => p.parentId === pop.id && p.gateId)) {
    const g = wb.gates.find((q) => q.id === c.gateId)
    if (!g || g.xParam !== spec.x) continue
    if (oneD ? g.geometry.type !== 'range' : g.geometry.type === 'range' || g.yParam !== spec.y) continue
    const cm = masks.get(c.id) ?? null
    gates.push({ name: c.name, geometry: gateGeometryOnScreen(wb, g.geometry, sx, sy), pct: events ? (countMask(cm, file.eventCount) / events) * 100 : null })
  }
  return {
    ...base, events, gates,
    dots: oneD || spec.plot !== 'pseudocolor' ? null : spec.raw ? rawPoints(sxs, sys, smask) : densityPoints(sxs, sys, smask),
    layer: !oneD && (spec.plot === 'contour' || spec.plot === 'zebra') ? buildDensityLayer(sxs, sys, smask, spec.levels, spec.plot, spec.outliers, spec.raw ? 0 : 2) : null,
    bins: oneD ? (spec.raw ? histogram(sxs, smask, 128) : smoothBins(histogram(sxs, smask, 64), 1)) : null,
  }
}

function paint(ctx: CanvasRenderingContext2D, tile: Tile, selected: boolean, W: number, H: number): void {
  const pw = W - PAD.l - PAD.r
  const ph = H - PAD.t - PAD.b
  const bg = cssVar('--plot-bg') || '#fff'
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = cssVar('--plot-axis') || '#000'
  ctx.lineWidth = 1
  ctx.strokeRect(PAD.l + 0.5, PAD.t + 0.5, pw, ph)
  const px = (p: Point): [number, number] => [PAD.l + p[0] * pw, PAD.t + (1 - p[1]) * ph]
  if (tile.dots) {
    const ramp = [0, 1, 2, 3, 4, 5].map((i) => hex(cssVar(`--plot-heat-${i}`)))
    const { pos, t } = tile.dots
    const size = tile.raw ? 1.2 : 1.6
    for (let i = 0; i < t.length; i++) {
      const [x, y] = px([pos[i * 2], pos[i * 2 + 1]])
      ctx.fillStyle = rampColor(t[i], ramp)
      ctx.fillRect(x - size / 2, y - size / 2, size, size)
    }
  }
  if (tile.layer) paintDensity(ctx, tile.layer, tile.style, PAD.l, PAD.t, pw, ph)
  if (tile.bins) {
    let max = 1
    for (const v of tile.bins) if (v > max) max = v
    ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t + ph)
    tile.bins.forEach((v, b) => ctx.lineTo(PAD.l + ((b + 0.5) / tile.bins!.length) * pw, PAD.t + ph - (v / max) * ph * 0.95))
    ctx.lineTo(PAD.l + pw, PAD.t + ph); ctx.closePath()
    ctx.fillStyle = cssVar('--plot-hist-fill') || '#0b6e7540'; ctx.fill()
    ctx.strokeStyle = cssVar('--plot-hist-stroke') || '#0b6e75'; ctx.stroke()
  }
  const stroke = cssVar('--plot-gate-stroke') || '#0b6e75'
  ctx.lineWidth = 1.5
  ctx.font = `11px ${cssVar('--font-sans') || 'sans-serif'}`
  const drawnQuads = new Set<string>()
  for (const g of tile.gates) {
    const geo = g.geometry
    ctx.strokeStyle = stroke
    ctx.fillStyle = stroke
    let label: [number, number] = [0, 0]
    if (geo.type === 'quadrant') {
      if (!drawnQuads.has(geo.link)) {
        drawnQuads.add(geo.link)
        const [vx] = px([geo.cx, 0]); const [, hy] = px([0, geo.cy])
        ctx.beginPath(); ctx.moveTo(vx, PAD.t); ctx.lineTo(vx, PAD.t + ph); ctx.moveTo(PAD.l, hy); ctx.lineTo(PAD.l + pw, hy); ctx.stroke()
      }
      const b = geometryBounds(geo)
      label = px([(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2])
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    } else {
      ctx.beginPath()
      if (geo.type === 'ellipse') { const [cx, cy] = px([geo.cx, geo.cy]); ctx.ellipse(cx, cy, geo.rx * pw, geo.ry * ph, 0, 0, Math.PI * 2) }
      else if (geo.type === 'polygon') geo.points.forEach((p, i) => { const [x, y] = px(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
      else if (geo.type === 'range') { const [x0] = px([geo.x0, 0]); const [x1] = px([geo.x1, 0]); ctx.rect(x0, PAD.t, x1 - x0, ph) }
      else { const [x0, y0] = px([geo.x0, geo.y1]); const [x1, y1] = px([geo.x1, geo.y0]); ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)) }
      if (geo.type === 'polygon') ctx.closePath()
      ctx.stroke()
      const b = geometryBounds(geo)
      label = px([(b.x0 + b.x1) / 2, Math.min(1, b.y1)])
      label[1] = Math.max(PAD.t + 8, label[1] - 8)
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    }
    const text = g.pct === null ? g.name : `${g.pct.toFixed(1)}%`
    ctx.fillStyle = bg
    const tw = ctx.measureText(text).width
    ctx.globalAlpha = 0.8; ctx.fillRect(label[0] - tw / 2 - 2, label[1] - 7, tw + 4, 14); ctx.globalAlpha = 1
    ctx.fillStyle = cssVar('--color-text') || '#000'
    ctx.fillText(text, label[0], label[1])
  }
  if (selected) { ctx.strokeStyle = cssVar('--color-accent') || '#0b6e75'; ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, W - 3, H - 3) }
}

export function tileLabel(tile: Tile): string {
  return `${tile.name}: ${tile.events.toLocaleString()} events${tile.gates.map((g) => `; ${g.name} ${g.pct === null ? '' : g.pct.toFixed(1) + '%'}`).join('')}`
}

export function TileCanvas({ tile, selected, size, onOpen, label }: { tile: Tile; selected: boolean; size: ThumbSize; onOpen: () => void; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const theme = useStore((s) => s.theme)
  const { w, h } = tileDims(size)
  useEffect(() => {
    const c = ref.current
    if (!c || tile.note) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    paint(ctx, tile, selected, w, h)
  }, [tile, selected, theme, w, h])
  return tile.note
    ? <div className="tile-note muted" style={{ width: w, height: h }}>{tile.note}</div>
    : <canvas ref={ref} style={{ width: w, height: h }} onDoubleClick={onOpen} role="img" aria-label={label ?? tileLabel(tile)} />
}