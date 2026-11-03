import { useMemo } from 'react'
import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Trash2, LayoutGrid, Pencil } from 'lucide-react'
import { namePath } from '@core/groups'
import { populationsFor } from '@core/workbench'
import { tilesFromGates } from '@core/sheet'
import type { SheetTile } from '@core/reportTypes'
import { populationPaths, pathLabel } from '@core/table'
import { useStore } from './store'
import { useSampleData } from './hooks'
import { buildTile, TileCanvas } from './TileView'
import { DisplayToggle, SizeSelect, ViewSwitch, useWheelZoom } from './ViewBar'
import { PlotView } from './PlotView'

let counter = 0
const tileId = (): string => `t${Date.now().toString(36)}${(counter++).toString(36)}`

// Several different plots of the selected sample at once (the sheet). Moving to another sample keeps the same plots,
// so a whole panel can be read down the list of samples.
export function SheetView() {
  const { wb, file } = useSampleData()
  const files = useStore((s) => s.files)
  const sampleId = useStore((s) => s.sampleId)
  const xParam = useStore((s) => s.xParam)
  const yParam = useStore((s) => s.yParam)
  const plotType = useStore((s) => s.plotType)
  const popId = useStore((s) => s.popId)
  const scaleVersion = useStore((s) => s.scaleVersion)
  const setTiles = useStore((s) => s.setSheetTiles)
  const openTile = useStore((s) => s.openTile)
  const editTile = useStore((s) => s.editTile)
  const editing = useStore((s) => s.sheetEdit)
  const selectRelative = useStore((s) => s.selectRelative)
  const contourCount = useStore((s) => s.contourLevels)
  const showOutliers = useStore((s) => s.showOutliers)
  const raw = useStore((s) => s.displayMode) === 'raw'
  const size = useStore((s) => s.thumbSize)
  const sheetRef = useWheelZoom<HTMLDivElement>()
  const name = wb.samples.find((s) => s.id === sampleId)?.name ?? ''
  const tiles = wb.sheet ?? []
  const params = file?.parameters.map((p) => p.name) ?? []
  const paths = useMemo(() => (sampleId ? populationPaths(wb, [sampleId]) : []), [wb.populations, sampleId]) // eslint-disable-line react-hooks/exhaustive-deps

  const built = useMemo(
    () => (sampleId ? tiles.map((t) => buildTile(wb, files[sampleId], sampleId, name, { path: t.path, x: t.x, y: t.y, plot: t.plot, levels: contourCount, outliers: showOutliers, raw })) : []),
    [wb, files, sampleId, tiles, contourCount, showOutliers, raw, scaleVersion, name], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const patch = (id: string, change: Partial<SheetTile>): void => setTiles(tiles.map((t) => (t.id === id ? { ...t, ...change } : t)))
  const currentPath = useMemo(() => namePath(populationsFor(wb, sampleId), popId), [wb.populations, sampleId, popId]) // eslint-disable-line react-hooks/exhaustive-deps
  // while a tile is open in the editor, changes made there (axes, plot type, the population looked into) are the tile's too
  useEffect(() => {
    if (!editing) return
    const t = tiles.find((x) => x.id === editing)
    if (!t) return
    const y = plotType === 'histogram' ? t.y : yParam
    if (t.x !== xParam || t.y !== y || t.plot !== plotType || JSON.stringify(t.path) !== JSON.stringify(currentPath)) setTiles(tiles.map((x) => (x.id === editing ? { ...x, x: xParam, y, plot: plotType, path: currentPath } : x)))
  }, [editing, xParam, yParam, plotType, currentPath]) // eslint-disable-line react-hooks/exhaustive-deps
  const addCurrent = (): void => setTiles([...tiles, { id: tileId(), path: currentPath, x: xParam, y: yParam, plot: plotType }])
  const fromGates = (): void => { if (sampleId) setTiles(tilesFromGates(wb, sampleId, tileId)) }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); selectRelative(1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); selectRelative(-1) }
  }

  return (
    <div className="plot-pane">
      <div className="plot-bar">
        <ViewSwitch />
        <button type="button" className="btn" onClick={addCurrent} disabled={!file}>Add plot</button>
        <button type="button" className="btn" onClick={fromGates} disabled={!file} title="One plot per gate, each on its parent population (replaces the sheet)">Plots from gates</button>
        <button type="button" className="btn" onClick={() => setTiles([])} disabled={tiles.length === 0}>Clear sheet</button>
        <DisplayToggle />
        <SizeSelect />
        <span className="sheet-nav">
          <button type="button" className="btn icon" aria-label="Previous sample" onClick={() => selectRelative(-1)}><ChevronLeft size={16} /></button>
          <strong className="ellipsis" title={name}>{name || 'No sample'}</strong>
          <button type="button" className="btn icon" aria-label="Next sample" onClick={() => selectRelative(1)}><ChevronRight size={16} /></button>
        </span>
      </div>
      <div className="sheet-scroll" ref={sheetRef}>
      {editing && tiles.some((t) => t.id === editing) && (
        <section className="sheet-editor" aria-label="Plot editor">
          <div className="row"><strong className="grow">Editing plot {tiles.findIndex((t) => t.id === editing) + 1}: draw and change gates here, the thumbnails below follow</strong><button type="button" className="btn" onClick={() => editTile(null)}>Close editor</button></div>
          <div className="sheet-editor-plot"><PlotView embedded /></div>
        </section>
      )}
      {tiles.length === 0 ? (
        <div className="empty-state">
          <h2>The sheet is empty</h2>
          <p>Press <strong>Plots from gates</strong> to get one plot per gate (the gating strategy at a glance), or <strong>Add plot</strong> to add the plot you have open. Then use the arrow keys or the sample buttons to see the same plots for each sample.</p>
        </div>
      ) : (
        <div className="gallery sheet" aria-label="Sheet of plots" tabIndex={0} onKeyDown={onKeyDown}>
          {tiles.map((t, i) => (
            <figure key={t.id} className="tile" style={{ width: size }}>
              <figcaption className="tile-edit">
                <select aria-label={`Population of plot ${i + 1}`} value={JSON.stringify(t.path)} onChange={(e) => patch(t.id, { path: JSON.parse(e.target.value) as string[] })}>
                  {!paths.some((p) => JSON.stringify(p) === JSON.stringify(t.path)) && <option value={JSON.stringify(t.path)}>{pathLabel(t.path)}</option>}
                  {paths.map((p) => <option key={JSON.stringify(p)} value={JSON.stringify(p)}>{pathLabel(p)}</option>)}
                </select>
                <select aria-label={`Plot type of plot ${i + 1}`} value={t.plot} onChange={(e) => patch(t.id, { plot: e.target.value as SheetTile['plot'] })}>
                  <option value="pseudocolor">Pseudocolor</option>
                  <option value="contour">Contour</option>
                  <option value="zebra">Zebra</option>
                  <option value="histogram">Histogram</option>
                </select>
                <select aria-label={`X of plot ${i + 1}`} value={t.x} onChange={(e) => patch(t.id, { x: e.target.value })}>
                  {!params.includes(t.x) && <option value={t.x}>{t.x}</option>}
                  {params.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                {t.plot !== 'histogram' && (
                  <select aria-label={`Y of plot ${i + 1}`} value={t.y} onChange={(e) => patch(t.id, { y: e.target.value })}>
                    {!params.includes(t.y) && <option value={t.y}>{t.y || '–'}</option>}
                    {params.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}
                <span className="tile-actions">
                  <button type="button" className="icon-link" aria-label={`Edit gates of plot ${i + 1}`} title="Draw and change gates on this plot, here in the sheet" onClick={() => editTile(t)}><Pencil size={12} /></button>
                  <button type="button" className="icon-link" aria-label={`Open plot ${i + 1} as the single plot`} title="Open as the single plot" onClick={() => openTile(t)}><LayoutGrid size={12} /></button>
                  <button type="button" className="icon-link" aria-label={`Remove plot ${i + 1}`} title="Remove from the sheet" onClick={() => setTiles(tiles.filter((x) => x.id !== t.id))}><Trash2 size={12} /></button>
                </span>
              </figcaption>
              {built[i] && <TileCanvas tile={built[i]} size={size} selected={t.id === editing} onOpen={() => openTile(t)} label={`Plot ${i + 1} of ${name}: ${t.plot} ${t.plot === 'histogram' ? t.x : `${t.y} against ${t.x}`}, ${built[i].events.toLocaleString()} events${built[i].gates.map((g) => `; ${g.name} ${g.pct === null ? '' : g.pct.toFixed(1) + '%'}`).join('')}`} />}
            </figure>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}