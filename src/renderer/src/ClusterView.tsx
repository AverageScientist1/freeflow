import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Play, Square } from 'lucide-react'
import { buildClusterInput, kmeans, summarizeClusters, zScores } from '@core/cluster'
import type { EmbedAlgo } from '@core/embed'
import { namePath, samplesInGroup } from '@core/groups'
import { pathLabel, populationPaths } from '@core/table'
import { populationsFor } from '@core/workbench'
import { useStore, type ClusterRun } from './store'
import { useParamNames } from './TablesView'
import { CHART_PALETTE } from './chartDraw'
import { runEmbedding, type EmbedJob } from './embedClient'
import { registerPlotExporter } from './plotExport'

// The parameters worth clustering on by default: the fluorescence ones, not scatter, time or widths.
const isMarker = (name: string): boolean => !/^(FSC|SSC|time|event)/i.test(name) && !/(width|-w)$/i.test(name) && !/^Comp-/.test(name)

const MAX_EVENTS: Record<EmbedAlgo, number> = { umap: 10000, tsne: 2500 }
const DEFAULT_EVENTS: Record<EmbedAlgo, number> = { umap: 3000, tsne: 1500 }

const clusterColor = (i: number, k: number, dark: boolean): string => `hsl(${Math.round((i * 360) / Math.max(1, k) + 15) % 360} 65% ${dark ? 62 : 46}%)`

