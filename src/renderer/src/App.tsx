import { useEffect, useRef, useState } from 'react'
import { getBridge } from './api'
import { BadgeCheck, ChartColumn, ChartScatter, FileText, Grid3x3, HelpCircle, Moon, Network, Redo2, Settings, Sun, Table2, Tags, Undo2 } from 'lucide-react'
import { useStore } from './store'
import { useGroupTable, useSampleData } from './hooks'
import { DEFAULT_GROUP, DEFAULT_GROUP_NAME } from '@core/workbench'
import { groupDepth, groupIdOf } from '@core/groups'
import { Fold, LeftPanel } from './LeftPanel'
import { PlotView } from './PlotView'
import { GalleryView } from './GalleryView'
import { SheetView } from './SheetView'
import { ClusterView } from './ClusterView'
import { Splitter } from './Splitter'
import { ContextMenuHost } from './ContextMenu'
import { LIMITS, useLayout } from './layout'
import { CompView } from './CompView'
import { TransformPanel } from './TransformPanel'
import { TablesView } from './TablesView'
import { ChartsView } from './ChartsView'
import { MetaView } from './MetaView'
import { QcView } from './QcView'
import { PrefsView } from './PrefsView'
import { ReportsView } from './ReportsView'
import type { Mode } from './store'

// On a Mac the shortcuts are written with its own keys: Command, Option and Shift.
import { IS_MAC } from './platform'
export const kb = (s: string): string => (IS_MAC ? s.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : s)

const MODES = [
  { id: 'meta', label: 'Metadata Manager', key: 'Alt+1', icon: Tags, ready: true, when: '' },
  { id: 'qc', label: 'Quality Control', key: 'Alt+2', icon: BadgeCheck, ready: true, when: '' },
  { id: 'compensation', label: 'Compensation', key: 'Alt+3', icon: Grid3x3, ready: true, when: '' },
  { id: 'graphs', label: 'Graphs', key: 'Alt+4', icon: ChartScatter, ready: true, when: '' },
  { id: 'cluster', label: 'Cluster Explorer', key: 'Alt+5', icon: Network, ready: true, when: '' },
  { id: 'tables', label: 'Tables', key: 'Alt+6', icon: Table2, ready: true, when: '' },
  { id: 'charts', label: 'Charts', key: 'Alt+7', icon: ChartColumn, ready: true, when: '' },
  { id: 'reports', label: 'Reports', key: 'Alt+8', icon: FileText, ready: true, when: '' },
  { id: 'prefs', label: 'Preferences', key: 'Alt+9', icon: Settings, ready: true, when: '' },
] as const

