import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Circle, MousePointer2, MoveHorizontal, Pentagon, Plus, Square } from 'lucide-react'
import { applyHandle, gateContains, geometryBounds, handlesOf, histogram, moveGeometry, type GateGeometry, type Point } from '@core/gating'
import { NO_AXIS, ROOT_ID, gateGeometryForStorage, gateGeometryOnScreen } from '@core/workbench'
import { makeScale, type Tick } from '@core/transform'
import { useStore, type PlotType, type Tool } from './store'
import { useAxisColumns, useSampleData } from './hooks'
import { GlPlot, densityPoints, rawPoints } from './GlPlot'
import { registerPlotExporter } from './plotExport'
import { buildDensityLayer, paintDensity } from './densityPaint'
import { overlayColumns, overlayLabel, smoothBins, normalizeBins } from '@core/overlay'
import { namePath } from '@core/groups'
import { OverlayBar, overlayColor } from './OverlayBar'
import { DisplayToggle, ViewSwitch } from './ViewBar'
import { useLayout } from './layout'

const MARGIN = { l: 64, r: 16, t: 12, b: 44 }
const BINS = 256
const HANDLE_HIT = 9 // pixels around a grab point that count as pressing it

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function ParamSelect({ axis }: { axis: 'x' | 'y' }) {
  const { file } = useSampleData()
  const value = useStore((s) => (axis === 'x' ? s.xParam : s.yParam))
  const setAxis = useStore((s) => s.setAxis)
  const openTransform = useStore((s) => s.openTransform)
  const active = useStore((s) => s.transformAxis === axis)
  return (
    <div className="axis-control">
      <label>
        <span className="axis-label">{axis.toUpperCase()}</span>
        <select value={value} onChange={(e) => setAxis(axis, e.target.value)} disabled={!file}>
          {file?.parameters.map((p) => (
            <option key={p.index} value={p.name}>{p.stain ? `${p.name} :: ${p.stain}` : p.name}</option>
          ))}
        </select>
      </label>
      <button type="button" className={`btn icon ${active ? 'active' : ''}`} onClick={() => { if (!active) useLayout.setState({ rightOpen: true }); openTransform(active ? null : axis) }}
        disabled={!file} aria-label={`Scale for the ${axis.toUpperCase()} axis`} title="Axis scale">
        T
      </button>
    </div>
  )
}

const PLOT_2D: { id: Tool; label: string; icon: ReactElement }[] = [
    { id: 'select', label: 'Select gates', icon: <MousePointer2 size={16} /> },
    { id: 'polygon', label: 'Polygon gate (click points, double-click to close)', icon: <Pentagon size={16} /> },
    { id: 'rectangle', label: 'Rectangle gate (drag)', icon: <Square size={16} /> },
    { id: 'ellipse', label: 'Ellipse gate (drag its bounding box)', icon: <Circle size={16} /> },
    { id: 'quadrant', label: 'Quadrant gate (click where the two lines should cross)', icon: <Plus size={16} /> },
]

const TOOLS: Record<PlotType, { id: Tool; label: string; icon: ReactElement }[]> = {
  pseudocolor: PLOT_2D,
  contour: PLOT_2D,
  zebra: PLOT_2D,
  histogram: [
    { id: 'select', label: 'Select gates', icon: <MousePointer2 size={16} /> },
    { id: 'range', label: 'Range gate (drag along the axis)', icon: <MoveHorizontal size={16} /> },
  ],
}

const DRAG_TOOLS: Tool[] = ['rectangle', 'ellipse', 'range']

function outline(g: GateGeometry): Point[] {
  switch (g.type) {
    case 'polygon': return g.points
    case 'rectangle': return [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]]
    case 'ellipse': return [[g.cx, g.cy + g.ry], [g.cx + g.rx, g.cy], [g.cx, g.cy - g.ry], [g.cx - g.rx, g.cy]]
    case 'range': return [[g.x0, 1], [g.x1, 1], [g.x1, 0], [g.x0, 0]]
    case 'quadrant': {
      const b = geometryBounds(g)
      return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]
    }
  }
}

