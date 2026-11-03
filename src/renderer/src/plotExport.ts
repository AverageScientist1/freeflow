// The plot registers a function that draws its current picture (points, axes and gates) as a PNG, so the
// File menu can save it without knowing anything about the plot.
let exporter: (() => string | null) | null = null

export function registerPlotExporter(fn: (() => string | null) | null): void {
  exporter = fn
}

export function currentPlotPng(): string | null {
  return exporter ? exporter() : null
}
