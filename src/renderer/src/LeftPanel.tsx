import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Copy, CornerDownRight, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { DEFAULT_GROUP, DEFAULT_GROUP_NAME, ROOT_ID, type BoolOp, type Population } from '@core/workbench'
import { groupIdOf, groupPathName, groupTreeLines, peersOf, samplesInGroup } from '@core/groups'
import type { SortDir, SortKey } from '@core/sort'
import { markedSamples, useStore } from './store'
import { useSampleData } from './hooks'
import { LIMITS, useLayout } from './layout'
import { Splitter } from './Splitter'
import { isDeleteKey } from './platform'
import { openMenuFor, useContextMenu } from './ContextMenu'
import { applyMenu, groupMenu, populationMenu, sampleMenu, samplesBackgroundMenu } from './menus'

// The title of a section, which also folds it away and brings it back.
export function SectionToggle({ id, title }: { id: string; title: string }) {
  const closed = useLayout((s) => !!s.closed[id])
  const toggle = useLayout((s) => s.toggleSection)
  return (
    <button type="button" className="section-toggle" aria-expanded={!closed} aria-label={closed ? `Show ${title}` : `Fold ${title}`} onClick={() => toggle(id)} title={closed ? `Show ${title}` : `Fold ${title}`}>
      {closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<span>{title}</span>
    </button>
  )
}

// A block of the details panel that can be folded to its title.
export function Fold({ id, title, label, children }: { id: string; title: string; label?: string; children: React.ReactNode }) {
  const closed = useLayout((s) => !!s.closed[id])
  return (
    <section className="fold" aria-label={label ?? title}>
      <header className="fold-head"><SectionToggle id={id} title={title} /></header>
      {!closed && <div className="fold-body stack">{children}</div>}
    </section>
  )
}

// A section of the left panel with a height of its own (the last one takes what is left).
function Box({ id, last = false, children }: { id: string; last?: boolean; children: React.ReactNode }) {
  const h = useLayout((s) => s.boxH[id])
  const closed = useLayout((s) => !!s.closed[id])
  const style = last ? { flex: '1 1 0' } : { flex: `0 0 ${h}px` }
  return <div className={`lp-box ${closed ? 'closed' : ''}`} style={closed ? undefined : style} data-box={id}>{children}</div>
}

function BoxSplitter({ id, label }: { id: string; label: string }) {
  const h = useLayout((s) => s.boxH[id])
  const set = useLayout((s) => s.setBoxH)
  return <Splitter orientation="horizontal" label={label} value={h} min={LIMITS.box[0]} max={LIMITS.box[1]} onChange={(v) => set(id, v)} />
}

function InlineName({ value, label, onDone }: { value: string; label: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.select() }, [])
  return (
    <input ref={ref} className="inline-edit" defaultValue={value} aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onDone(e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') onDone(null) }} />
  )
}

const DRAG_SAMPLES = 'application/x-freeflow-samples'
const DRAG_GROUP = 'application/x-freeflow-group'

function GroupList() {
  const wb = useStore((s) => s.wb)
  const filter = useStore((s) => s.groupFilter)
  const selectGroup = useStore((s) => s.selectGroup)
  const addGroup = useStore((s) => s.addGroup)
  const renameGroup = useStore((s) => s.renameGroup)
  const deleteGroup = useStore((s) => s.deleteGroup)
  const moveGroup = useStore((s) => s.moveGroup)
  const moveSamples = useStore((s) => s.moveSamples)
  const [editing, setEditing] = useState<string | 'new' | 'sub' | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const lines = groupTreeLines(wb)
  const hiddenBy = (l: { parent: string | null }): boolean => { let p = l.parent; while (p) { if (folded.has(p)) return true; p = lines.find((x) => x.id === p)?.parent ?? null } return false }
  const toggleFold = (id: string): void => setFolded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const rows = [{ id: DEFAULT_GROUP, name: DEFAULT_GROUP_NAME, depth: 0, isLast: true, guides: [] as boolean[], hasChildren: false, parent: null as string | null }, ...lines.filter((l) => !hiddenBy(l))]
  const groupEdit = { rename: (id: string) => setEditing(id), newGroup: () => setEditing('new'), newSubgroup: (id: string) => { selectGroup(id); setEditing('sub') } }
  const accepts = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(DRAG_SAMPLES) || e.dataTransfer.types.includes(DRAG_GROUP)
  const drop = (e: React.DragEvent, target: string): void => {
    e.preventDefault()
    setOver(null)
    const samples = e.dataTransfer.getData(DRAG_SAMPLES)
    const group = e.dataTransfer.getData(DRAG_GROUP)
    if (samples) moveSamples(JSON.parse(samples) as string[], target)
    else if (group) moveGroup(group, target === DEFAULT_GROUP ? null : target)
  }
  return (
    <section className="panel-section" aria-label="Groups">
      <header className="panel-head">
        <SectionToggle id="groups" title="Groups" />
        <span className="head-actions">
          <button type="button" className="btn icon small" onClick={() => setEditing('new')} aria-label="New group" title="New group"><Plus size={14} /></button>
          <button type="button" className="btn icon small" disabled={filter === DEFAULT_GROUP} onClick={() => setEditing('sub')} aria-label="New subgroup" title="New subgroup inside the selected group: it gets gates of its own"><CornerDownRight size={14} /></button>
          <button type="button" className="btn icon small" disabled={filter === DEFAULT_GROUP} onClick={() => deleteGroup(filter)} aria-label="Delete group" title="Delete group (its samples and subgroups move up one level)"><Trash2 size={14} /></button>
        </span>
      </header>
      <div className="rows short" role="listbox" aria-label="Groups">
        {rows.map((g) => (
          <div key={g.id} role="option" aria-selected={g.id === filter} data-depth={g.depth} tabIndex={0}
            className={`row-item group-row ${g.id === filter ? 'selected' : ''} ${over === g.id ? 'drop-target' : ''} ${g.depth > 0 ? 'is-sub' : ''}`}
            draggable={g.id !== DEFAULT_GROUP}
            onDragStart={(e) => { e.dataTransfer.setData(DRAG_GROUP, g.id); e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(e) => { if (accepts(e)) { e.preventDefault(); setOver(g.id) } }}
            onDragLeave={() => setOver((o) => (o === g.id ? null : o))}
            onDrop={(e) => drop(e, g.id)}
            onContextMenu={(e) => { selectGroup(g.id); openMenuFor(e, groupMenu(g.id, groupEdit), 'Group menu') }}
            onClick={() => selectGroup(g.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectGroup(g.id); else if (e.key === 'F2' && g.id !== DEFAULT_GROUP) setEditing(g.id); else if (e.key === 'ArrowLeft' && g.hasChildren && !folded.has(g.id)) toggleFold(g.id); else if (e.key === 'ArrowRight' && g.hasChildren && folded.has(g.id)) toggleFold(g.id); else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { selectGroup(g.id); openMenuFor(e, groupMenu(g.id, groupEdit), 'Group menu') } }}
            onDoubleClick={() => g.id !== DEFAULT_GROUP && setEditing(g.id)}>
            {g.depth > 0 && <span className="tree-guides" aria-hidden="true">{g.guides.map((on, k) => <span key={k} className={`g ${on ? 'line' : ''}`} />)}<span className={`g elbow ${g.isLast ? 'last' : ''}`} /></span>}
            {g.id !== DEFAULT_GROUP && <span className={`fold-toggle ${g.hasChildren ? '' : 'none'}`} aria-hidden="true" onClick={(e) => { e.stopPropagation(); if (g.hasChildren) toggleFold(g.id) }}>{g.hasChildren ? (folded.has(g.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />) : null}</span>}
            {editing === g.id
              ? <InlineName value={g.name} label="Group name" onDone={(v) => { if (v !== null) renameGroup(g.id, v); setEditing(null) }} />
              : <span className="grow ellipsis" title={g.name}>{g.name}</span>}
            <span className="num muted">{samplesInGroup(wb, g.id).length}</span>
          </div>
        ))}
      </div>
      {editing === 'new' && (
        <div className="row-item"><InlineName value="" label="New group name" onDone={(v) => { if (v !== null && v.trim()) addGroup(v); setEditing(null) }} /></div>
      )}
      {editing === 'sub' && (
        <div className="row-item"><InlineName value="" label="New subgroup name" onDone={(v) => { if (v !== null && v.trim()) addGroup(v, filter); setEditing(null) }} /></div>
      )}
    </section>
  )
}
function SampleList() {
  const wb = useStore((s) => s.wb)
  const files = useStore((s) => s.files)
  const missing = useStore((s) => s.missing)
  const sampleId = useStore((s) => s.sampleId)
  const filter = useStore((s) => s.groupFilter)
  const selectSample = useStore((s) => s.selectSample)
  const selectRelative = useStore((s) => s.selectRelative)
  const selection = useStore((s) => s.selection)
  const toggleSelect = useStore((s) => s.toggleSelect)
  const selectRange = useStore((s) => s.selectRange)
  const removeMarked = useStore((s) => s.removeMarked)
  const inGroupView = filter !== DEFAULT_GROUP
  const sortSamples = useStore((s) => s.sortSamples)
  const reorderSamples = useStore((s) => s.reorderSamples)
  const nudgeSamples = useStore((s) => s.nudgeSamples)
  const renameSample = useStore((s) => s.renameSample)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dropBefore, setDropBefore] = useState<string | null>(null)
  const keywords = useMemo(() => {
    const seen = new Set<string>()
    for (const f of Object.values(files)) for (const k of Object.keys(f.keywords)) if (!/^(\$BEGIN|\$END|\$NEXTDATA|\$BYTEORD|\$DATATYPE|\$MODE|\$PAR|\$TOT|\$P\d|\$SPILL|\$COMP|FCSversion|\$TIMESTEP|\$FIL|\$DATE|\$BTIM|\$ETIM)/i.test(k)) seen.add(k)
    return [...seen].sort()
  }, [files])
  const shown = samplesInGroup(wb, filter)
  const marked = new Set(markedSamples({ selection, sampleId, wb }))
  // Up and Down (and Home and End) move through the list and keep the keyboard focus on the sample that is now selected
  const move = (e: React.KeyboardEvent, delta: number | 'first' | 'last'): void => {
    e.preventDefault()
    const list = e.currentTarget.parentElement
    if (delta === 'first' || delta === 'last') { const t = shown[delta === 'first' ? 0 : shown.length - 1]; if (t) selectSample(t.id) } else selectRelative(delta)
    requestAnimationFrame(() => list?.querySelector<HTMLElement>('[aria-selected=true]')?.focus())
  }
  return (
    <section className="panel-section" aria-label="Samples">
      <header className="panel-head"><SectionToggle id="samples" title="Samples" />
        <span className="head-actions">
          <select className="sort-select" aria-label="Sort samples" value="" onChange={(e) => { const [k, d] = e.target.value.split('|'); if (k) sortSamples(k as SortKey, d as SortDir); e.target.value = '' }} title="Put the samples in this order">
            <option value="">Sort…</option>
            <option value="natural|asc">Name, natural (S2 before S10)</option>
            <option value="name|asc">Name A to Z</option>
            <option value="name|desc">Name Z to A</option>
            <option value="events|desc">Most events first</option>
            <option value="events|asc">Fewest events first</option>
            <option value="date|asc">Oldest first</option>
            <option value="date|desc">Newest first</option>
            <option value="group|asc">By group</option>
            {keywords.length > 0 && <optgroup label="By keyword">{keywords.map((k) => <option key={k} value={`kw:${k}|asc`}>{k}</option>)}</optgroup>}
          </select>
          <span className="muted">{marked.size > 1 ? ` of ${shown.length}` : shown.length}</span>
          <button type="button" className="btn icon small" disabled={marked.size === 0} onClick={() => removeMarked()} aria-label={inGroupView ? (marked.size > 1 ? `Remove ${marked.size} samples from the group` : 'Remove sample from the group') : (marked.size > 1 ? `Remove ${marked.size} samples` : 'Remove sample')} title={inGroupView ? 'Take the marked samples out of this group (Delete): they go up to the group above and stay in the Workbench' : 'Remove the marked samples from the Workbench (Delete). The FCS files on disk are not touched.'}><Trash2 size={14} /></button>
        </span>
      </header>
      {shown.length === 0 && <p className="muted pad">{wb.samples.length === 0 ? 'No samples added.' : 'No samples in this group. Move one here from its details.'}</p>}
      <div className="rows" role="listbox" aria-label="Samples" onContextMenu={(e) => { if (e.target === e.currentTarget) openMenuFor(e, samplesBackgroundMenu(), 'List menu') }}>
        {shown.map((s) => {
          const f = files[s.id]
          return (
            <div key={s.id} role="option" aria-selected={marked.has(s.id)} aria-current={s.id === sampleId ? 'true' : undefined} tabIndex={0}
              className={`row-item ${marked.has(s.id) ? 'selected' : ''} ${dropBefore === s.id ? 'drop-before' : ''}`}
              draggable
              onContextMenu={(e) => { if (!marked.has(s.id)) selectSample(s.id); openMenuFor(e, sampleMenu(s.id, setRenaming), 'Sample menu') }}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_SAMPLES)) { e.preventDefault(); e.stopPropagation(); setDropBefore(s.id) } }}
              onDragLeave={() => setDropBefore((o) => (o === s.id ? null : o))}
              onDrop={(e) => { const raw = e.dataTransfer.getData(DRAG_SAMPLES); setDropBefore(null); if (raw) { e.preventDefault(); e.stopPropagation(); reorderSamples(JSON.parse(raw) as string[], s.id) } }}
              onDragEnd={() => setDropBefore(null)}
              onDragStart={(e) => { e.dataTransfer.setData(DRAG_SAMPLES, JSON.stringify(marked.has(s.id) ? [...marked] : [s.id])); e.dataTransfer.effectAllowed = 'move' }}
              onClick={(e) => { if (e.ctrlKey || e.metaKey) toggleSelect(s.id); else if (e.shiftKey) selectRange(s.id); else selectSample(s.id) }} onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') selectSample(s.id)
                else if (e.key === 'F2') { e.preventDefault(); setRenaming(s.id) }
                else if (isDeleteKey(e.key)) { e.preventDefault(); removeMarked() }
                else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { if (!marked.has(s.id)) selectSample(s.id); openMenuFor(e, sampleMenu(s.id, setRenaming), 'Sample menu') }
                else if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); nudgeSamples(e.key === 'ArrowDown' ? 1 : -1) }
                else if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault()
                  const list = e.currentTarget.parentElement
                  const i = shown.findIndex((x) => x.id === s.id) + (e.key === 'ArrowDown' ? 1 : -1)
                  if (shown[i]) { selectRange(shown[i].id); requestAnimationFrame(() => (list?.children[i] as HTMLElement | undefined)?.focus()) }
                }
                else if (e.key === 'ArrowDown') move(e, 1)
                else if (e.key === 'ArrowUp') move(e, -1)
                else if (e.key === 'Home') move(e, 'first')
                else if (e.key === 'End') move(e, 'last')
              }}>
              {renaming === s.id
                ? <InlineName value={s.name} label="Sample name" onDone={(v) => { if (v !== null) renameSample(s.id, v); setRenaming(null) }} />
                : <span className="grow ellipsis" title={`${s.name} (double-click or F2 to rename)`} onDoubleClick={() => setRenaming(s.id)}>{s.name}</span>}
              {groupIdOf(wb, s.id) !== filter && groupIdOf(wb, s.id) !== DEFAULT_GROUP && <span className="muted tag" title={`Group: ${groupPathName(wb, groupIdOf(wb, s.id))}`}><CornerDownRight size={10} aria-hidden="true" /> {groupPathName(wb, groupIdOf(wb, s.id))}</span>}
              {missing[s.id] ? <span title={missing[s.id]} className="warn"><AlertTriangle size={14} aria-label="File could not be loaded" /></span>
                : <span className="num muted">{f?.eventCount.toLocaleString()}</span>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

const BOOL_SYMBOL: Record<BoolOp, string> = { and: '∧', or: '∨', not: '¬' }

// How a boolean population is described: "FL1+ AND FL2+", "NOT FL1+".
function boolText(p: Population, pops: Population[]): string {
  if (!p.bool) return ''
  const names = p.bool.operands.map((o) => pops.find((q) => q.id === o)?.name ?? '?')
  return p.bool.op === 'not' ? `NOT ${names[0]}` : names.join(p.bool.op === 'and' ? ' AND ' : ' OR ')
}

function BooleanForm({ pops, onClose }: { pops: Population[]; onClose: () => void }) {
  const addBoolean = useStore((s) => s.addBoolean)
  const [op, setOp] = useState<BoolOp>('and')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const choices = pops.filter((p) => p.id !== ROOT_ID)
  const ok = op === 'not' ? picked.length === 1 : picked.length >= 2
  const toggle = (id: string): void => setPicked((c) => (op === 'not' ? [id] : c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  return (
    <form className="stack bool-form" aria-label="New boolean population" onSubmit={(e) => { e.preventDefault(); if (ok) { addBoolean(name, op, picked); onClose() } }}>
      <label className="field"><span>Name</span><input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={op === 'not' ? 'Not …' : 'Both …'} /></label>
      <label className="field"><span>Operation</span>
        <select aria-label="Operation" value={op} onChange={(e) => { setOp(e.target.value as BoolOp); setPicked([]) }}>
          <option value="and">AND: in all of the chosen populations</option>
          <option value="or">OR: in any of the chosen populations</option>
          <option value="not">NOT: outside the chosen population</option>
        </select>
      </label>
      <fieldset className="radios"><legend>{op === 'not' ? 'Population (one)' : 'Populations (two or more)'}</legend>
        <div className="bool-choices">
          {choices.length === 0 && <span className="muted">Draw some gates first.</span>}
          {choices.map((p) => <label key={p.id}><input type="checkbox" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} /> {p.name}</label>)}
        </div>
      </fieldset>
      <div className="row"><button type="submit" className="btn primary" disabled={!ok}>Create</button><button type="button" className="btn" onClick={onClose}>Cancel</button></div>
    </form>
  )
}

interface Node { pop: Population; depth: number }

function orderedTree(pops: Population[]): Node[] {
  const out: Node[] = []
  const walk = (id: string, depth: number): void => {
    const p = pops.find((q) => q.id === id)
    if (!p) return
    out.push({ pop: p, depth })
    for (const c of pops.filter((q) => q.parentId === id)) walk(c.id, depth + 1)
  }
  walk(ROOT_ID, 0)
  return out
}

function PopulationTree() {
  const { wb, stats, file, pops } = useSampleData()
  const sampleId = useStore((s) => s.sampleId)
  const popId = useStore((s) => s.popId)
  const selectPop = useStore((s) => s.selectPop)
  const renamePop = useStore((s) => s.renamePop)
  const deletePop = useStore((s) => s.deletePop)
  const applyToGroup = useStore((s) => s.applyToGroup)
  const setLinkGates = useStore((s) => s.setLinkGates)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [boolOpen, setBoolOpen] = useState(false)
  const gatePopId = useStore((s) => s.gatePopId)
  const wbSamples = wb.samples.length
  const hasPeers = sampleId ? peersOf(wb, sampleId).length > 0 : false
  const applicable = (gatePopId ?? popId) !== ROOT_ID

  const popEdit = { rename: (id: string) => setEditing(id), boolean: () => setBoolOpen(true) }
  const nodes = orderedTree(pops)
  const hidden = (n: Node): boolean => {
    let p = n.pop.parentId
    while (p) { if (collapsed.has(p)) return true; p = pops.find((q) => q.id === p)?.parentId ?? null }
    return false
  }
  const toggle = (id: string): void => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <section className="panel-section grow-section" aria-label="Populations">
      <header className="panel-head">
        <SectionToggle id="populations" title="Populations" />
        <span className="cols"><span>Count</span><span>% parent</span><span>% total</span></span>
      </header>
      <div className="rows" role="tree" aria-label="Populations">
        {nodes.filter((n) => !hidden(n)).map(({ pop, depth }) => {
          const st = stats.get(pop.id)
          const hasKids = pops.some((q) => q.parentId === pop.id)
          const pct = !file || !st ? '' : pop.id === ROOT_ID ? '100.0' : st.parentCount ? ((st.count / st.parentCount) * 100).toFixed(2) : '–'
          return (
            <div key={pop.id} role="treeitem" aria-selected={pop.id === popId} aria-level={depth + 1} tabIndex={0}
              className={`row-item ${pop.id === popId ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}
              onClick={() => selectPop(pop.id)}
              onContextMenu={(e) => { selectPop(pop.id); openMenuFor(e, populationMenu(pop.id, popEdit), 'Population menu') }}
              onDoubleClick={() => pop.id !== ROOT_ID && setEditing(pop.id)}
              onKeyDown={(e) => {
                if (e.key === 'F2' && pop.id !== ROOT_ID) setEditing(pop.id)
                else if (e.key === 'Enter') selectPop(pop.id)
                else if (isDeleteKey(e.key) && pop.id !== ROOT_ID) deletePop(pop.id)
                else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { selectPop(pop.id); openMenuFor(e, populationMenu(pop.id, popEdit), 'Population menu') }
              }}>
              <button type="button" className="expander" tabIndex={-1} aria-label={collapsed.has(pop.id) ? 'Expand' : 'Collapse'}
                style={{ visibility: hasKids ? 'visible' : 'hidden' }} onClick={(e) => { e.stopPropagation(); toggle(pop.id) }}>
                {collapsed.has(pop.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
              {editing === pop.id
                ? <InlineName value={pop.name} label="Population name" onDone={(v) => { if (v !== null) renamePop(pop.id, v); setEditing(null) }} />
                : <span className="grow ellipsis" title={pop.bool ? `: ${boolText(pop, pops)}` : pop.name}>{pop.bool && <span className="bool-mark" aria-hidden="true">{BOOL_SYMBOL[pop.bool.op]} </span>}{pop.name}</span>}
              <span className="num">{st && file ? st.count.toLocaleString() : ''}</span>
              <span className="num muted">{pct}</span>
              <span className="num muted">{st && file ? (file.eventCount ? ((st.count / file.eventCount) * 100).toFixed(2) : '–') : ''}</span>
            </div>
          )
        })}
      </div>
      {boolOpen && <BooleanForm pops={pops} onClose={() => setBoolOpen(false)} />}
      <footer className="panel-foot wrap-foot">
        <button type="button" className="btn" disabled={popId === ROOT_ID} onClick={() => deletePop(popId)}>
          <Trash2 size={14} /> Delete population
        </button>
        <button type="button" className="btn" disabled={!file || pops.length < 3} onClick={() => setBoolOpen(true)} title="Combine populations with AND, OR or NOT">Boolean…</button>
        <button type="button" className="btn" disabled={!file || wbSamples < 2} aria-haspopup="menu" title="Apply the selected gate, or the whole gating, to all samples, to a group or subgroup, or to the marked samples"
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); useContextMenu.getState().show(r.left, r.bottom + 2, applyMenu(gatePopId ?? popId), 'Apply menu') }}>
          <Copy size={14} /> Apply to… <ChevronDown size={12} />
        </button>
        <button type="button" className="btn" disabled={!applicable || !hasPeers} onClick={() => applyToGroup(false)}
          title="Copy the selected population and what is below it to the other samples of the group (Alt+G)">
          <Copy size={14} /> Apply to group
        </button>
        <button type="button" className="btn" disabled={!hasPeers} onClick={() => applyToGroup(true)}
          title="Replace the whole gating of the other samples of the group with this sample's (Alt+Shift+G)">
          <RefreshCw size={14} /> Resync all
        </button>
        <label className="check-line" title="When on, a gate drawn, moved, renamed or deleted in one sample is mirrored to the other samples of its group, so switching samples keeps the same thresholds">
          <input type="checkbox" checked={wb.linkGates} onChange={(e) => setLinkGates(e.target.checked)} /> Link gates in group
        </label>
      </footer>
    </section>
  )
}

export function LeftPanel({ open = true }: { open?: boolean }) {
  return (
    <aside className="left-panel" data-open={open} aria-hidden={!open}>
      <Box id="groups"><GroupList /></Box>
      <BoxSplitter id="groups" label="Resize the groups list" />
      <Box id="samples"><SampleList /></Box>
      <BoxSplitter id="samples" label="Resize the samples list" />
      <Box id="populations" last><PopulationTree /></Box>
    </aside>
  )
}

