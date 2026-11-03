import { useEffect, useMemo, useRef, useState } from 'react'
import { saturation, timeQc } from '@core/qc'
import { useStore } from './store'
import { useSampleData } from './hooks'
import { registerPlotExporter } from './plotExport'

function colorsNow() {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string, d: string): string => css.getPropertyValue(n).trim() || d
  return { bg: v('--color-bg', '#fff'), text: v('--color-text', '#111'), axis: v('--plot-axis', '#111'), grid: v('--plot-grid', '#ddd'), ok: v('--plot-hist-stroke', '#0b6e75'), bad: v('--color-danger', '#b3261e') }
}

export function QcView() {
  const { file } = useSampleData()
  const theme = useStore((s) => s.theme)
  const name = useStore((s) => s.wb.samples.find((x) => x.id === s.sampleId)?.name ?? '')
  const qc = useMemo(() => (file ? timeQc(file) : null), [file])
  const sat = useMemo(() => (file ? saturation(file) : []), [file])
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const draw = (ctx: CanvasRenderingContext2D, W: number, H: number, k: number): void => {
    const c = colorsNow()
    ctx.save()
    ctx.fillStyle = c.bg
    ctx.fillRect(0, 0, W, H)
    if (!qc || qc.rates.length === 0) { ctx.restore(); return }
    const left = 70 * k, right = 16 * k, top = 28 * k, bottom = 44 * k
    const pw = W - left - right, ph = H - top - bottom
    if (pw < 10 || ph < 10) { ctx.restore(); return }
    const max = Math.max(...qc.rates, 1) * 1.1
    const x = (i: number): number => left + (i / qc.rates.length) * pw
    const y = (v: number): number => top + ph - (v / max) * ph
    ctx.font = `${11 * k}px system-ui, sans-serif`
    ctx.fillStyle = c.text
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let t = 0; t <= 4; t++) {
      const v = (max * t) / 4
      ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(left + pw, y(v)); ctx.stroke()
      ctx.fillText(Math.round(v).toLocaleString(), left - 6 * k, y(v))
    }
    const bw = Math.max(1, pw / qc.rates.length - 1 * k)
    qc.rates.forEach((r, i) => { ctx.fillStyle = qc.flagged[i] ? c.bad : c.ok; ctx.fillRect(x(i), y(r), bw, top + ph - y(r)) })
    ctx.strokeStyle = c.axis; ctx.lineWidth = 1.5 * k
    ctx.setLineDash([4 * k, 3 * k]); ctx.beginPath(); ctx.moveTo(left, y(qc.median)); ctx.lineTo(left + pw, y(qc.median)); ctx.stroke(); ctx.setLineDash([])
    ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left, top + ph); ctx.lineTo(left + pw, top + ph); ctx.stroke()
    ctx.fillStyle = c.text; ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    const unit = qc.seconds ? 's' : 'time units'
    for (let t = 0; t <= 4; t++) ctx.fillText(`${Math.round(qc.binStart + (qc.binWidth * qc.rates.length * t) / 4).toLocaleString()}`, left + (pw * t) / 4, top + ph + 6 * k)
    ctx.fillText(`Time (${unit})`, left + pw / 2, top + ph + 22 * k)
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = `600 ${13 * k}px system-ui, sans-serif`
    ctx.fillText(`${name}: events per time bin`, left, 18 * k)
    ctx.restore()
  }

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [file])

  useEffect(() => {
    const c = canvas.current
    if (!c || size.w < 50 || size.h < 50) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, size.w, size.h, 1)
  }, [qc, size, theme, name]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    registerPlotExporter(() => {
      if (!qc || qc.rates.length === 0) return null
      const out = document.createElement('canvas')
      out.width = 1600; out.height = 800
      const ctx = out.getContext('2d')
      if (!ctx) return null
      draw(ctx, 1600, 800, 2)
      return out.toDataURL('image/png')
    })
    return () => registerPlotExporter(null)
  }, [qc, name]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!file || !qc) {
    return (
      <div className="empty-state">
        <h2>Quality Control</h2>
        <p>Select a sample to check how steadily its events were acquired over time and whether any detector saturated.</p>
      </div>
    )
  }
  return (
    <div className="table-view">
      <div className="comp-bar">
        <strong>{name}</strong>
        {qc.timeParam
          ? <span role="status">{qc.flaggedBins === 0 ? 'The flow of events was steady.' : `${qc.flaggedBins} of ${qc.rates.length} time bins look unsteady (${qc.flaggedPercent.toFixed(1)}% of the events).`}</span>
          : <span role="status" className="muted">This file has no time parameter, so the flow cannot be checked.</span>}
      </div>
      <div className="chart-box" ref={wrap}>
        <canvas ref={canvas} role="img" aria-label={qc.timeParam ? `Events per time bin for ${name}, ${qc.flaggedBins} unsteady bins` : 'No time parameter'} style={{ width: size.w, height: size.h }} />
      </div>
      <section className="qc-sat" aria-label="Saturated detectors">
        <h3>Saturated detectors</h3>
        {sat.length === 0 ? <p className="muted">No events sit at the top of a detector range.</p> : (
          <table className="mini">
            <thead><tr><th>Parameter</th><th className="r">Events at the limit</th><th className="r">% of events</th></tr></thead>
            <tbody>{sat.map((s) => <tr key={s.param}><td>{s.param}</td><td className="r num">{s.count.toLocaleString()}</td><td className="r num">{s.percent.toFixed(2)}</td></tr>)}</tbody>
          </table>
        )}
      </section>
    </div>
  )
}
