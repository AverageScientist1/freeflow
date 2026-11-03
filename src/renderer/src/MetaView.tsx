import { useMemo, useState } from 'react'
import { DEFAULT_GROUP, DEFAULT_GROUP_NAME } from '@core/workbench'
import { groupIdOf } from '@core/groups'
import { useStore } from './store'

// Keywords every file has that say little to a person; shown only when asked for.
const NOISY = /^(\$BEGIN|\$END|\$NEXTDATA|\$BYTEORD|\$DATATYPE|\$MODE|\$PAR|\$P\d+[BERNSDFGLOPTV]|\$SPILLOVER|\$SPILL|\$COMP|\$FIL|FCSversion|\$TIMESTEP)/i

export function MetaView() {
  const wb = useStore((s) => s.wb)
  const files = useStore((s) => s.files)
  const missing = useStore((s) => s.missing)
  const sampleId = useStore((s) => s.sampleId)
  const selectSample = useStore((s) => s.selectSample)
  const moveSample = useStore((s) => s.moveSample)
  const [showAll, setShowAll] = useState(false)
  const [filter, setFilter] = useState('')

  const keys = useMemo(() => {
    const seen = new Set<string>()
    for (const s of wb.samples) for (const k of Object.keys(files[s.id]?.keywords ?? {})) if (showAll || !NOISY.test(k)) seen.add(k)
    return [...seen].sort((a, b) => a.localeCompare(b)).filter((k) => !filter.trim() || k.toLowerCase().includes(filter.trim().toLowerCase()))
  }, [wb.samples, files, showAll, filter])

  if (wb.samples.length === 0) {
    return (
      <div className="empty-state">
        <h2>Metadata Manager</h2>
        <p>Add samples first. This view lists the keywords stored in each file (date, cytometer, operator, tube name) and lets you assign samples to groups.</p>
      </div>
    )
  }
  return (
    <div className="table-view">
      <div className="comp-bar">
        <label className="axis-control"><span className="axis-label">Find keyword</span>
          <input type="text" aria-label="Find keyword" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="e.g. DATE" />
        </label>
        <label className="check-line" style={{ width: 'auto' }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show technical keywords</label>
        <span className="muted">{wb.samples.length} samples · {keys.length} keywords</span>
      </div>
      <div className="table-wrap">
        <table className="data-table" aria-label="Sample metadata">
          <thead>
            <tr>
              <th scope="col">Sample</th>
              <th scope="col">Group</th>
              <th scope="col" className="r">Events</th>
              <th scope="col" className="r">Parameters</th>
              {keys.map((k) => <th key={k} scope="col">{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {wb.samples.map((s) => {
              const f = files[s.id]
              return (
                <tr key={s.id} className={s.id === sampleId ? 'current' : ''}>
                  <th scope="row"><button type="button" className="link-btn" onClick={() => selectSample(s.id)}>{s.name}</button>{missing[s.id] && <span className="error-text"> (not loaded)</span>}</th>
                  <td>
                    <select aria-label={`Group of ${s.name}`} value={groupIdOf(wb, s.id)} onChange={(e) => moveSample(s.id, e.target.value)}>
                      <option value={DEFAULT_GROUP}>{DEFAULT_GROUP_NAME}</option>
                      {wb.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </td>
                  <td className="r num">{f ? f.eventCount.toLocaleString() : ''}</td>
                  <td className="r num">{f ? f.parameters.length : ''}</td>
                  {keys.map((k) => <td key={k} className="ellipsis" title={f?.keywords[k] ?? ''}>{f?.keywords[k] ?? ''}</td>)}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