function MenuBar() {
  const s = useStore()
  const layout = useLayout()
  const [open, setOpen] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) setOpen(null) }
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(null) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc) }
  }, [])
  const item = (label: string, hint: string, run: () => void) => (
    <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(null); run() }}>
      <span>{label}</span><span className="hint">{kb(hint)}</span>
    </button>
  )
  return (
    <div className="menubar" role="menubar" ref={ref}>
      <div className="menu">
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === 'file'} className="menu-title" onClick={() => setOpen(open === 'file' ? null : 'file')}>File</button>
        {open === 'file' && (
          <div className="menu-pop" role="menu" aria-label="File">
            {item('New Workbench', 'Ctrl+N', s.newWorkbench)}
            {item('Open Workbench…', 'Ctrl+O', () => void s.openWorkbench())}
            {item('Save Workbench', 'Ctrl+S', () => void s.saveWorkbench(false))}
            {item('Save Workbench As…', 'Ctrl+Shift+S', () => void s.saveWorkbench(true))}
            <hr />
            {item('Export statistics (CSV)…', '', () => void s.exportStats())}
            {item('Export table (CSV)…', '', () => void s.exportTable())}
            {item('Export report (HTML)…', '', () => void s.exportReport())}
            {item('Export plot or chart image (PNG)…', '', () => void s.exportPlot())}
            <hr />
            {item('Add FCS files…', '', () => void s.pickFcs())}
            {item('Load demo sample', '', s.addDemo)}
          </div>
        )}
      </div>
      <div className="menu">
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === 'edit'} className="menu-title" onClick={() => setOpen(open === 'edit' ? null : 'edit')}>Edit</button>
        {open === 'edit' && (
          <div className="menu-pop" role="menu" aria-label="Edit">
            {item('Undo', 'Ctrl+Z', s.undo)}
            {item('Redo', 'Ctrl+Y', s.redo)}
          </div>
        )}
      </div>
      <div className="menu">
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === 'gating'} className="menu-title" onClick={() => setOpen(open === 'gating' ? null : 'gating')}>Gating</button>
        {open === 'gating' && (
          <div className="menu-pop" role="menu" aria-label="Gating">
            {item('Apply gate to group', 'Alt+G', () => s.applyToGroup(false))}
            {item('Apply gate to group and resync all', 'Alt+Shift+G', () => s.applyToGroup(true))}
            <hr />
            <button type="button" role="menuitemcheckbox" aria-checked={s.wb.linkGates} className="menu-item" onClick={() => { setOpen(null); s.setLinkGates(!s.wb.linkGates) }}>
              <span>{s.wb.linkGates ? '✓ ' : ' '}Link gates in group</span><span className="hint" />
            </button>
          </div>
        )}
      </div>
      <div className="menu">
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === 'view'} className="menu-title" onClick={() => setOpen(open === 'view' ? null : 'view')}>View</button>
        {open === 'view' && (
          <div className="menu-pop" role="menu" aria-label="View">
            {item(layout.leftOpen ? 'Hide the left panel' : 'Show the left panel', '', layout.toggleLeft)}
            {item(layout.rightOpen ? 'Hide the details panel' : 'Show the details panel', '', layout.toggleRight)}
            <hr />
            {item('Reset the layout', '', layout.reset)}
          </div>
        )}
      </div>
      <div className="menu">
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === 'help'} className="menu-title" onClick={() => setOpen(open === 'help' ? null : 'help')}>Help</button>
        {open === 'help' && (
          <div className="menu-pop" role="menu" aria-label="Help">
            {item('How gating works', '', () => s.setStatus({ kind: 'info', text: 'Pick a gate tool, draw on the plot, then double-click a population to look inside it and gate further.' }))}
          </div>
        )}
      </div>
    </div>
  )
}

