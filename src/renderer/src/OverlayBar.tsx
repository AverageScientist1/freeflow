import { useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { groupSubtree, groupTree, namePath, samplesInGroup } from '@core/groups'
import { itemsForSamples, overlayLabel } from '@core/overlay'
import { populationPaths, pathLabel } from '@core/table'
import { DEFAULT_GROUP, DEFAULT_GROUP_NAME, populationsFor } from '@core/workbench'
import { useStore } from './store'
import { CHART_PALETTE } from './chartDraw'

export const overlayColor = (i: number): string => CHART_PALETTE[i % CHART_PALETTE.length]

// The panel under the plot bar where overlays are chosen. The top-level groups are the tabs. When the chosen group has subgroups, a
// selector for them sits beside the population selector. Below, the samples of what is chosen are buttons: pressing one draws the chosen
// population of it over the open plot (its colour shows on the button), pressing it again takes it off.
export function OverlayBar({ notes, oneD }: { notes: Record<string, string>; oneD: boolean }) {
  const wb = useStore((s) => s.wb)
  const sampleId = useStore((s) => s.sampleId)
  const popId = useStore((s) => s.popId)
  const overlays = useStore((s) => s.overlays)
  const normalize = useStore((s) => s.overlayNormalize)
  const smooth = useStore((s) => s.overlaySmooth)
  const addOverlays = useStore((s) => s.addOverlays)
  const removeOverlay = useStore((s) => s.removeOverlay)
  const setOptions = useStore((s) => s.setOverlayOptions)
  const [tabPick, setTabPick] = useState<string>(DEFAULT_GROUP)
  const [subPick, setSubPick] = useState<string>('')
  const [pickPath, setPickPath] = useState<string | null>(null)

  const tabs = useMemo(() => [{ id: DEFAULT_GROUP, label: DEFAULT_GROUP_NAME }, ...groupTree(wb).filter((g) => g.depth === 0).map((g) => ({ id: g.id, label: g.name }))], [wb.groups]) // eslint-disable-line react-hooks/exhaustive-deps
  const tab = tabs.some((t) => t.id === tabPick) ? tabPick : DEFAULT_GROUP

  // the subgroups of the tab, indented by how far below it they sit
  const subs = useMemo(() => {
    if (tab === DEFAULT_GROUP) return []
    const inside = new Set(groupSubtree(wb, tab))
    const baseDepth = groupTree(wb).find((g) => g.id === tab)?.depth ?? 0
    return groupTree(wb).filter((g) => inside.has(g.id) && g.id !== tab).map((g) => ({ id: g.id, name: g.name, depth: g.depth - baseDepth - 1 }))
  }, [wb.groups, tab]) // eslint-disable-line react-hooks/exhaustive-deps
  const sub = subs.some((s) => s.id === subPick) ? subPick : ''
  const scope = sub || tab // the group whose samples are listed
  const members = samplesInGroup(wb, scope)

  const paths = useMemo(() => populationPaths(wb, members.map((m) => m.id)), [wb.populations, wb.samples, wb.groupOf, wb.groups, scope]) // eslint-disable-line react-hooks/exhaustive-deps
  const currentPath = sampleId ? JSON.stringify(namePath(populationsFor(wb, sampleId), popId)) : '[]'
  // the population drawn: the one chosen here, else the one that is open in the plot (when the group has it), else all events
  const chosen = pickPath && paths.some((p) => JSON.stringify(p) === pickPath) ? pickPath : (paths.some((p) => JSON.stringify(p) === currentPath) ? currentPath : '[]')
  const chosenPath = JSON.parse(chosen) as string[]
  const find = (sid: string) => overlays.find((o) => o.sampleId === sid && JSON.stringify(o.path) === chosen)

  const toggle = (sid: string): void => {
    const existing = find(sid)
    if (existing) removeOverlay(existing.id)
    else addOverlays([{ id: crypto.randomUUID(), sampleId: sid, path: chosenPath }])
  }
  const addGroup = (): void => addOverlays(itemsForSamples(wb, members.map((m) => m.id).filter((id) => id !== sampleId), chosenPath, () => crypto.randomUUID()))
  const scopeName = sub ? (subs.find((s) => s.id === sub)?.name ?? '') : (tabs.find((t) => t.id === tab)?.label ?? '')

  return (
    <div className="overlay-bar" role="group" aria-label="Overlays">
      <div className="overlay-head">
        <div className="overlay-tabs" role="tablist" aria-label="Group to overlay from">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" id={`ovtab-${t.id}`} aria-selected={t.id === tab} aria-controls="ovpanel" tabIndex={t.id === tab ? 0 : -1}
              className={`overlay-tab ${t.id === tab ? 'active' : ''}`} onClick={() => { setTabPick(t.id); setSubPick('') }}
              onKeyDown={(e) => {
                const i = tabs.findIndex((x) => x.id === t.id)
                const go = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1
                if (go >= 0 && go < tabs.length) { e.preventDefault(); setTabPick(tabs[go].id); setSubPick(''); requestAnimationFrame(() => document.getElementById(`ovtab-${tabs[go].id}`)?.focus()) }
              }}>
              {t.label}
            </button>
          ))}
        </div>
        {overlays.length > 0 && (
          <button type="button" className="overlay-clear" onClick={() => overlays.forEach((o) => removeOverlay(o.id))}>Remove all ({overlays.length})</button>
        )}
      </div>
      <div className="overlay-panel" id="ovpanel" role="tabpanel" aria-labelledby={`ovtab-${tab}`}>
        <div className="overlay-controls">
          {subs.length > 0 && (
            <label className="overlay-field"><span>Subgroup</span>
              <select aria-label="Subgroup" value={sub} onChange={(e) => setSubPick(e.target.value)}>
                <option value="">All of {tabs.find((t) => t.id === tab)?.label} ({samplesInGroup(wb, tab).length})</option>
                {subs.map((s) => <option key={s.id} value={s.id}>{'  '.repeat(s.depth)}{s.name} ({samplesInGroup(wb, s.id).length})</option>)}
              </select>
            </label>
          )}
          <label className="overlay-field"><span>Population</span>
            <select aria-label="Overlay population" value={chosen} onChange={(e) => setPickPath(e.target.value)}>
              {paths.map((p) => <option key={JSON.stringify(p)} value={JSON.stringify(p)}>{pathLabel(p)}</option>)}
            </select>
          </label>
          <button type="button" className="btn small-text" onClick={addGroup} disabled={members.filter((m) => m.id !== sampleId).length === 0} title="All the other samples listed below, with the population chosen">Overlay all</button>
          {oneD && overlays.length > 0 && (
            <>
              <label className="overlay-check"><input type="checkbox" checked={normalize} onChange={(e) => setOptions(e.target.checked, smooth)} /> Normalize to mode</label>
              <label className="overlay-field"><span>Smooth</span>
                <select aria-label="Smooth" value={smooth} onChange={(e) => setOptions(normalize, Number(e.target.value))}>
                  <option value={0}>None</option>
                  <option value={2}>Low</option>
                  <option value={6}>High</option>
                </select>
              </label>
            </>
          )}
        </div>
        <ul className="overlay-samples" aria-label={`Samples of ${scopeName}`}>
          {members.length === 0 && <li className="muted">No samples in this group.</li>}
          {members.map((m) => {
            const o = find(m.id)
            const idx = o ? overlays.findIndex((x) => x.id === o.id) : -1
            return (
              <li key={m.id}>
                <button type="button" className={`ov-pill ${o ? 'on' : ''}`} aria-pressed={!!o} onClick={() => toggle(m.id)}
                  title={m.id === sampleId ? 'The open sample (another population of it can be overlaid)' : 'Draw this sample over the plot'}>
                  <span className="ov-dot" aria-hidden="true" style={o ? { background: overlayColor(idx) } : undefined} />
                  {m.name}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      {overlays.length > 0 && (
        <ul className="overlay-chips" aria-label="Active overlays">
          {overlays.map((o, i) => (
            <li key={o.id} className="chip" title={notes[o.id] ? `Not drawn: ${notes[o.id]}` : undefined}>
              <span className="swatch" style={{ background: overlayColor(i) }} />
              <span className={notes[o.id] ? 'muted' : ''}>{overlayLabel(wb, o)}{notes[o.id] ? ' (not drawn)' : ''}</span>
              <button type="button" className="icon-link" aria-label={`Remove overlay ${overlayLabel(wb, o)}`} onClick={() => removeOverlay(o.id)}><X size={12} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