// embedded: shown inside the sheet's editor, where the view switch is not wanted.
export function PlotView({ embedded = false }: { embedded?: boolean } = {}) {
  const { wb, file, masks, stats, compError, pops } = useSampleData()
  const sampleId = useStore((s) => s.sampleId)
  const missing = useStore((s) => (s.sampleId ? s.missing[s.sampleId] : undefined))
  const popId = useStore((s) => s.popId)
  const gatePopId = useStore((s) => s.gatePopId)
  const xParam = useStore((s) => s.xParam)
  const yParam = useStore((s) => s.yParam)
  const plotType = useStore((s) => s.plotType)
  const contourCount = useStore((s) => s.contourLevels)
  const overlays = useStore((s) => s.overlays)
  const normalize = useStore((s) => s.overlayNormalize)
  const smoothSetting = useStore((s) => s.overlaySmooth)
  const raw = useStore((s) => s.displayMode) === 'raw'
  // the smooth view always softens the histogram a little (more with the Smooth setting of the overlays); the raw view shows the bins as they are
  const smooth = raw ? 0 : 2 + smoothSetting
  const files = useStore((s) => s.files)
  const scaleVersion = useStore((s) => s.scaleVersion)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const showOutliers = useStore((s) => s.showOutliers)
  const setContour = useStore((s) => s.setContour)
  const setPlotType = useStore((s) => s.setPlotType)
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  const theme = useStore((s) => s.theme)
  const addGate = useStore((s) => s.addGate)
  const updateGate = useStore((s) => s.updateGate)
  const addQuadrant = useStore((s) => s.addQuadrant)
  const selectGate = useStore((s) => s.selectGate)
  const deletePop = useStore((s) => s.deletePop)
  const addDemo = useStore((s) => s.addDemo)
  const pickFcs = useStore((s) => s.pickFcs)
  const cols = useAxisColumns(xParam, yParam)
  const oneD = plotType === 'histogram'

  const boxRef = useRef<HTMLDivElement>(null)
  const glRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const plotRef = useRef<GlPlot | null>(null)
  const [size, setSize] = useState({ w: 600, h: 400 })
  const [glError, setGlError] = useState<string | null>(null)
  const [poly, setPoly] = useState<Point[]>([])
  const [drag, setDrag] = useState<{ a: Point; b: Point } | null>(null)
  const [hover, setHover] = useState<Point | null>(null)
  // a gate being moved or resized: the shape as it was, and as it is now (committed to the Workbench when released)
  const [edit, setEdit] = useState<{ gateId: string; mode: 'move' | 'handle'; handle?: string; start: Point; orig: GateGeometry; cur: GateGeometry } | null>(null)
  const [cursor, setCursor] = useState<string>('default')

  const pw = Math.max(10, size.w - MARGIN.l - MARGIN.r)
  const ph = Math.max(10, size.h - MARGIN.t - MARGIN.b)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [file])

  // the colour ramp is read from the theme when the renderer is created, so it is rebuilt on a theme change
  useEffect(() => {
    if (!glRef.current) return
    try {
      plotRef.current = new GlPlot(glRef.current)
      setGlError(null)
    } catch (e) {
      setGlError((e as Error).message)
    }
    return () => { plotRef.current?.dispose(); plotRef.current = null }
  }, [file, theme])

  // lets File > Export plot image draw this plot (points under, axes and gates over) into one PNG
  useEffect(() => {
    registerPlotExporter(() => {
      const gl = glRef.current
      const ov = overlayRef.current
      if (!gl || !ov) return null
      const dpr = window.devicePixelRatio || 1
      const out = document.createElement('canvas')
      out.width = ov.width
      out.height = ov.height
      const ctx = out.getContext('2d')!
      ctx.fillStyle = cssVar('--plot-bg')
      ctx.fillRect(0, 0, out.width, out.height)
      ctx.drawImage(gl, Math.round(MARGIN.l * dpr), Math.round(MARGIN.t * dpr))
      ctx.drawImage(ov, 0, 0)
      return out.toDataURL('image/png')
    })
    return () => registerPlotExporter(null)
  }, [file])

  const dots = useMemo(() => {
    if (!cols || !masks || oneD || plotType !== 'pseudocolor') return null
    return raw ? rawPoints(cols.xs, cols.ys, masks.get(popId) ?? null) : densityPoints(cols.xs, cols.ys, masks.get(popId) ?? null)
  }, [cols, masks, popId, oneD, plotType, raw])

  // contour and zebra plots are lines and fills on the 2D canvas instead of points
  const layer = useMemo(() => {
    if (!cols || !masks || (plotType !== 'contour' && plotType !== 'zebra')) return null
    return buildDensityLayer(cols.xs, cols.ys, masks.get(popId) ?? null, contourCount, plotType, showOutliers, raw ? 0 : 2)
  }, [cols, masks, popId, plotType, contourCount, showOutliers, raw])

  const binCount = useMemo(() => {
    // fewer, wider bins when there are few events, so the shape is readable instead of spiky
    if (raw) return BINS
    const events = stats.get(popId)?.count ?? 0
    return events < 1000 ? 48 : events < 5000 ? 128 : BINS
  }, [stats, popId, raw])
  const overlayScaled = overlays.length > 0 && normalize // every curve to its own tallest bin, in percent

  const hist = useMemo(() => {
    if (!cols || !masks || !oneD) return null
    let bins = smoothBins(histogram(cols.xs, masks.get(popId) ?? null, binCount), smooth)
    if (overlayScaled) bins = normalizeBins(bins, 100)
    let max = 0
    for (const v of bins) if (v > max) max = v
    return { bins, max: Math.max(1, max * 1.08) }
  }, [cols, masks, popId, oneD, binCount, smooth, overlayScaled])

  // What each overlay draws on this plot: a curve on a histogram, a set of dots on a two-parameter plot. `notes` say why one is missing.
  const overlayDraw = useMemo(() => {
    const notes: Record<string, string> = {}
    const curves: { id: string; bins: Float64Array }[] = []
    const dotSets: { id: string; pos: Float32Array }[] = []
    if (!file || !cols) return { notes, curves, dotSets }
    for (const o of overlays) {
      const r = overlayColumns(wb, files, o, xParam, oneD ? null : yParam)
      if (!r.data) { notes[o.id] = r.note ?? 'nothing to draw'; continue }
      if (oneD) {
        let bins = smoothBins(histogram(r.data.xs, r.data.mask, binCount), smooth)
        if (overlayScaled) bins = normalizeBins(bins, 100)
        curves.push({ id: o.id, bins })
      } else if (r.data.ys) {
        const stride = Math.max(1, Math.ceil(r.data.events / 6000))
        const out: number[] = []
        let seen = 0
        for (let i = 0; i < r.data.xs.length; i++) {
          if (r.data.mask && !r.data.mask[i]) continue
          if (seen++ % stride === 0) out.push(r.data.xs[i], r.data.ys[i])
        }
        dotSets.push({ id: o.id, pos: Float32Array.from(out) })
      }
    }
    return { notes, curves, dotSets }
  }, [overlays, wb, files, xParam, yParam, oneD, binCount, smooth, overlayScaled, scaleVersion, file, cols]) // eslint-disable-line react-hooks/exhaustive-deps
  const histMax = useMemo(() => {
    if (!hist) return 1
    let max = hist.max
    for (const c of overlayDraw.curves) for (const v of c.bins) if (v * 1.08 > max) max = v * 1.08
    return max
  }, [hist, overlayDraw])
  useEffect(() => {
    const gl = plotRef.current
    const canvas = glRef.current
    if (!gl || !canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(pw * dpr)
    canvas.height = Math.round(ph * dpr)
    if (dots) gl.setPoints(dots.pos, dots.t)
    else gl.setPoints(new Float32Array(0), new Float32Array(0))
    gl.draw(cssVar('--plot-bg'), (raw ? 1.5 : 2) * dpr)
  }, [dots, pw, ph, file, theme, raw])

  // Gates are stored in real data values; everything below (drawing, picking, dragging) works on screen positions.
  // `visible` therefore carries each gate's shape already converted with the axes of this plot, and `toStore` turns
  // a shape the person has drawn or dragged back into values before it is saved.
  const axisX = cols?.sx ?? NO_AXIS
  const axisY = oneD ? NO_AXIS : (cols?.sy ?? NO_AXIS)
  const toStore = useCallback((g: GateGeometry): GateGeometry => gateGeometryForStorage(wb, g, axisX, axisY), [wb, axisX, axisY])

  // gates drawn on this plot: children of the selected population that use the plotted parameters
  const visible = useMemo(
    () => pops.filter((p) => p.parentId === popId && p.gateId).map((p) => ({ pop: p, gate: wb.gates.find((g) => g.id === p.gateId)! }))
      .filter(({ gate }) => gate && (oneD ? gate.geometry.type === 'range' && gate.xParam === xParam : gate.geometry.type !== 'range' && gate.xParam === xParam && gate.yParam === yParam))
      .map(({ pop, gate }) => ({ pop, gate: { ...gate, geometry: gateGeometryOnScreen(wb, gate.geometry, axisX, axisY) } })),
    [pops, wb.gates, wb.gateSpace, popId, xParam, yParam, oneD, axisX, axisY], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const toPx = useCallback((p: Point): [number, number] => [MARGIN.l + p[0] * pw, MARGIN.t + (1 - p[1]) * ph], [pw, ph])

  useEffect(() => {
    const canvas = overlayRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    if (layer && (plotType === 'contour' || plotType === 'zebra')) paintDensity(ctx, layer, plotType, MARGIN.l, MARGIN.t, pw, ph)
    // overlays on a two-parameter plot: coloured dots over the points
    for (const d of overlayDraw.dotSets) {
      ctx.fillStyle = overlayColor(overlays.findIndex((o) => o.id === d.id))
      for (let i = 0; i < d.pos.length; i += 2) ctx.fillRect(MARGIN.l + d.pos[i] * pw - 1, MARGIN.t + (1 - d.pos[i + 1]) * ph - 1, 2.2, 2.2)
    }
    const axis = cssVar('--plot-axis')
    ctx.strokeStyle = axis
    ctx.fillStyle = axis
    ctx.lineWidth = 1
    ctx.strokeRect(MARGIN.l + 0.5, MARGIN.t + 0.5, pw, ph)
    ctx.font = `11px ${cssVar('--font-sans')}`

    // Every tick gets its mark, but a label is only written when it would not run into one already drawn
    // (the zero and the first decades of a biexponential axis sit close together).
    const labelled = (ticks: Tick[], pos: (t: Tick) => number, minGap: number): Set<Tick> => {
      const drawn: number[] = []
      const keep = new Set<Tick>()
      const order = [...ticks].sort((a, b) => (a.label === '0' ? -1 : b.label === '0' ? 1 : b.x - a.x))
      for (const t of order) {
        const p = pos(t)
        if (drawn.every((d) => Math.abs(d - p) >= minGap)) { drawn.push(p); keep.add(t) }
      }
      return keep
    }

    // histogram counts use their own linear scale on Y
    const histScale = hist ? makeScale({ type: 'linear', min: 0, max: histMax }) : null
    const xTicks = cols?.sx.ticks() ?? []
    const yTicks = histScale ? histScale.ticks() : (cols?.sy.ticks() ?? [])
    if (cols) {
      const showX = labelled(xTicks, (t) => t.x * pw, 38)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (const t of xTicks) {
        const x = MARGIN.l + t.x * pw
        ctx.beginPath(); ctx.moveTo(x + 0.5, MARGIN.t + ph); ctx.lineTo(x + 0.5, MARGIN.t + ph + 5); ctx.stroke()
        if (showX.has(t)) ctx.fillText(t.label, x, MARGIN.t + ph + 8)
      }
      const showY = labelled(yTicks, (t) => (1 - t.x) * ph, 14)
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      for (const t of yTicks) {
        const y = MARGIN.t + (1 - t.x) * ph
        ctx.beginPath(); ctx.moveTo(MARGIN.l - 5, y + 0.5); ctx.lineTo(MARGIN.l, y + 0.5); ctx.stroke()
        if (showY.has(t)) ctx.fillText(t.label, MARGIN.l - 8, y)
      }
    }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.font = `12px ${cssVar('--font-sans')}`
    ctx.fillText(xParam, MARGIN.l + pw / 2, size.h - 2)
    ctx.save()
    ctx.translate(12, MARGIN.t + ph / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.textBaseline = 'top'
    ctx.fillText(oneD ? (overlayScaled ? '% of max' : 'Count') : yParam, 0, 0)
    ctx.restore()

    if (hist) {
      ctx.beginPath()
      ctx.moveTo(MARGIN.l, MARGIN.t + ph)
      const n = hist.bins.length
      for (let b = 0; b < n; b++) ctx.lineTo(MARGIN.l + ((b + 0.5) / n) * pw, MARGIN.t + ph - (hist.bins[b] / histMax) * ph)
      ctx.lineTo(MARGIN.l + pw, MARGIN.t + ph)
      ctx.closePath()
      ctx.fillStyle = cssVar('--plot-hist-fill'); ctx.fill()
      ctx.strokeStyle = cssVar('--plot-hist-stroke'); ctx.lineWidth = 1.2; ctx.stroke()
    }
    // overlays: one curve each on a histogram
    overlayDraw.curves.forEach((c) => {
      const idx = overlays.findIndex((o) => o.id === c.id)
      ctx.beginPath()
      c.bins.forEach((v, b) => { const x = MARGIN.l + ((b + 0.5) / c.bins.length) * pw; const y = MARGIN.t + ph - (v / histMax) * ph; if (b) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
      ctx.strokeStyle = overlayColor(idx); ctx.lineWidth = 1.8; ctx.stroke()
    })
    // the legend names what each colour is
    if (overlayDraw.curves.length + overlayDraw.dotSets.length > 0) {
      const entries = [{ label: overlayLabel(wb, { id: '', sampleId: sampleId ?? '', path: namePath(pops, popId) }), color: oneD ? cssVar('--plot-hist-stroke') : cssVar('--plot-axis') }, ...overlays.flatMap((o, i) => (overlayDraw.notes[o.id] ? [] : [{ label: overlayLabel(wb, o), color: overlayColor(i) }]))]
      ctx.font = `11px ${cssVar('--font-sans')}`
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      const w = Math.min(pw * 0.6, Math.max(...entries.map((e) => ctx.measureText(e.label).width)) + 30)
      const lx = MARGIN.l + pw - w - 6
      ctx.fillStyle = cssVar('--plot-bg'); ctx.globalAlpha = 0.85; ctx.fillRect(lx, MARGIN.t + 4, w, entries.length * 16 + 6); ctx.globalAlpha = 1
      entries.forEach((e, k) => {
        const ly = MARGIN.t + 14 + k * 16
        ctx.fillStyle = e.color; ctx.fillRect(lx + 6, ly - 2, 14, 4)
        ctx.fillStyle = cssVar('--color-text'); ctx.fillText(e.label.length > 40 ? `${e.label.slice(0, 39)}…` : e.label, lx + 24, ly)
      })
    }

    const stroke = cssVar('--plot-gate-stroke')
    const fill = cssVar('--plot-gate-fill')
    const trace = (g: GateGeometry, close = true): void => {
      ctx.beginPath()
      if (g.type === 'ellipse') {
        const [cx, cy] = toPx([g.cx, g.cy])
        ctx.ellipse(cx, cy, g.rx * pw, g.ry * ph, 0, 0, Math.PI * 2)
        return
      }
      outline(g).forEach((p, i) => { const [x, y] = toPx(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y) })
      if (close) ctx.closePath()
    }
    // The four quarters of a quadrant gate share one crosshair; while one is dragged, all follow it.
    const editedQuad = edit && edit.cur.type === 'quadrant' ? edit.cur : null
    const crossOf = (g: Extract<GateGeometry, { type: 'quadrant' }>): { cx: number; cy: number } =>
      editedQuad && editedQuad.link === g.link ? { cx: editedQuad.cx, cy: editedQuad.cy } : { cx: g.cx, cy: g.cy }
    const drawnLinks = new Set<string>()
    for (const { pop, gate } of visible) {
      if (gate.geometry.type !== 'quadrant') continue
      const q = gate.geometry
      const { cx, cy } = crossOf(q)
      const selectedHere = pop.id === gatePopId
      const anySelected = visible.some((v) => v.pop.id === gatePopId && v.gate.geometry.type === 'quadrant' && (v.gate.geometry as typeof q).link === q.link)
      const shown: typeof q = { ...q, cx, cy }
      if (!drawnLinks.has(q.link)) {
        drawnLinks.add(q.link)
        ctx.strokeStyle = stroke; ctx.lineWidth = anySelected ? 2.5 : 1.5; ctx.setLineDash([])
        const [vx] = toPx([cx, 0]); const [, hy] = toPx([0, cy])
        ctx.beginPath(); ctx.moveTo(vx, MARGIN.t); ctx.lineTo(vx, MARGIN.t + ph); ctx.moveTo(MARGIN.l, hy); ctx.lineTo(MARGIN.l + pw, hy); ctx.stroke()
        if (anySelected) {
          const sel = visible.find((v) => v.pop.id === gatePopId)!.gate.geometry as typeof q
          for (const h of handlesOf({ ...sel, cx, cy })) {
            const [x, y] = toPx(h.p)
            ctx.fillStyle = cssVar('--color-bg'); ctx.fillRect(x - 4, y - 4, 8, 8)
            ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.strokeRect(x - 4, y - 4, 8, 8)
          }
        }
      }
      if (selectedHere) { // the chosen quarter is tinted
        const b = geometryBounds(shown)
        const [x0, y0] = toPx([b.x0, b.y1]); const [x1, y1] = toPx([b.x1, b.y0])
        ctx.fillStyle = fill; ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
      }
      // each quarter writes its name and share in its own corner of the plot
      const st = stats.get(pop.id)
      const pct = st && st.parentCount ? `${((st.count / st.parentCount) * 100).toFixed(1)}%` : '–'
      const label = `${pop.name}  ${pct}`
      ctx.font = `12px ${cssVar('--font-sans')}`
      const tw = ctx.measureText(label).width
      const right = shown.q === 'ne' || shown.q === 'se'
      const top = shown.q === 'nw' || shown.q === 'ne'
      const chipX = right ? MARGIN.l + pw - tw - 12 : MARGIN.l + 4
      const chipY = top ? MARGIN.t + 4 : MARGIN.t + ph - 22
      ctx.globalAlpha = 0.9; ctx.fillStyle = cssVar('--color-bg'); ctx.fillRect(chipX, chipY, tw + 8, 18); ctx.globalAlpha = 1
      ctx.fillStyle = cssVar('--color-text'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, chipX + 4, chipY + 9)
    }
    for (const { pop, gate } of visible) {
      if (gate.geometry.type === 'quadrant') continue
      const g = edit && edit.gateId === gate.id ? edit.cur : gate.geometry // the shape being dragged is shown live
      const selected = pop.id === gatePopId
      trace(g)
      ctx.fillStyle = fill; ctx.fill()
      ctx.strokeStyle = stroke; ctx.lineWidth = selected ? 2.5 : 1.5; ctx.stroke()
      const pts = outline(g)
      if (selected) {
        // grab points: white squares with a coloured edge, large enough to hit
        for (const h of handlesOf(g)) {
          const [x, y] = toPx(h.p)
          ctx.fillStyle = cssVar('--color-bg'); ctx.fillRect(x - 4, y - 4, 8, 8)
          ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.strokeRect(x - 4, y - 4, 8, 8)
        }
      }
      const st = stats.get(pop.id)
      const pct = st && st.parentCount ? `${((st.count / st.parentCount) * 100).toFixed(1)}%` : '–'
      const top = pts.reduce((a, b) => (b[1] > a[1] ? b : a))
      const mid: Point = g.type === 'range' ? [(g.x0 + g.x1) / 2, 1] : top
      const [lx, ly] = toPx(mid)
      const label = `${pop.name}  ${pct}`
      ctx.font = `12px ${cssVar('--font-sans')}`
      const tw = ctx.measureText(label).width
      // the label sits above the gate; when the gate touches the top edge it goes just inside, and it never leaves the plot sideways
      const chipY = ly - 22 >= 2 ? ly - 22 : ly + 4
      const chipX = Math.min(Math.max(lx - tw / 2 - 4, MARGIN.l), MARGIN.l + pw - tw - 8)
      ctx.globalAlpha = 0.9; ctx.fillStyle = cssVar('--color-bg')
      ctx.fillRect(chipX, chipY, tw + 8, 18); ctx.globalAlpha = 1
      ctx.fillStyle = cssVar('--color-text'); ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillText(label, chipX + 4, chipY + 9)
    }

    ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4])
    if (poly.length) {
      trace({ type: 'polygon', points: hover ? [...poly, hover] : poly }, false); ctx.stroke()
      for (const p of poly) { const [x, y] = toPx(p); ctx.fillStyle = stroke; ctx.fillRect(x - 3, y - 3, 6, 6) }
    }
    if (drag) {
      const a = drag.a
      const b = drag.b
      if (tool === 'ellipse') trace({ type: 'ellipse', cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, rx: Math.max(Math.abs(a[0] - b[0]) / 2, 1e-4), ry: Math.max(Math.abs(a[1] - b[1]) / 2, 1e-4) })
      else if (tool === 'range') trace({ type: 'range', x0: a[0], x1: b[0] })
      else trace({ type: 'rectangle', x0: a[0], y0: a[1], x1: b[0], y1: b[1] })
      ctx.stroke()
    }
    ctx.setLineDash([])
  }, [size, pw, ph, cols, hist, oneD, xParam, yParam, visible, stats, gatePopId, poly, drag, hover, tool, toPx, theme, edit, layer, plotType, overlayDraw, overlays, histMax, overlayScaled])

  const toDisplay = (e: React.MouseEvent): Point => {
    const r = overlayRef.current!.getBoundingClientRect()
    const x = (e.clientX - r.left - MARGIN.l) / pw
    const y = 1 - (e.clientY - r.top - MARGIN.t) / ph
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))]
  }

  const finishPolygon = (pts: Point[]): void => {
    if (pts.length >= 3) addGate(toStore({ type: 'polygon', points: pts }))
    setPoly([])
    setHover(null)
  }

  const cancel = (): void => { setPoly([]); setDrag(null); setHover(null); setEdit(null) }

  const selected = visible.find((v) => v.pop.id === gatePopId)

  // which grab point of the selected gate is under the pointer, if any
  const handleAt = (e: React.MouseEvent): string | null => {
    if (!selected) return null
    const r = overlayRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    for (const h of handlesOf(selected.gate.geometry)) {
      const [x, y] = toPx(h.p)
      if (Math.hypot(x - mx, y - my) <= HANDLE_HIT) return h.id
    }
    return null
  }

  const onMouseDown = (e: React.MouseEvent): void => {
    if (!cols) return
    boxRef.current?.focus()
    const p = toDisplay(e)
    if (tool === 'select') {
      const handle = handleAt(e)
      if (selected && handle) {
        setEdit({ gateId: selected.gate.id, mode: 'handle', handle, start: p, orig: selected.gate.geometry, cur: selected.gate.geometry })
        return
      }
      const hit = [...visible].reverse().find(({ gate }) => gateContains(gate.geometry, p[0], p[1]))
      selectGate(hit ? hit.pop.id : null)
      // pressing inside a gate also starts moving it
      if (hit) setEdit({ gateId: hit.gate.id, mode: 'move', start: p, orig: hit.gate.geometry, cur: hit.gate.geometry })
    } else if (tool === 'quadrant') {
      const c = toStore({ type: 'quadrant', cx: p[0], cy: p[1], q: 'ne', link: '' }) as { cx: number; cy: number }
      addQuadrant(c.cx, c.cy)
    } else if (DRAG_TOOLS.includes(tool)) {
      setDrag({ a: p, b: p })
    } else if (tool === 'polygon') {
      if (poly.length >= 3) {
        const [fx, fy] = toPx(poly[0]); const [cx, cy] = toPx(p)
        if (Math.hypot(fx - cx, fy - cy) < 8) { finishPolygon(poly); return }
      }
      setPoly([...poly, p])
    }
  }

  const onMouseMove = (e: React.MouseEvent): void => {
    if (!drag && poly.length) setHover(toDisplay(e))
    if (tool === 'select' && !edit) {
      const p = toDisplay(e)
      const next = handleAt(e) ? 'pointer' : selected && gateContains(selected.gate.geometry, p[0], p[1]) ? 'move' : 'default'
      setCursor((c) => (c === next ? c : next))
    }
  }

  // Moving or resizing a selected gate: follow the pointer on the whole window, and commit one change when released.
  const editRef = useRef(edit)
  editRef.current = edit
  const editing = edit !== null
  useEffect(() => {
    if (!editing) return
    const local = (e: MouseEvent): Point => {
      const r = overlayRef.current!.getBoundingClientRect()
      return [Math.min(1, Math.max(0, (e.clientX - r.left - MARGIN.l) / pw)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top - MARGIN.t) / ph))]
    }
    const move = (e: MouseEvent): void => {
      const cur = editRef.current
      if (!cur) return
      const p = local(e)
      const next = cur.mode === 'handle' ? applyHandle(cur.orig, cur.handle!, p) : moveGeometry(cur.orig, p[0] - cur.start[0], p[1] - cur.start[1])
      setEdit({ ...cur, cur: next })
    }
    const up = (): void => {
      const cur = editRef.current
      if (cur && JSON.stringify(cur.cur) !== JSON.stringify(cur.orig)) updateGate(cur.gateId, toStore(cur.cur))
      setEdit(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [editing, pw, ph, updateGate])

  // While dragging, follow the pointer on the whole window so releasing outside the plot still finishes the gate.
  const dragging = drag !== null
  const dragA = drag?.a
  useEffect(() => {
    if (!dragging || !dragA) return
    const local = (e: MouseEvent): Point => {
      const r = overlayRef.current!.getBoundingClientRect()
      return [Math.min(1, Math.max(0, (e.clientX - r.left - MARGIN.l) / pw)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top - MARGIN.t) / ph))]
    }
    const move = (e: MouseEvent): void => setDrag({ a: dragA, b: local(e) })
    const up = (e: MouseEvent): void => {
      const b = local(e)
      const dx = Math.abs(dragA[0] - b[0])
      const dy = Math.abs(dragA[1] - b[1])
      if (tool === 'range') {
        if (dx > 0.01) addGate(toStore({ type: 'range', x0: Math.min(dragA[0], b[0]), x1: Math.max(dragA[0], b[0]) }))
      } else if (dx > 0.01 && dy > 0.01) {
        if (tool === 'ellipse') addGate(toStore({ type: 'ellipse', cx: (dragA[0] + b[0]) / 2, cy: (dragA[1] + b[1]) / 2, rx: dx / 2, ry: dy / 2 }))
        else addGate(toStore({ type: 'rectangle', x0: dragA[0], y0: dragA[1], x1: b[0], y1: b[1] }))
      }
      setDrag(null)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
  }, [dragging, dragA, pw, ph, tool, addGate])

  const onDoubleClick = (): void => {
    if (tool !== 'polygon') return
    // the two clicks of a double-click each added a point at the same spot: drop the duplicate
    const pts = poly.length >= 2 && Math.hypot(poly[poly.length - 1][0] - poly[poly.length - 2][0], poly[poly.length - 1][1] - poly[poly.length - 2][1]) < 0.01 ? poly.slice(0, -1) : poly
    finishPolygon(pts)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') cancel()
    else if (e.key === 'Enter' && tool === 'polygon') finishPolygon(poly)
    else if ((e.key === 'Delete' || e.key === 'Backspace') && gatePopId && gatePopId !== ROOT_ID) deletePop(gatePopId)
    else if (selected && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      // arrow keys move the selected gate a little (Shift: more), so a gate can be adjusted without the mouse
      e.preventDefault()
      const step = e.shiftKey ? 0.02 : 0.005
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0
      updateGate(selected.gate.id, toStore(moveGeometry(selected.gate.geometry, dx, dy)))
    }
  }

  if (!sampleId) {
    return (
      <div className="empty-state">
        <h2>No samples yet</h2>
        <p>Add FCS files to start gating, or load a synthetic sample to try the app.</p>
        <div className="row">
          <button type="button" className="btn primary" onClick={() => void pickFcs()}>Add FCS files</button>
          <button type="button" className="btn" onClick={addDemo}>Load demo sample</button>
        </div>
      </div>
    )
  }

  if (missing || !file) {
    return (
      <div className="empty-state">
        <h2>This sample&apos;s file could not be loaded</h2>
        <p>{missing ?? 'Select another sample.'}</p>
        <p className="muted">Your gates are kept in the Workbench.</p>
      </div>
    )
  }

  const total = stats.get(popId)?.count ?? file.eventCount
  return (
    <div className="plot-pane">
      <div className="plot-bar">
        <label className="plot-type">
          <span className="axis-label">Plot</span>
          <select aria-label="Plot type" value={plotType} onChange={(e) => { cancel(); setPlotType(e.target.value as PlotType) }}>
            <option value="pseudocolor">Pseudocolor</option>
            <option value="contour">Contour</option>
            <option value="zebra">Zebra</option>
            <option value="histogram">Histogram</option>
          </select>
        </label>
        {(plotType === 'contour' || plotType === 'zebra') && (
          <>
            <label className="plot-type"><span className="axis-label">Lines</span>
              <select aria-label="Contour lines" value={contourCount} onChange={(e) => setContour(Number(e.target.value), showOutliers)}>
                {[5, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="plot-type"><input type="checkbox" checked={showOutliers} onChange={(e) => setContour(contourCount, e.target.checked)} /> Outliers</label>
          </>
        )}
        <div className="toolbar" role="toolbar" aria-label="Gate tools">
          {TOOLS[plotType].map((t) => (
            <button key={t.id} type="button" className={`btn icon ${tool === t.id ? 'active' : ''}`} aria-pressed={tool === t.id}
              aria-label={t.label} title={t.label} onClick={() => { cancel(); setTool(t.id) }}>
              {t.icon}
            </button>
          ))}
        </div>
        <ParamSelect axis="x" />
        {!oneD && <ParamSelect axis="y" />}
        <button type="button" className={`btn ${overlayOpen || overlays.length ? 'active' : ''}`} aria-pressed={overlayOpen} onClick={() => setOverlayOpen(!overlayOpen)} title="Draw another sample or population over this plot">Overlays{overlays.length ? ` (${overlays.length})` : ''}</button>
        {!embedded && <ViewSwitch />}
        <DisplayToggle />
        <span className="muted plot-count">{total.toLocaleString()} events</span>
      </div>
      {(overlayOpen || overlays.length > 0) && <OverlayBar notes={overlayDraw.notes} oneD={oneD} />}
      {compError && <div className="banner" role="alert">Compensation not applied to this sample: {compError}</div>}
      <div className="plot-box" ref={boxRef} role="group" tabIndex={0} onKeyDown={onKeyDown}
        aria-label={oneD ? `Histogram of ${xParam}, ${total} events` : `Plot of ${yParam} against ${xParam}, ${total} events`}>
        <canvas ref={glRef} className="gl-canvas" style={{ left: MARGIN.l, top: MARGIN.t, width: pw, height: ph }} />
        <canvas ref={overlayRef} className="overlay-canvas" style={{ width: size.w, height: size.h, cursor: tool === 'select' ? cursor : 'crosshair' }}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onDoubleClick={onDoubleClick}
          onMouseLeave={() => setHover(null)} />
        {glError && <div className="plot-error" role="alert">{glError}</div>}
        {!cols && <div className="plot-error" role="alert">This sample has no parameter named {xParam}{oneD ? '' : ` or ${yParam}`}.</div>}
      </div>
    </div>
  )
}
