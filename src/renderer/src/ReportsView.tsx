import { useMemo } from 'react'
import { ArrowDown, ArrowUp, Download, Trash2 } from 'lucide-react'
import type { ReportBlock } from '@core/reportTypes'
import { columnLabel } from '@core/table'
import { useStore } from './store'
import { buildReportHtml } from './reportBuild'

// A page loaded into a frame is replaced by a new frame rather than by changing its text: the production security policy lets the first load of a frame through but not a reload of it.
function hashOf(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

let counter = 0
const blockId = (): string => `b${Date.now().toString(36)}${(counter++).toString(36)}`

const KIND_LABEL: Record<ReportBlock['kind'], string> = { heading: 'Heading', text: 'Text', table: 'Table of statistics', chart: 'Chart' }

export function ReportsView() {
  const wb = useStore((s) => s.wb)
  const files = useStore((s) => s.files)
  const groupFilter = useStore((s) => s.groupFilter)
  const scaleVersion = useStore((s) => s.scaleVersion)
  const setReport = useStore((s) => s.setReport)
  const exportReport = useStore((s) => s.exportReport)
  const blocks = wb.report ?? []
  const columns = wb.table ?? []
  const html = useMemo(() => buildReportHtml(wb, files, groupFilter), [wb, files, groupFilter, scaleVersion]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (id: string, change: Partial<ReportBlock>): void => setReport(blocks.map((b) => (b.id === id ? ({ ...b, ...change } as ReportBlock) : b)))
  const move = (i: number, d: number): void => {
    const j = i + d
    if (j < 0 || j >= blocks.length) return
    const next = [...blocks]
    ;[next[i], next[j]] = [next[j], next[i]]
    setReport(next)
  }
  const add = (b: ReportBlock): void => setReport([...blocks, b])

  return (
    <div className="report-view">
      <section className="report-editor" aria-label="Report blocks">
        <div className="stack">
          <div className="row wrap" role="group" aria-label="Add a block">
            <button type="button" className="btn" onClick={() => add({ id: blockId(), kind: 'heading', text: 'Heading' })}>Add heading</button>
            <button type="button" className="btn" onClick={() => add({ id: blockId(), kind: 'text', text: '' })}>Add text</button>
            <button type="button" className="btn" onClick={() => add({ id: blockId(), kind: 'table' })} disabled={columns.length === 0} title={columns.length ? '' : 'Add columns in the Tables mode first'}>Add table</button>
            <button type="button" className="btn" onClick={() => add({ id: blockId(), kind: 'chart', colId: columns[0].id, by: 'sample' })} disabled={columns.length === 0} title={columns.length ? '' : 'Add columns in the Tables mode first'}>Add chart</button>
          </div>
          {blocks.length === 0 && <p className="muted">A report is a list of blocks, in order. The table and the charts come from the columns you defined in the Tables mode, for the group selected on the left.</p>}
          <ol className="block-list">
            {blocks.map((b, i) => (
              <li key={b.id} className="panel-card block-item">
                <div className="row">
                  <strong className="grow">{KIND_LABEL[b.kind]}</strong>
                  <button type="button" className="btn icon small" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${KIND_LABEL[b.kind]} up`}><ArrowUp size={14} /></button>
                  <button type="button" className="btn icon small" onClick={() => move(i, 1)} disabled={i === blocks.length - 1} aria-label={`Move ${KIND_LABEL[b.kind]} down`}><ArrowDown size={14} /></button>
                  <button type="button" className="btn icon small" onClick={() => setReport(blocks.filter((x) => x.id !== b.id))} aria-label={`Remove ${KIND_LABEL[b.kind]}`}><Trash2 size={14} /></button>
                </div>
                {b.kind === 'heading' && <input type="text" aria-label="Heading text" value={b.text} onChange={(e) => patch(b.id, { text: e.target.value })} />}
                {b.kind === 'text' && <textarea aria-label="Text" rows={4} value={b.text} onChange={(e) => patch(b.id, { text: e.target.value })} />}
                {b.kind === 'chart' && (
                  <div className="stack">
                    <select aria-label="Chart column" value={b.colId} onChange={(e) => patch(b.id, { colId: e.target.value })}>
                      {!columns.some((c) => c.id === b.colId) && <option value={b.colId}>(column removed)</option>}
                      {columns.map((c) => <option key={c.id} value={c.id}>{columnLabel(c)}</option>)}
                    </select>
                    <select aria-label="Bars show" value={b.by} onChange={(e) => patch(b.id, { by: e.target.value as 'sample' | 'group' })}>
                      <option value="sample">One bar per sample</option>
                      <option value="group">Mean ± SD per group</option>
                    </select>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <button type="button" className="btn primary" onClick={() => void exportReport()} disabled={blocks.length === 0}><Download size={14} /> Export report (HTML)</button>
        </div>
      </section>
      <section className="report-preview" aria-label="Report preview">
        <iframe key={hashOf(html)} title="Report preview" sandbox="" srcDoc={html} />
      </section>
    </div>
  )
}
