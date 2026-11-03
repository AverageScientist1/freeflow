import { useMemo, useState } from 'react'
import { Download, Plus, Trash2 } from 'lucide-react'
import { compensate } from '@core/compensation'
import { samplesInGroup } from '@core/groups'
import { isParamStat, STAT_LABELS, type StatKind, type TableColumn } from '@core/stats'
import { columnLabel, computeTable, formatStat, pathLabel, populationPaths } from '@core/table'
import { useStore } from './store'

// Parameters of the samples in view, as they will be measured (compensated samples gain Comp- parameters).
export function useParamNames(groupFilter: string): string[] {
  const wb = useStore((s) => s.wb)
  const files = useStore((s) => s.files)
  return useMemo(() => {
    const seen = new Set<string>()
    for (const m of samplesInGroup(wb, groupFilter)) {
      const raw = files[m.id]
      if (!raw) continue
      const matrix = wb.compensation.matrices.find((x) => x.id === wb.compensation.assignments[m.id])
      for (const p of (matrix ? compensate(raw, matrix).file : raw).parameters) seen.add(p.name)
    }
    return [...seen]
  }, [wb, files, groupFilter])
}

let counter = 0
const columnId = (): string => `c${Date.now().toString(36)}${(counter++).toString(36)}`

export function TablesView() {
  const wb = useStore((s) => s.wb)
  const files = useStore((s) => s.files)
  const groupFilter = useStore((s) => s.groupFilter)
  const sampleId = useStore((s) => s.sampleId)
  const scaleVersion = useStore((s) => s.scaleVersion)
  const setTableColumns = useStore((s) => s.setTableColumns)
  const exportTable = useStore((s) => s.exportTable)
  const selectSample = useStore((s) => s.selectSample)
  const columns = wb.table ?? []
  const members = samplesInGroup(wb, groupFilter)
  const paths = useMemo(() => populationPaths(wb, members.map((m) => m.id)), [wb.populations, wb.samples, wb.groupOf, groupFilter]) // eslint-disable-line react-hooks/exhaustive-deps
  const params = useParamNames(groupFilter)
  const [pathKey, setPathKey] = useState('[]')
  const [stat, setStat] = useState<StatKind>('freqParent')
  const [param, setParam] = useState('')
  const [pct, setPct] = useState(50)
  const rows = useMemo(() => computeTable(wb, files, groupFilter, columns), [wb, files, groupFilter, scaleVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  const needsParam = isParamStat(stat)
  const chosenParam = param && params.includes(param) ? param : (params[0] ?? '')

  const add = (): void => {
    const col: TableColumn = { id: columnId(), path: JSON.parse(pathKey) as string[], stat }
    if (needsParam) col.param = chosenParam
    if (stat === 'pctile') col.pct = pct
    setTableColumns([...columns, col])
  }
  const addAllParents = (): void => {
    const have = new Set(columns.filter((c) => c.stat === 'freqParent').map((c) => JSON.stringify(c.path)))
    const more = paths.filter((p) => p.length > 0 && !have.has(JSON.stringify(p))).map((p): TableColumn => ({ id: columnId(), path: p, stat: 'freqParent' }))
    setTableColumns([...columns, ...more])
  }

  if (wb.samples.length === 0) {
    return (
      <div className="empty-state">
        <h2>Tables</h2>
        <p>Add samples first (File &gt; Add FCS files). Then choose the populations and statistics you want as columns.</p>
      </div>
    )
  }

  return (
    <div className="table-view">
      <form className="comp-bar" aria-label="Add a column" onSubmit={(e) => { e.preventDefault(); add() }}>
        <label className="axis-control"><span className="axis-label">Population</span>
          <select aria-label="Population" value={pathKey} onChange={(e) => setPathKey(e.target.value)}>
            {paths.map((p) => <option key={JSON.stringify(p)} value={JSON.stringify(p)}>{pathLabel(p)}</option>)}
          </select>
        </label>
        <label className="axis-control"><span className="axis-label">Statistic</span>
          <select aria-label="Statistic" value={stat} onChange={(e) => setStat(e.target.value as StatKind)}>
            {(Object.keys(STAT_LABELS) as StatKind[]).map((k) => <option key={k} value={k}>{STAT_LABELS[k]}</option>)}
          </select>
        </label>
        {needsParam && (
          <label className="axis-control"><span className="axis-label">Parameter</span>
            <select aria-label="Parameter" value={chosenParam} onChange={(e) => setParam(e.target.value)}>
              {params.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
        {stat === 'pctile' && (
          <label className="axis-control"><span className="axis-label">Percentile</span>
            <input type="number" aria-label="Percentile" min={0} max={100} step={1} value={pct} onChange={(e) => setPct(Math.min(100, Math.max(0, Number(e.target.value) || 0)))} />
          </label>
        )}
        <button type="submit" className="btn primary" disabled={needsParam && !chosenParam}><Plus size={14} /> Add column</button>
        <button type="button" className="btn" onClick={addAllParents} disabled={paths.length < 2} title="One '% of parent' column for each gated population">Add % of parent for all populations</button>
        <span className="grow" />
        <button type="button" className="btn" onClick={() => setTableColumns([])} disabled={columns.length === 0}>Clear columns</button>
        <button type="button" className="btn" onClick={() => void exportTable()} disabled={columns.length === 0}><Download size={14} /> Export CSV</button>
      </form>
      {columns.length === 0 ? (
        <div className="empty-state">
          <h2>No columns yet</h2>
          <p>Pick a population and a statistic above and press Add column. Each row is a sample of the group you have selected on the left.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table" aria-label="Statistics table">
            <thead>
              <tr>
                <th scope="col">Sample</th>
                <th scope="col">Group</th>
                {columns.map((c) => (
                  <th key={c.id} scope="col" className="r">
                    <span>{columnLabel(c)}</span>
                    <button type="button" className="icon-link" aria-label={`Remove column ${columnLabel(c)}`} title="Remove column" onClick={() => setTableColumns(columns.filter((x) => x.id !== c.id))}><Trash2 size={12} /></button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sampleId} className={r.sampleId === sampleId ? 'current' : ''}>
                  <th scope="row"><button type="button" className="link-btn" onClick={() => selectSample(r.sampleId)}>{r.name}</button></th>
                  <td className="muted">{r.group}</td>
                  {r.values.map((v, i) => <td key={columns[i].id} className="r num">{formatStat(columns[i].stat, v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
