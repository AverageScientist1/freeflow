import { useEffect, useRef } from 'react'
import { THUMB_MAX, THUMB_MIN, useStore } from './store'

// Single plot / the same plot for every sample / several plots of one sample.
export function ViewSwitch() {
  const gallery = useStore((s) => s.gallery)
  const sheet = useStore((s) => s.sheet)
  const setGallery = useStore((s) => s.setGallery)
  const setSheet = useStore((s) => s.setSheet)
  const samples = useStore((s) => s.wb.samples.length)
  const single = !gallery && !sheet
  const pick = (g: boolean, sh: boolean): void => { setGallery(g); setSheet(sh) }
  return (
    <div className="seg" role="group" aria-label="View">
      <button type="button" className={`btn ${single ? 'active' : ''}`} aria-pressed={single} onClick={() => pick(false, false)} title="One big plot you can gate on">Single plot</button>
      <button type="button" className={`btn ${gallery ? 'active' : ''}`} aria-pressed={gallery} disabled={samples < 2} onClick={() => pick(true, false)} title="The same plot for every sample of the group, as thumbnails">All samples</button>
      <button type="button" className={`btn ${sheet ? 'active' : ''}`} aria-pressed={sheet} disabled={samples < 1} onClick={() => pick(false, true)} title="Several different plots of the selected sample at once">Sheet</button>
    </div>
  )
}

// Smooth: density colours and smoothed curves. Raw: every event as it is, in plain dots or unsmoothed bins.
export function DisplayToggle() {
  const mode = useStore((s) => s.displayMode)
  const setMode = useStore((s) => s.setDisplayMode)
  return (
    <div className="seg" role="group" aria-label="Display">
      <button type="button" className={`btn ${mode === 'smooth' ? 'active' : ''}`} aria-pressed={mode === 'smooth'} onClick={() => setMode('smooth')} title="Density colours and smoothed curves">Smooth</button>
      <button type="button" className={`btn ${mode === 'raw' ? 'active' : ''}`} aria-pressed={mode === 'raw'} onClick={() => setMode('raw')} title="Every event as it is: plain dots, unsmoothed histogram bins">Raw</button>
    </div>
  )
}

// The size of the thumbnails of the gallery and the sheet: a slider, and Ctrl + mouse wheel (or a pinch on a touchpad) over the
// thumbnails, as in the file explorer.
export function SizeSelect() {
  const size = useStore((s) => s.thumbSize)
  const setSize = useStore((s) => s.setThumbSize)
  return (
    <label className="plot-type"><span className="axis-label">Size</span>
      <input type="range" aria-label="Thumbnail size" min={THUMB_MIN} max={THUMB_MAX} step={10} value={size} onChange={(e) => setSize(Number(e.target.value))} title="Size of the thumbnails (also Ctrl + mouse wheel over them)" />
    </label>
  )
}

export function useWheelZoom<T extends HTMLElement>(): React.RefObject<T> {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return // a plain wheel scrolls
      e.preventDefault()
      const st = useStore.getState()
      st.setThumbSize(st.thumbSize * (e.deltaY < 0 ? 1.1 : 1 / 1.1))
    }
    el.addEventListener('wheel', onWheel, { passive: false }) // a page-level listener would be passive; this one has to cancel the browser's own zoom
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  return ref as React.RefObject<T>
}