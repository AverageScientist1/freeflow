// A report as one self-contained HTML page: text, the table of statistics and charts (as embedded PNG images).
// It opens in any browser and prints to PDF from there.

import type { ReportBlock } from './reportTypes'
import { columnLabel, type TableRow } from './table'
import type { TableColumn } from './stats'

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export interface ReportInput {
  title: string
  date: string
  blocks: ReportBlock[]
  columns: TableColumn[]
  rows: TableRow[]
  groupName: string
  format: (col: TableColumn, v: number | null) => string
  chartImages: Record<string, string | null> // block id -> PNG data URL (null: nothing to draw)
}

const STYLE = `body{font:14px/1.5 system-ui,"Segoe UI",sans-serif;color:#1a1a1a;background:#fff;max-width:960px;margin:24px auto;padding:0 16px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px}p{margin:8px 0;white-space:pre-wrap}.meta{color:#5c6066;margin-bottom:16px}
table{border-collapse:collapse;font-size:12px;width:100%}th,td{border:1px solid #cfd1d3;padding:4px 8px;text-align:left}th{background:#f2f2f2}td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
img{max-width:100%;border:1px solid #cfd1d3}.note{color:#5c6066;font-style:italic}`

export function reportHtml(r: ReportInput): string {
  const out: string[] = []
  for (const b of r.blocks) {
    if (b.kind === 'heading') out.push(`<h2>${escapeHtml(b.text)}</h2>`)
    else if (b.kind === 'text') out.push(`<p>${escapeHtml(b.text)}</p>`)
    else if (b.kind === 'table') {
      if (r.columns.length === 0) { out.push('<p class="note">The table has no columns yet.</p>'); continue }
      const head = r.columns.map((c) => `<th class="r">${escapeHtml(columnLabel(c))}</th>`).join('')
      const body = r.rows.map((row) => `<tr><th>${escapeHtml(row.name)}</th><td>${escapeHtml(row.group)}</td>${row.values.map((v, i) => `<td class="r">${escapeHtml(r.format(r.columns[i], v))}</td>`).join('')}</tr>`).join('')
      out.push(`<table><thead><tr><th>Sample</th><th>Group</th>${head}</tr></thead><tbody>${body}</tbody></table>`)
    } else {
      const img = r.chartImages[b.id]
      const col = r.columns.find((c) => c.id === b.colId)
      if (!img || !col) out.push('<p class="note">A chart is missing its table column.</p>')
      else out.push(`<p><img alt="${escapeHtml(`Bar chart of ${columnLabel(col)}`)}" src="${img}"></p>`)
    }
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(r.title)}</title><style>${STYLE}</style></head><body><h1>${escapeHtml(r.title)}</h1><div class="meta">${escapeHtml(r.date)} · ${escapeHtml(r.groupName)} · made with Freeflow</div>${out.join('')}</body></html>`
}
