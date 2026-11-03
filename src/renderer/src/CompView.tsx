import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { invert, isIdentity } from '@core/compensation'
import { useStore } from './store'
import { useSampleData } from './hooks'

// The parameters a spillover matrix usually covers: fluorescence, not scatter, time or widths.
const isFluorescence = (name: string): boolean => !/^(FSC|SSC|time|event)/i.test(name) && !/width$/i.test(name) && !/^Comp-/.test(name)

function Cell({ value, diagonal, label, onCommit }: { value: number; diagonal: boolean; label: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n)) { if (n !== value) onCommit(n) } else setText(String(value))
  }
  return (
    <input className={`matrix-cell ${diagonal ? 'diag' : ''}`} type="text" inputMode="decimal" aria-label={label} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') setText(String(value)) }} />
  )
}

function NewMatrix({ names, onClose }: { names: string[]; onClose: () => void }) {
  const addMatrix = useStore((s) => s.addMatrix)
  const [picked, setPicked] = useState<string[]>([])
  const [name, setName] = useState('')
  const toggle = (p: string): void => setPicked((c) => (c.includes(p) ? c.filter((x) => x !== p) : [...c, p]))
  return (
    <form className="stack panel-card" onSubmit={(e) => { e.preventDefault(); addMatrix(name || 'New matrix', names.filter((n) => picked.includes(n))); onClose() }}>
      <h3>New matrix</h3>
      <label className="field"><span>Name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="New matrix" /></label>
      <fieldset className="radios">
        <legend>Parameters (at least two)</legend>
        <div className="check-grid">
          {names.map((n) => <label key={n}><input type="checkbox" checked={picked.includes(n)} onChange={() => toggle(n)} /> {n}</label>)}
        </div>
      </fieldset>
      <div className="row">
        <button type="submit" className="btn primary" disabled={picked.length < 2}>Create</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
    </form>
  )
}

export function CompView() {
  const { wb, rawFile, matrix: appliedMatrix, compError } = useSampleData()
  const sampleId = useStore((s) => s.sampleId)
  const setMatrixValues = useStore((s) => s.setMatrixValues)
  const renameMatrix = useStore((s) => s.renameMatrix)
  const deleteMatrix = useStore((s) => s.deleteMatrix)
  const assignMatrix = useStore((s) => s.assignMatrix)
  const matrices = wb.compensation.matrices
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const matrix = matrices.find((m) => m.id === selectedId) ?? matrices.find((m) => m.id === appliedMatrix?.id) ?? matrices[0]

  const status = useMemo(() => {
    if (!matrix) return null
    const inv = invert(matrix.values)
    const missing = rawFile ? matrix.parameters.filter((p) => !rawFile.parameters.some((q) => q.name === p)) : []
    return { invertible: inv !== null, identity: isIdentity(matrix.values), missing }
  }, [matrix, rawFile])

  const usedBy = matrix ? wb.samples.filter((s) => wb.compensation.assignments[s.id] === matrix.id).map((s) => s.name) : []
  const appliedHere = !!matrix && !!sampleId && wb.compensation.assignments[sampleId] === matrix.id
  const candidates = rawFile ? rawFile.parameters.map((p) => p.name).filter(isFluorescence) : []

  if (matrices.length === 0 && !creating) {
    return (
      <div className="empty-state">
        <h2>No compensation matrix</h2>
        <p>A matrix is added automatically when a file carries a spillover matrix. You can also make one from the parameters of the selected sample.</p>
        <button type="button" className="btn primary" disabled={candidates.length < 2} onClick={() => setCreating(true)}><Plus size={14} /> New matrix</button>
        {candidates.length < 2 && <p className="muted">Select a sample with at least two fluorescence parameters to make a matrix.</p>}
      </div>
    )
  }

  return (
    <div className="comp-view">
      <div className="comp-bar">
        <label className="plot-type">
          <span className="axis-label">Matrix</span>
          <select aria-label="Matrix" value={matrix?.id ?? ''} onChange={(e) => setSelectedId(e.target.value)} disabled={!matrix}>
            {matrices.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <button type="button" className="btn" onClick={() => setCreating(true)} disabled={candidates.length < 2}><Plus size={14} /> New matrix</button>
        {matrix && <button type="button" className="btn" onClick={() => { deleteMatrix(matrix.id); setSelectedId(null) }}><Trash2 size={14} /> Delete matrix</button>}
      </div>

      {creating && <NewMatrix names={candidates} onClose={() => setCreating(false)} />}

      {matrix && status && (
        <div className="comp-body">
          <label className="field name-field">
            <span>Name</span>
            <input type="text" key={matrix.id + matrix.name} defaultValue={matrix.name} aria-label="Matrix name" onBlur={(e) => renameMatrix(matrix.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
          </label>

          <p className="muted">Each row is the signal of one detector, each column the detector that receives it. Values are fractions: 0.2 means 20% of the row detector&apos;s signal appears in the column detector. The diagonal is 1.</p>

          <div className="matrix-wrap">
            <table className="matrix" aria-label={`Spillover matrix ${matrix.name}`}>
              <thead>
                <tr><th scope="col"><span className="visually-hidden">Emitter</span></th>{matrix.parameters.map((p) => <th key={p} scope="col">{p}</th>)}</tr>
              </thead>
              <tbody>
                {matrix.values.map((row, i) => (
                  <tr key={matrix.parameters[i]}>
                    <th scope="row">{matrix.parameters[i]}</th>
                    {row.map((v, j) => (
                      <td key={matrix.parameters[j]}>
                        <Cell value={v} diagonal={i === j} label={`${matrix.parameters[i]} into ${matrix.parameters[j]}`}
                          onCommit={(n) => setMatrixValues(matrix.id, matrix.values.map((r, a) => r.map((x, b) => (a === i && b === j ? n : x))))} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="status-list">
            <li className={status.invertible ? '' : 'error-text'} role={status.invertible ? undefined : 'alert'}>{status.invertible ? 'The matrix can be inverted.' : 'This matrix cannot be inverted, so it cannot be applied.'}</li>
            {status.identity && <li className="muted">This is an identity matrix: it changes nothing.</li>}
            {status.missing.length > 0 && <li className="error-text">The selected sample has no parameter named {status.missing.join(', ')}.</li>}
            <li className="muted">{usedBy.length ? `Applied to: ${usedBy.join(', ')}` : 'Not applied to any sample.'}</li>
            {compError && appliedHere && <li className="error-text" role="alert">Not applied to the selected sample: {compError}</li>}
          </ul>

          <div className="row wrap">
            <button type="button" className="btn primary" disabled={!status.invertible || !sampleId || status.missing.length > 0 || appliedHere} onClick={() => assignMatrix(matrix.id, 'sample')}>Apply to this sample</button>
            <button type="button" className="btn" disabled={!status.invertible || wb.samples.length === 0} onClick={() => assignMatrix(matrix.id, 'all')}>Apply to all samples</button>
            <button type="button" className="btn" disabled={!appliedHere} onClick={() => assignMatrix(null, 'sample')}>Remove from this sample</button>
          </div>
          <p className="muted">Applied matrices add &ldquo;Comp-&rdquo; parameters to the sample. Pick them in the Graphs mode.</p>
        </div>
      )}
    </div>
  )
}
