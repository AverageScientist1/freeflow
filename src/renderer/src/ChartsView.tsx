import { useEffect, useMemo, useRef, useState } from 'react'
import { computeTable, columnLabel } from '@core/table'
import { useStore } from './store'
import { CHART_PALETTE, barsFor, drawChart, type ChartColors } from './chartDraw'
import { registerPlotExporter } from './plotExport'

function colorsNow(): ChartColors {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string, d: string): string => css.getPropertyValue(n).trim() || d
  return { bg: v('--color-bg', '#ffffff'), text: v('--color-text', '#1a1a1a'), axis: v('--plot-axis', '#1a1a1a'), grid: v('--plot-grid', '#e5e6e6') }
}

type By = 'sample' | 'group'

export function ChartsView() {
  const wb = useStore((s) => s.wb)
  const files = useStore((s) => s.files)
  const groupFilter = useStore((s) => s.groupFilter)
  const scaleVersion = useStore((s) => s.scaleVersion)
  const theme = useStore((s) => s.theme)
  const colId = useStore((s) => s.chartColId)
  const setChartCol = useStore((s) => s.setChartCol)
  const columns = wb.table ?? []
  const [by, setBy] = useState<By>('sample')
  const col = columns.find((c) => c.id === colId) ?? columns[0]
  const colIndex = col ? columns.indexOf(col) : -1
  const rows = useMemo(() => (col ? computeTable(wb, files, groupFilter, [col]) : []), [wb, files, groupFilter, col, scaleVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const { bars, groupNames } = useMemo(() => barsFor(rows, by), [rows, by])

  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const title = col ? columnLabel(col) : ''
  const yLabel = col ? (col.param ?? (col.stat === 'count' ? 'Events' : '%')) : ''

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [col])

  useEffect(() => {
    const c = canvas.current
    if (!c || size.w < 50 || size.h < 50) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr)
    c.height = Math.round(size.h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawChart(ctx, size.w, size.h, bars, yLabel, title, colorsNow())
  }, [bars, size, yLabel, title, theme])

  // the File menu saves a larger picture of the same chart
  useEffect(() => {
    registerPlotExporter(() => {
      if (!col) return null
      const out = document.createElement('canvas')
      out.width = 1600
      out.height = 900
      const ctx = out.getContext('2d')
      if (!ctx) return null
      drawChart(ctx, 1600, 900, bars, yLabel, title, colorsNow(), 1600 / 800)
      return out.toDataURL('image/png')
    })
    return () => registerPlotExporter(null)
  }, [bars, yLabel, title, col])

  if (columns.length === 0) {
    return (
      <div className="empty-state">
        <h2>Charts</h2>
        <p>A chart shows one column of a table. Open the Tables mode and add a column first.</p>
      </div>
    )
  }
  const summary = bars.filter((b) => b.value !== null).map((b) => `${b.label}: ${Math.round((b.value as number) * 100) / 100}`).join('; ')

  return (
    <div className="table-view">
      <div className="comp-bar">
        <label className="axis-control"><span className="axis-label">Column</span>
          <select aria-label="Chart column" value={col?.id ?? ''} onChange={(e) => setChartCol(e.target.value)}>
            {columns.map((c) => <option key={c.id} value={c.id}>{columnLabel(c)}</option>)}
          </select>
        </label>
        <fieldset className="radios row" aria-label="Bars show">
          <label><input type="radio" name="by" checked={by === 'sample'} onChange={() => setBy('sample')} /> One bar per sample</label>
          <label><input type="radio" name="by" checked={by === 'group'} onChange={() => setBy('group')} /> Mean ± SD per group</label>
        </fieldset>
        <span className="muted">{colIndex >= 0 && rows.length > 0 ? `${rows.length} sample(s)` : ''}</span>
      </div>
      <div className="chart-box" ref={wrap}>
        <canvas ref={canvas} role="img" aria-label={`Bar chart of ${title}. ${summary}`} style={{ width: size.w, height: size.h }} />
      </div>
      {groupNames.length > 1 && (
        <ul className="legend" aria-label="Groups">
          {groupNames.map((g, i) => <li key={g}><span className="swatch" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} /> {g}</li>)}
        </ul>
      )}
    </div>
  )
}
