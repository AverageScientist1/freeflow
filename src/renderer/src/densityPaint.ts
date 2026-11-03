// Draws contour and zebra plots on a 2D canvas. Shared by the main plot and the thumbnails of the gallery.

import { bandImage, contourLevels, contourSegments, densityField, outlierPoints } from '@core/contour'

export type DensityStyle = 'contour' | 'zebra'

export interface DensityLayer {
  levels: number[]
  segments: Float32Array[] // one set of line segments per level, innermost last
  bands: Uint8Array | null // for the zebra style
  bandSize: number
  outliers: Float32Array // x, y pairs
}

const BAND_SIZE = 160

export function buildDensityLayer(xs: Float32Array, ys: Float32Array, mask: Uint8Array | null, levelCount: number, style: DensityStyle, outliers: boolean, passes = 2): DensityLayer {
  const field = densityField(xs, ys, mask, undefined, passes)
  const levels = contourLevels(field, levelCount)
  return {
    levels,
    segments: levels.map((l) => contourSegments(field, l)),
    bands: style === 'zebra' && levels.length ? bandImage(field, levels, BAND_SIZE) : null,
    bandSize: BAND_SIZE,
    outliers: outliers && levels.length ? outlierPoints(xs, ys, mask, field, levels[0]) : new Float32Array(0),
  }
}

function rgb(value: string, fallback: [number, number, number]): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (!m) return fallback
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

// Paints into the rectangle (x, y, w, h) of the canvas, which is the plot area; positions in the layer are 0..1 with y up.
export function paintDensity(ctx: CanvasRenderingContext2D, layer: DensityLayer, style: DensityStyle, x: number, y: number, w: number, h: number): void {
  const css = getComputedStyle(document.documentElement)
  const line = css.getPropertyValue('--plot-contour').trim() || '#3f4a57'
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  if (style === 'zebra' && layer.bands) {
    const a = rgb(css.getPropertyValue('--plot-zebra-a'), [201, 206, 214])
    const b = rgb(css.getPropertyValue('--plot-zebra-b'), [139, 148, 163])
    const s = layer.bandSize
    const img = new ImageData(s, s)
    for (let row = 0; row < s; row++)
      for (let col = 0; col < s; col++) {
        const band = layer.bands[(s - 1 - row) * s + col] // row 0 of the picture is the top of the plot
        if (band === 0) continue
        const c = band % 2 === 1 ? a : b
        const o = (row * s + col) * 4
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255
      }
    const tmp = document.createElement('canvas')
    tmp.width = s
    tmp.height = s
    tmp.getContext('2d')?.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(tmp, x, y, w, h)
  }
  ctx.strokeStyle = line
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const seg of layer.segments)
    for (let i = 0; i < seg.length; i += 4) {
      ctx.moveTo(x + seg[i] * w, y + (1 - seg[i + 1]) * h)
      ctx.lineTo(x + seg[i + 2] * w, y + (1 - seg[i + 3]) * h)
    }
  ctx.stroke()
  ctx.fillStyle = line
  const o = layer.outliers
  for (let i = 0; i < o.length; i += 2) ctx.fillRect(x + o[i] * w - 0.75, y + (1 - o[i + 1]) * h - 0.75, 1.5, 1.5)
  ctx.restore()
}