function hex(v: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(v.trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rampAt(t: number, ramp: [number, number, number][]): string {
  const f = Math.min(1, Math.max(0, t)) * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(f))
  const k = f - i
  const c = ramp[i].map((v, j) => Math.round(v + (ramp[i + 1][j] - v) * k))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

// A heat map cell: blue below the average of the clusters, red above, white at it. Always dark text on a light colour.
function heatStyle(z: number): { background: string; color: string } {
  const a = Math.min(1, Math.abs(z) / 2.2) * 0.8
  const [r, g, b] = z >= 0 ? [214, 69, 65] : [52, 120, 200]
  const mix = (c: number): number => Math.round(255 + (c - 255) * a) // over white, so the colour is the same in the dark theme
  return { background: `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`, color: '#141414' }
}
type ColorBy = 'cluster' | 'sample' | `p:${string}`

function EmbeddingCanvas({ run, colorBy, highlight, dark }: { run: ClusterRun; colorBy: ColorBy; highlight: number | null; dark: boolean }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const bounds = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (let i = 0; i < run.input.n; i++) {
      const x = run.embedding[i * 2], y = run.embedding[i * 2 + 1]
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
    }
    const px = (x1 - x0) * 0.04 || 1, py = (y1 - y0) * 0.04 || 1
    return { x0: x0 - px, x1: x1 + px, y0: y0 - py, y1: y1 + py }
  }, [run])
  const name = run.algo === 'umap' ? 'UMAP' : 't-SNE'

  const draw = (ctx: CanvasRenderingContext2D, W: number, H: number, k: number): void => {
    const css = getComputedStyle(document.documentElement)
    const v = (n: string, d: string): string => css.getPropertyValue(n).trim() || d
    ctx.save()
    ctx.fillStyle = v('--plot-bg', '#fff')
    ctx.fillRect(0, 0, W, H)
    const left = 46 * k, right = 12 * k, top = 12 * k, bottom = 36 * k
    const pw = W - left - right, ph = H - top - bottom
    if (pw < 20 || ph < 20) { ctx.restore(); return }
    ctx.strokeStyle = v('--plot-axis', '#000'); ctx.lineWidth = k
    ctx.strokeRect(left + 0.5, top + 0.5, pw, ph)
    ctx.fillStyle = v('--color-text', '#000'); ctx.font = `${12 * k}px system-ui, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
    ctx.fillText(`${name} 1`, left + pw / 2, H - 4 * k)
    ctx.save(); ctx.translate(14 * k, top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'top'; ctx.fillText(`${name} 2`, 0, 0); ctx.restore()
    const ramp = [0, 1, 2, 3, 4, 5].map((i) => hex(v(`--plot-heat-${i}`, '#000000')))
    const j = colorBy.startsWith('p:') ? run.input.params.indexOf(colorBy.slice(2)) : -1
    let lo = 0, span = 1
    if (j >= 0) {
      const vals: number[] = []
      for (let i = 0; i < run.input.n; i++) vals.push(run.input.data[i * run.input.d + j])
      vals.sort((a, b) => a - b)
      lo = vals[Math.floor(vals.length * 0.01)] ?? 0
      span = (vals[Math.floor(vals.length * 0.99)] ?? 1) - lo || 1
    }
    const dim = v('--plot-grid', '#ccc')
    const size = 2.2 * k
    for (let i = 0; i < run.input.n; i++) {
      const x = left + ((run.embedding[i * 2] - bounds.x0) / (bounds.x1 - bounds.x0)) * pw
      const y = top + (1 - (run.embedding[i * 2 + 1] - bounds.y0) / (bounds.y1 - bounds.y0)) * ph
      const c = run.labels ? run.labels[i] : 0
      if (highlight !== null && c !== highlight) ctx.fillStyle = dim
      else if (colorBy === 'cluster') ctx.fillStyle = clusterColor(c, run.k, dark)
      else if (colorBy === 'sample') ctx.fillStyle = CHART_PALETTE[run.input.sample[i] % CHART_PALETTE.length]
      else ctx.fillStyle = rampAt((run.input.data[i * run.input.d + j] - lo) / span, ramp)
      ctx.fillRect(x - size / 2, y - size / 2, size, size)
    }
    ctx.restore()
  }

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const c = canvas.current
    if (!c || size.w < 60 || size.h < 60) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr); c.height = Math.round(size.h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(ctx, size.w, size.h, 1)
  }, [run, colorBy, highlight, size, dark]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    registerPlotExporter(() => {
      const out = document.createElement('canvas')
      out.width = 1600; out.height = 1200
      const ctx = out.getContext('2d')
      if (!ctx) return null
      draw(ctx, 1600, 1200, 2)
      return out.toDataURL('image/png')
    })
    return () => registerPlotExporter(null)
  }, [run, colorBy, highlight, dark]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="chart-box" ref={wrap}>
      <canvas ref={canvas} role="img" aria-label={`${name} map of ${run.input.n.toLocaleString()} events from ${run.input.sampleIds.length} sample(s), ${run.k} clusters`} style={{ width: size.w, height: size.h }} />
    </div>
  )
}

export function ClusterView() {
  const wb = useStore((s) => s.wb)
  const files = useStore((s) => s.files)
  const sampleId = useStore((s) => s.sampleId)
  const popId = useStore((s) => s.popId)
  const groupFilter = useStore((s) => s.groupFilter)
  const theme = useStore((s) => s.theme)
  const run = useStore((s) => s.cluster)
  const setCluster = useStore((s) => s.setCluster)
  const exportCluster = useStore((s) => s.exportCluster)
  const setStatus = useStore((s) => s.setStatus)
  const names = useParamNames(groupFilter)
  const [scope, setScope] = useState<'sample' | 'group'>('sample')
  const [algo, setAlgo] = useState<EmbedAlgo>('umap')
  const [events, setEvents] = useState(DEFAULT_EVENTS.umap)
  const [k, setK] = useState(8)
  const [picked, setPicked] = useState<string[] | null>(null)
  const [pathKey, setPathKey] = useState<string | null>(null)
  const [colorBy, setColorBy] = useState<ColorBy>('cluster')
  const [highlight, setHighlight] = useState<number | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const job = useRef<EmbedJob | null>(null)
  const dark = theme === 'dark'

  const params = picked ?? names.filter(isMarker)
  const paths = useMemo(() => (sampleId ? populationPaths(wb, [sampleId]) : []), [wb.populations, sampleId]) // eslint-disable-line react-hooks/exhaustive-deps
  const currentPath = useMemo(() => namePath(populationsFor(wb, sampleId), popId), [wb.populations, sampleId, popId]) // eslint-disable-line react-hooks/exhaustive-deps
  const path: string[] = pathKey ? (JSON.parse(pathKey) as string[]) : currentPath
  const members = scope === 'group' ? samplesInGroup(wb, groupFilter) : wb.samples.filter((s) => s.id === sampleId)
  const running = progress !== null

  useEffect(() => () => job.current?.cancel(), [])
  useEffect(() => { setEvents((e) => Math.min(e, MAX_EVENTS[algo])) }, [algo])

  const start = async (): Promise<void> => {
    setError(null)
    if (params.length < 2) { setError('Choose at least two parameters.'); return }
    const input = buildClusterInput(wb, files, members.map((m) => m.id), path, params, events, 1)
    if (input.n < 30) { setError(`Only ${input.n} events to work with. Choose another population, more samples or fewer exclusions.`); return }
    setProgress(0)
    try {
      const j = runEmbedding(algo, input.data, input.n, input.d, { seed: 1 }, setProgress)
      job.current = j
      const embedding = await j.promise
      const km = kmeans(input.data, input.n, input.d, k, 1)
      setCluster({ algo, input, embedding, labels: km.labels, k: Math.min(k, input.n), summary: summarizeClusters(input, km.labels, Math.min(k, input.n)), populationLabel: pathLabel(path) })
      setHighlight(null)
      if (input.skipped.length) setStatus({ kind: 'warning', text: `Left out of the map: ${input.skipped.map((s) => `${wb.samples.find((x) => x.id === s.sampleId)?.name} (${s.reason})`).join('; ')}` })
    } catch (e) {
      if ((e as Error).message !== 'Cancelled') setError((e as Error).message)
    } finally {
      job.current = null
      setProgress(null)
    }
  }
  const stop = (): void => job.current?.cancel()
  const recluster = (): void => {
    if (!run) return
    const kk = Math.min(k, run.input.n)
    const km = kmeans(run.input.data, run.input.n, run.input.d, kk, 1)
    setCluster({ ...run, labels: km.labels, k: kk, summary: summarizeClusters(run.input, km.labels, kk) })
    setHighlight(null)
  }

  const z = useMemo(() => (run?.summary ? zScores(run.summary.median) : []), [run])
  const sampleTotals = useMemo(() => {
    if (!run?.summary) return []
    return run.input.sampleIds.map((_, s) => run.summary!.bySample.reduce((a, row) => a + row[s], 0))
  }, [run])
  const sampleName = (id: string): string => wb.samples.find((s) => s.id === id)?.name ?? id

  if (wb.samples.length === 0) {
    return (
      <div className="empty-state">
        <h2>Cluster Explorer</h2>
        <p>Add samples first. The explorer draws the events of a population as a map (UMAP or t-SNE), in which cells that look alike sit close together, and groups them into clusters.</p>
      </div>
    )
  }

  return (
    <div className="cluster-view">
      <aside className="cluster-config" aria-label="Cluster settings">
        <fieldset className="radios">
          <legend>Samples</legend>
          <label><input type="radio" name="scope" checked={scope === 'sample'} onChange={() => setScope('sample')} /> The selected sample</label>
          <label><input type="radio" name="scope" checked={scope === 'group'} onChange={() => setScope('group')} disabled={samplesInGroup(wb, groupFilter).length < 2} /> The whole group, joined into one map ({samplesInGroup(wb, groupFilter).length})</label>
        </fieldset>
        <label className="field"><span>Population</span>
          <select aria-label="Population" value={JSON.stringify(path)} onChange={(e) => setPathKey(e.target.value)}>
            {paths.map((p) => <option key={JSON.stringify(p)} value={JSON.stringify(p)}>{pathLabel(p)}</option>)}
          </select>
        </label>
        <fieldset className="radios">
          <legend>Parameters ({params.length})</legend>
          <div className="row wrap">
            <button type="button" className="btn small-text" onClick={() => setPicked(names.filter(isMarker))}>Markers</button>
            <button type="button" className="btn small-text" onClick={() => setPicked(names)}>All</button>
            <button type="button" className="btn small-text" onClick={() => setPicked([])}>None</button>
          </div>
          <div className="check-list">
            {names.map((n) => (
              <label key={n}><input type="checkbox" checked={params.includes(n)} onChange={() => setPicked(params.includes(n) ? params.filter((x) => x !== n) : names.filter((x) => params.includes(x) || x === n))} /> {n}</label>
            ))}
          </div>
        </fieldset>
        <fieldset className="radios">
          <legend>Method</legend>
          <label><input type="radio" name="algo" checked={algo === 'umap'} onChange={() => { setAlgo('umap'); setEvents(DEFAULT_EVENTS.umap) }} /> UMAP (faster, keeps more of the overall layout)</label>
          <label><input type="radio" name="algo" checked={algo === 'tsne'} onChange={() => { setAlgo('tsne'); setEvents(DEFAULT_EVENTS.tsne) }} /> t-SNE (slower, sharper islands)</label>
        </fieldset>
        <label className="field"><span>Events from each sample (up to {MAX_EVENTS[algo].toLocaleString()})</span>
          <input type="number" aria-label="Events per sample" min={100} max={MAX_EVENTS[algo]} step={500} value={events} onChange={(e) => setEvents(Math.min(MAX_EVENTS[algo], Math.max(100, Number(e.target.value) || 100)))} />
        </label>
        <label className="field"><span>Clusters</span>
          <input type="number" aria-label="Clusters" min={2} max={30} value={k} onChange={(e) => setK(Math.min(30, Math.max(2, Number(e.target.value) || 2)))} />
        </label>
        <div className="row wrap">
          {running
            ? <button type="button" className="btn" onClick={stop}><Square size={14} /> Cancel</button>
            : <button type="button" className="btn primary" onClick={() => void start()}><Play size={14} /> Run</button>}
          <button type="button" className="btn" onClick={recluster} disabled={!run || running} title="Group the same map again into the number of clusters above">Re-cluster</button>
        </div>
        {running && <progress aria-label="Progress" value={progress ?? 0} max={1} />}
        {error && <p className="error-text" role="alert">{error}</p>}
        <p className="muted small">Each parameter is measured on the same scale as the plots. Clusters are found on the parameters, not on the map, so they do not depend on how the map came out.</p>
      </aside>
      <section className="cluster-main" aria-label="Cluster results">
        {!run ? (
          <div className="empty-state">
            <h2>No map yet</h2>
            <p>Choose a population and the parameters, then press Run. It takes a few seconds; you can keep using the program meanwhile.</p>
          </div>
        ) : (
          <>
            <div className="comp-bar">
              <label className="axis-control"><span className="axis-label">Colour by</span>
                <select aria-label="Colour by" value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)}>
                  <option value="cluster">Cluster</option>
                  {run.input.sampleIds.length > 1 && <option value="sample">Sample</option>}
                  {run.input.params.map((p) => <option key={p} value={`p:${p}`}>{p}</option>)}
                </select>
              </label>
              <span className="muted">{run.algo === 'umap' ? 'UMAP' : 't-SNE'} of {run.populationLabel}: {run.input.n.toLocaleString()} events, {run.input.sampleIds.length} sample(s)</span>
              <span className="grow" />
              <button type="button" className="btn" onClick={() => void exportCluster()}><Download size={14} /> Export events (CSV)</button>
            </div>
            <EmbeddingCanvas run={run} colorBy={colorBy} highlight={highlight} dark={dark} />
            {colorBy === 'sample' && (
              <ul className="legend" aria-label="Samples">
                {run.input.sampleIds.map((id, i) => <li key={id}><span className="swatch" style={{ background: CHART_PALETTE[i % CHART_PALETTE.length] }} /> {sampleName(id)}</li>)}
              </ul>
            )}
            {run.summary && (
              <div className="cluster-tables">
                <table className="data-table" aria-label="Clusters and their markers">
                  <thead>
                    <tr>
                      <th scope="col">Cluster</th><th scope="col" className="r">Events</th><th scope="col" className="r">%</th>
                      {run.input.params.map((p) => <th key={p} scope="col" className="r" title={`Median of ${p} in each cluster, shown against the average of the clusters`}>{p}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {run.summary.counts.map((n, c) => (
                      <tr key={c} className={highlight === c ? 'current' : ''}>
                        <th scope="row">
                          <button type="button" className="link-btn" aria-pressed={highlight === c} onClick={() => setHighlight(highlight === c ? null : c)} title="Show only this cluster on the map">
                            <span className="swatch" style={{ background: clusterColor(c, run.k, dark), display: 'inline-block', width: 10, height: 10, marginRight: 6 }} />Cluster {c + 1}
                          </button>
                        </th>
                        <td className="r num">{n.toLocaleString()}</td>
                        <td className="r num">{((n / run.input.n) * 100).toFixed(1)}</td>
                        {z[c].map((zz, j) => <td key={j} className="r num" style={heatStyle(zz)} title={`${run.input.params[j]}: median ${run.summary!.median[c][j].toFixed(2)}`}>{zz.toFixed(1)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {run.input.sampleIds.length > 1 && (
                  <table className="data-table" aria-label="Share of each sample in each cluster">
                    <thead><tr><th scope="col">% of the sample in…</th>{run.input.sampleIds.map((id) => <th key={id} scope="col" className="r">{sampleName(id)}</th>)}</tr></thead>
                    <tbody>
                      {run.summary.bySample.map((row, c) => (
                        <tr key={c}>
                          <th scope="row">Cluster {c + 1}</th>
                          {row.map((v, s) => <td key={s} className="r num">{sampleTotals[s] ? ((v / sampleTotals[s]) * 100).toFixed(1) : ''}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
