import type { FcsFile } from '@core/fcs'
import type { Workbench } from '@core/workbench'
import { reportHtml } from '@core/report'
import { computeTable, formatStat } from '@core/table'
import { DEFAULT_GROUP, DEFAULT_GROUP_NAME } from '@core/workbench'
import { barsFor, drawChart } from './chartDraw'

// Charts in a report are always drawn on white with dark text, so the page looks the same whichever theme the program is in.
const PAPER = { bg: '#ffffff', text: '#1a1a1a', axis: '#1a1a1a', grid: '#e5e6e6' }

export function buildReportHtml(wb: Workbench, files: Record<string, FcsFile | undefined>, groupFilter: string): string {
  const columns = wb.table ?? []
  const blocks = wb.report ?? []
  const rows = computeTable(wb, files, groupFilter, columns)
  const chartImages: Record<string, string | null> = {}
  for (const b of blocks) {
    if (b.kind !== 'chart') continue
    const col = columns.find((c) => c.id === b.colId)
    if (!col) { chartImages[b.id] = null; continue }
    const { bars } = barsFor(computeTable(wb, files, groupFilter, [col]), b.by)
    const canvas = document.createElement('canvas')
    canvas.width = 1400
    canvas.height = 700
    const ctx = canvas.getContext('2d')
    if (!ctx) { chartImages[b.id] = null; continue }
    const title = col.path.length ? col.path.join(' / ') : 'All events'
    drawChart(ctx, 1400, 700, bars, col.param ?? (col.stat === 'count' ? 'Events' : '%'), title, PAPER, 1.75)
    chartImages[b.id] = canvas.toDataURL('image/png')
  }
  const gid = groupFilter
  const groupName = gid === DEFAULT_GROUP ? DEFAULT_GROUP_NAME : (wb.groups.find((g) => g.id === gid)?.name ?? DEFAULT_GROUP_NAME)
  return reportHtml({ title: wb.name || 'Report', date: new Date().toLocaleDateString(), blocks, columns, rows, groupName, format: (c, v) => formatStat(c.stat, v), chartImages })
}