function Header() {
  const wb = useStore((s) => s.wb)
  const dirty = useStore((s) => s.dirty)
  const canUndo = useStore((s) => s.history.past.length > 0)
  const canRedo = useStore((s) => s.history.future.length > 0)
  const undo = useStore((s) => s.undo)
  const redo = useStore((s) => s.redo)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const dark = theme === 'dark'
  const mode = useStore((s) => s.mode)
  return (
    <header className="header">
      <span className="brand">Freeflow</span>
      <h1 className="title">{MODES.find((m) => m.id === mode)?.label ?? 'Graphs'}</h1>
      <span className="wb-name">{wb.name}{dirty ? ' •' : ''}</span>
      <div className="history-buttons">
        <button type="button" className="hdr-btn" onClick={undo} disabled={!canUndo} aria-label="Undo" title={`Undo (${kb('Ctrl+Z')})`}><Undo2 size={16} /></button>
        <button type="button" className="hdr-btn" onClick={redo} disabled={!canRedo} aria-label="Redo" title={`Redo (${kb('Ctrl+Y')})`}><Redo2 size={16} /></button>
      </div>
      <span className="grow" />
      <button type="button" className="hdr-btn" onClick={() => setTheme(dark ? 'light' : 'dark')} aria-pressed={dark}
        aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
        {dark ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <span className="version">v{__APP_VERSION__}</span>
      <HelpCircle size={18} aria-label="Help" />
    </header>
  )
}

function ModeRail() {
  const mode = useStore((s) => s.mode)
  const setMode = useStore((s) => s.setMode)
  return (
    <nav className="rail" aria-label="Modes">
      {/* only the modes that work are shown; the others are kept in MODES for when they are built */}
      {MODES.filter((m) => m.ready).map(({ id, label, key, icon: Icon, ready, when }) => {
        const active = ready && id === mode
        return (
          <button key={id} type="button" className={`rail-btn ${active ? 'active' : ''}`} disabled={!ready} aria-current={active ? 'page' : undefined}
            aria-label={label} title={ready ? `${label} (${kb(key)})` : `${label} (${kb(key)}) — ${when}`}
            onClick={() => setMode(id as Mode)}>
            <Icon size={22} />
          </button>
        )
      })}
    </nav>
  )
}

function GroupTable() {
  const table = useGroupTable()
  const selectSample = useStore((s) => s.selectSample)
  const sampleId = useStore((s) => s.sampleId)
  if (!table) return null
  const label = table.path.length ? table.path.join(' / ') : 'All events'
  return (
    <Fold id="comparison" title="Group comparison" label={`${label} across ${table.groupName}`}>
      <h3>{label} in {table.groupName}</h3>
      <table className="mini">
        <thead><tr><th>Sample</th><th className="r">Count</th><th className="r">% parent</th></tr></thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.sampleId} className={r.sampleId === sampleId ? 'current' : ''}>
              <td><button type="button" className="link-btn" onClick={() => selectSample(r.sampleId)}>{r.name}</button></td>
              <td className="r num">{r.count === null ? '' : r.count.toLocaleString()}</td>
              <td className="r num">{r.pct === null ? <span className="muted">{r.note ?? '–'}</span> : r.pct.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Fold>
  )
}

function InfoPanel() {
  const { file, wb } = useSampleData()
  const sampleId = useStore((s) => s.sampleId)
  const name = useStore((s) => s.wb.samples.find((x) => x.id === sampleId)?.name)
  const moveSample = useStore((s) => s.moveSample)
  const selectGroup = useStore((s) => s.selectGroup)
  return (
    <div className="side-panel">
      <header className="panel-head"><span>Sample details</span></header>
      <div className="stack">
        {!file ? <p className="muted pad">Select a sample to see its details.</p> : (
          <>
            <Fold id="details" title="Sample">
              <p><strong>{name}</strong></p>
              <p className="muted">{file.eventCount.toLocaleString()} events · {file.parameters.length} parameters · {file.version}</p>
              {sampleId && (
                <label className="field">
                  <span>Group</span>
                  <select aria-label="Group" value={groupIdOf(wb, sampleId)} onChange={(e) => { moveSample(sampleId, e.target.value); selectGroup(e.target.value) }}>
                    <option value={DEFAULT_GROUP}>{DEFAULT_GROUP_NAME}</option>
                    {wb.groups.map((g) => <option key={g.id} value={g.id}>{'\u00a0\u00a0'.repeat(groupDepth(wb, g.id))}{g.name}</option>)}
                  </select>
                </label>
              )}
            </Fold>
            <GroupTable />
            <Fold id="parameters" title="Parameters">
              <table className="mini">
                <thead><tr><th>Parameter</th><th>Stain</th></tr></thead>
                <tbody>{file.parameters.map((p) => <tr key={p.index}><td>{p.name}</td><td className="muted">{p.stain}</td></tr>)}</tbody>
              </table>
              <p className="muted">Use the T button next to an axis to change how its values are scaled.</p>
            </Fold>
          </>
        )}
      </div>    </div>
  )
}

function StatusBar() {
  const status = useStore((s) => s.status)
  const busy = useStore((s) => s.busy)
  const setStatus = useStore((s) => s.setStatus)
  // Problems and warnings get a banner that stays until dismissed (see Notice); the bar only carries plain information.
  const info = status && status.kind === 'info' ? status : null
  return (
    <footer className="statusbar" role="status">
      {busy ? 'Working…' : info ? <span>{info.text}</span> : 'Ready'}
      {info && <button type="button" className="link" onClick={() => setStatus(null)}>Dismiss</button>}
    </footer>
  )
}

function Notice() {
  const status = useStore((s) => s.status)
  const setStatus = useStore((s) => s.setStatus)
  if (!status || status.kind === 'info') return null
  return (
    <div className={`notice ${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
      <span className="notice-text">{status.text}</span>
      <button type="button" className="btn small-text" onClick={() => setStatus(null)}>Dismiss</button>
    </div>
  )
}

export function App() {
  const transformAxis = useStore((s) => s.transformAxis)
  const mode = useStore((s) => s.mode)
  const gallery = useStore((s) => s.gallery)
  const layout = useLayout()
  const sheet = useStore((s) => s.sheet)
  const [dropping, setDropping] = useState(false)

  // Files given when the program starts or is launched again ("Open with", double-click in Windows)
  useEffect(() => {
    const b = getBridge()
    void b.initialPaths().then((p) => { if (p.length) void useStore.getState().openPaths(p) })
    return b.onOpenPaths((p) => void useStore.getState().openPaths(p))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyG') {
        e.preventDefault()
        useStore.getState().applyToGroup(e.shiftKey)
        return
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[1-9]$/.test(e.code) && MODES[Number(e.code.slice(5)) - 1]?.ready) {
        // keys by their position: on a Mac, Option+3 types a symbol, so the character would not be "3"
        e.preventDefault()
        useStore.getState().setMode(MODES[Number(e.code.slice(5)) - 1].id as Mode)
        return
      }
      // Page Down and Page Up move to the next and previous sample, wherever the focus is except in a field that uses those keys
      if ((e.key === 'PageDown' || e.key === 'PageUp') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target as HTMLElement | null
        if (!t || !(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) { e.preventDefault(); useStore.getState().selectRelative(e.key === 'PageDown' ? 1 : -1) }
        return
      }
      if (!(e.ctrlKey || e.metaKey)) return
      const s = useStore.getState()
      const k = e.key.toLowerCase()
      if (k === 's') { e.preventDefault(); void s.saveWorkbench(e.shiftKey) }
      else if (k === 'o') { e.preventDefault(); void s.openWorkbench() }
      else if (k === 'n') { e.preventDefault(); s.newWorkbench() }
      else if (k === 'z' || k === 'y') {
        // while typing in a field, Ctrl+Z belongs to the field
        const t = e.target as HTMLElement | null
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
        e.preventDefault()
        if (k === 'y' || e.shiftKey) s.redo()
        else s.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const hasFiles = (e: React.DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files')
  return (
    <div
      className="app"
      onDragEnter={(e) => { if (hasFiles(e)) { e.preventDefault(); setDropping(true) } }}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target || !e.relatedTarget) setDropping(false) }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setDropping(false)
        void useStore.getState().openDropped(Array.from(e.dataTransfer.files))
      }}
    >
      {dropping && <div className="drop-overlay" role="presentation"><span>Drop FCS files or a Freeflow Workbench to open</span></div>}
      <MenuBar />
      <Header />
      <div className="notice-slot"><Notice /></div>
      <div className="body" style={{ gridTemplateColumns: `var(--layout-mode-rail) ${layout.leftOpen ? layout.leftW : 0}px 8px minmax(300px, 1fr) 8px ${layout.rightOpen ? layout.rightW : 0}px` }}>
        <ModeRail />
        <LeftPanel open={layout.leftOpen} />
        <Splitter orientation="vertical" label="Resize the left panel" value={layout.leftW} min={LIMITS.left[0]} max={LIMITS.left[1]} open={layout.leftOpen} onChange={layout.setLeftW} onToggle={layout.toggleLeft} toggleLabel={layout.leftOpen ? 'Hide the left panel' : 'Show the left panel'} />
        <main className="center">{mode === 'compensation' ? <CompView /> : mode === 'tables' ? <TablesView /> : mode === 'charts' ? <ChartsView /> : mode === 'meta' ? <MetaView /> : mode === 'qc' ? <QcView /> : mode === 'cluster' ? <ClusterView /> : mode === 'reports' ? <ReportsView /> : mode === 'prefs' ? <PrefsView /> : gallery ? <GalleryView /> : sheet ? <SheetView /> : <PlotView />}</main>
        <Splitter orientation="vertical" invert label="Resize the details panel" value={layout.rightW} min={LIMITS.right[0]} max={LIMITS.right[1]} open={layout.rightOpen} onChange={layout.setRightW} onToggle={layout.toggleRight} toggleLabel={layout.rightOpen ? 'Hide the details panel' : 'Show the details panel'} />
        <aside className="right-panel" data-open={layout.rightOpen} aria-hidden={!layout.rightOpen}>{transformAxis && mode === 'graphs' ? <TransformPanel axis={transformAxis} /> : <InfoPanel />}</aside>
      </div>
      <StatusBar />
      <ContextMenuHost />
    </div>
  )
}

