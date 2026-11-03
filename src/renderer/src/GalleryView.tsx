import { useMemo } from 'react'
import { LayoutGrid } from 'lucide-react'
import { namePath, samplesInGroup } from '@core/groups'
import { populationsFor } from '@core/workbench'
import { useStore } from './store'
import { ParamSelect } from './PlotView'
import { buildTile, TileCanvas } from './TileView'
import { DisplayToggle, SizeSelect, ViewSwitch, useWheelZoom } from './ViewBar'
import type { PlotType } from './store'

// The same plot (population, axes, gates) for every sample of the group, as thumbnails: differences stand out.
export function GalleryView() {
  const wb = useStore((s) => s.wb)
  const files = useStore((s) => s.files)
  const groupFilter = useStore((s) => s.groupFilter)
  const sampleId = useStore((s) => s.sampleId)
  const popId = useStore((s) => s.popId)
  const x = useStore((s) => s.xParam)
  const y = useStore((s) => s.yParam)
  const plotType = useStore((s) => s.plotType)
  const setPlotType = useStore((s) => s.setPlotType)
  const scaleVersion = useStore((s) => s.scaleVersion)
  const selectSample = useStore((s) => s.selectSample)
  const selectRelative = useStore((s) => s.selectRelative)
  const setGallery = useStore((s) => s.setGallery)
  const contourCount = useStore((s) => s.contourLevels)
  const showOutliers = useStore((s) => s.showOutliers)
  const raw = useStore((s) => s.displayMode) === 'raw'
  const size = useStore((s) => s.thumbSize)
  const galleryRef = useWheelZoom<HTMLDivElement>()
  const oneD = plotType === 'histogram'
  const members = samplesInGroup(wb, groupFilter)
  const path = useMemo(() => namePath(populationsFor(wb, sampleId), popId), [wb.populations, sampleId, popId]) // eslint-disable-line react-hooks/exhaustive-deps
  const tiles = useMemo(
    () => members.map((m) => buildTile(wb, files[m.id], m.id, m.name, { path, x, y, plot: plotType, levels: contourCount, outliers: showOutliers, raw })),
    [wb, files, groupFilter, path, x, y, plotType, contourCount, showOutliers, raw, scaleVersion], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // arrow keys move through the samples, like in the list
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); selectRelative(1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); selectRelative(-1) }
  }

  return (
    <div className="plot-pane">
      <div className="plot-bar">
        <ViewSwitch />
        <label className="plot-type">
          <span className="axis-label">Plot</span>
          <select aria-label="Plot type" value={plotType} onChange={(e) => setPlotType(e.target.value as PlotType)}>
            <option value="pseudocolor">Pseudocolor</option>
            <option value="contour">Contour</option>
            <option value="zebra">Zebra</option>
            <option value="histogram">Histogram</option>
          </select>
        </label>
        <ParamSelect axis="x" />
        {!oneD && <ParamSelect axis="y" />}
        <DisplayToggle />
        <SizeSelect />
        <span className="muted plot-count">{path.length ? path.join(' / ') : 'All events'} · {members.length} samples</span>
      </div>
      <div className="gallery" aria-label="All samples" tabIndex={0} onKeyDown={onKeyDown} ref={galleryRef}>
        {tiles.map((t) => (
          <figure key={t.sampleId} className={`tile ${t.sampleId === sampleId ? 'selected' : ''}`} style={{ width: size }}>
            <figcaption>
              <button type="button" className="link-btn" onClick={() => selectSample(t.sampleId)} title="Select this sample">{t.name}</button>
              <button type="button" className="icon-link" aria-label={`Open ${t.name} as a single plot`} title="Open as a single plot" onClick={() => { selectSample(t.sampleId); setGallery(false) }}><LayoutGrid size={12} /></button>
            </figcaption>
            <TileCanvas tile={t} size={size} selected={t.sampleId === sampleId} onOpen={() => { selectSample(t.sampleId); setGallery(false) }} />
          </figure>
        ))}
      </div>
    </div>
  )
}