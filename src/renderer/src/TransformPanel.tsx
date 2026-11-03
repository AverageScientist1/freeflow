import { useState } from 'react'
import { X } from 'lucide-react'
import { defaultSpec, type TransformSpec } from '@core/transform'
import { useStore } from './store'
import { defaultSpecFor } from '@core/workbench'
import { useSampleData } from './hooks'

type Kind = TransformSpec['type']
const KINDS: { id: Kind; label: string }[] = [
  { id: 'linear', label: 'Linear' },
  { id: 'log', label: 'Log' },
  { id: 'biex', label: 'Biexponential' },
  { id: 'arcsinh', label: 'Arcsinh' },
]

function convert(spec: TransformSpec, kind: Kind, range: number): TransformSpec {
  if (spec.type === kind) return spec
  const max = 'max' in spec ? spec.max : range
  switch (kind) {
    case 'linear': return { type: 'linear', min: 0, max }
    case 'log': return { type: 'log', min: 1, max }
    case 'arcsinh': return { type: 'arcsinh', min: -1000, max, cofactor: 150 }
    case 'biex': return { type: 'biex', max, positiveDecades: 4.5, widthDecades: 0.5, extraNegativeDecades: 0 }
  }
}

function validate(spec: TransformSpec): string | null {
  const nums = Object.values(spec).filter((v): v is number => typeof v === 'number')
  if (nums.some((n) => !Number.isFinite(n))) return 'Every field needs a number.'
  if (spec.type === 'linear' && spec.min >= spec.max) return 'Minimum must be below maximum.'
  if (spec.type === 'log') {
    if (spec.min <= 0) return 'Log minimum must be above zero.'
    if (spec.min >= spec.max) return 'Minimum must be below maximum.'
  }
  if (spec.type === 'arcsinh') {
    if (spec.cofactor <= 0) return 'Cofactor must be above zero.'
    if (spec.min >= spec.max) return 'Minimum must be below maximum.'
  }
  if (spec.type === 'biex') {
    if (spec.max <= 0) return 'Maximum must be above zero.'
    if (spec.positiveDecades < 1 || spec.positiveDecades > 8) return 'Positive decades must be between 1 and 8.'
    if (spec.extraNegativeDecades < 0 || spec.extraNegativeDecades > 3) return 'Extra negative decades must be between 0 and 3.'
    if (spec.widthDecades < 0 || spec.widthDecades > spec.positiveDecades / 2) return `Width must be between 0 and ${spec.positiveDecades / 2}.`
  }
  return null
}

function NumberField({ label, value, onChange, step = 'any', min, max }: { label: string; value: number; onChange: (v: number) => void; step?: string; min?: number; max?: number }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={Number.isFinite(value) ? value : ''} step={step} min={min} max={max} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
    </label>
  )
}

function SliderField({ label, value, onChange, min, max, step }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number }) {
  return (
    <div className="field">
      <span id={`sl-${label}`}>{label}</span>
      <div className="slider-row">
        <input type="range" aria-labelledby={`sl-${label}`} value={Number.isFinite(value) ? value : min} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />
        <input type="number" aria-label={`${label} value`} value={Number.isFinite(value) ? value : ''} min={min} max={max} step={step} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} />
      </div>
    </div>
  )
}

function Editor({ param, initial, fallback, range, onClose }: { param: string; initial: TransformSpec; fallback: TransformSpec; range: number; onClose: () => void }) {
  const setTransform = useStore((s) => s.setTransform)
  const [draft, setDraft] = useState<TransformSpec>(initial)
  const error = validate(draft)
  const set = <K extends string>(k: K, v: number): void => setDraft({ ...draft, [k]: v } as TransformSpec)
  return (
    <div className="side-panel">
      <header className="panel-head"><span>Axis scale: {param}</span>
        <button type="button" className="btn icon" onClick={onClose} aria-label="Close the scale panel"><X size={14} /></button>
      </header>
      <div className="pad stack">
        <p className="muted">Choose how values are spread along the axis, then press Apply. Gates stay on their data values, so they keep the same events when the scale changes.</p>
        <fieldset className="radios">
          <legend>Scale type</legend>
          {KINDS.map((k) => (
            <label key={k.id}><input type="radio" name="scale" checked={draft.type === k.id} onChange={() => setDraft(convert(draft, k.id, range))} /> {k.label}</label>
          ))}
        </fieldset>
        {(draft.type === 'linear' || draft.type === 'log' || draft.type === 'arcsinh') && (
          <>
            <NumberField label="Minimum" value={draft.min} onChange={(v) => set('min', v)} />
            <NumberField label="Maximum" value={draft.max} onChange={(v) => set('max', v)} />
          </>
        )}
        {draft.type === 'arcsinh' && <NumberField label="Cofactor" value={draft.cofactor} onChange={(v) => set('cofactor', v)} />}
        {draft.type === 'biex' && (
          <>
            <NumberField label="Maximum" value={draft.max} onChange={(v) => set('max', v)} />
            <SliderField label="Positive decades" value={draft.positiveDecades} min={1} max={8} step={0.1} onChange={(v) => set('positiveDecades', v)} />
            <SliderField label="Width (decades)" value={draft.widthDecades} min={0} max={Math.max(0, draft.positiveDecades / 2)} step={0.05} onChange={(v) => set('widthDecades', v)} />
            <SliderField label="Extra negative decades" value={draft.extraNegativeDecades} min={0} max={3} step={0.1} onChange={(v) => set('extraNegativeDecades', v)} />
          </>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="row">
          <button type="button" className="btn primary" disabled={!!error} onClick={() => setTransform(param, draft)}>Apply</button>
          <button type="button" className="btn" onClick={() => { setTransform(param, null); setDraft(fallback) }}>Reset</button>
        </div>
      </div>
    </div>
  )
}

export function TransformPanel({ axis }: { axis: 'x' | 'y' }) {
  const { wb, file } = useSampleData()
  const param = useStore((s) => (axis === 'x' ? s.xParam : s.yParam))
  const openTransform = useStore((s) => s.openTransform)
  const range = file?.parameters.find((p) => p.name === param)?.range ?? 262144
  const fallback = file ? defaultSpecFor(file, param) : defaultSpec(param, range)
  const initial = wb.transforms[param] ?? fallback
  return <Editor key={`${axis}:${param}`} param={param} initial={initial} fallback={fallback} range={range} onClose={() => openTransform(null)} />
}
