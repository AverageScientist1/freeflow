import { create } from 'zustand'
import { parseFcs, type FcsFile } from '@core/fcs'
import { makeDemoFcs } from '@core/synth'
import type { Gate, GateGeometry, Quadrant } from '@core/gating'
import type { TransformSpec } from '@core/transform'
import { parseSpillover, type CompMatrix } from '@core/compensation'
import { emptyHistory, record, redo as redoStep, undo as undoStep, type History } from '@core/history'
import {
  DEFAULT_GROUP, descendants, emptyWorkbench, nextGateName, parseWorkbench, populationsFor, ROOT_ID, setDefaultScalePool, upgradeGatesToRealValues,
  type BoolOp, type SampleRef, type Workbench,
} from '@core/workbench'
import { adoptGroupGating, applyGateToGroup, findByPath, gatingDiffers, groupSubtree, linkedPeers, namePath, peersOf, samplesInGroup, syncLinked } from '@core/groups'
import { getBridge, type FileData } from './api'
import { csvOptionsFor, statsRows, toCsv } from '@core/export'
import { computeTable, tableToCsv } from '@core/table'
import type { TableColumn } from '@core/stats'
import type { ReportBlock } from '@core/reportTypes'
import type { OverlayItem } from '@core/overlay'
import { moveBefore, nudge, sortSamples as sortList, type SortDir, type SortKey } from '@core/sort'
import { clusterCsv, type ClusterInput, type ClusterSummary } from '@core/cluster'
import type { EmbedAlgo } from '@core/embed'
import type { SheetTile } from '@core/reportTypes'
import { buildReportHtml } from './reportBuild'
import { currentPlotPng } from './plotExport'
import { applyTheme, initialTheme, type Theme } from './theme'

export type Tool = 'select' | 'polygon' | 'rectangle' | 'ellipse' | 'range' | 'quadrant'
export type PlotType = 'pseudocolor' | 'contour' | 'zebra' | 'histogram'
export type Mode = 'meta' | 'qc' | 'compensation' | 'graphs' | 'cluster' | 'tables' | 'charts' | 'reports' | 'prefs'
export type CsvFormat = 'auto' | 'point' | 'comma'
export type DisplayMode = 'smooth' | 'raw' // smooth: density colours and smoothed curves; raw: every event as it is
export type ThumbSize = number // width of a thumbnail in pixels (zoom of the gallery and the sheet)
// The last Cluster Explorer run: kept while the program is open so the picture is still there after a visit to another mode.
export interface ClusterRun {
  algo: EmbedAlgo
  input: ClusterInput
  embedding: Float32Array // two values per event
  labels: Uint16Array | null
  k: number
  summary: ClusterSummary | null
  populationLabel: string
}
export interface Status { kind: 'info' | 'warning' | 'error'; text: string }

// What undo and redo restore. Samples are not part of it: adding a sample is not undone.
type Doc = Pick<Workbench, 'gates' | 'populations' | 'transforms' | 'compensation' | 'groups' | 'groupOf'>
const docOf = (wb: Workbench): Doc => ({ gates: wb.gates, populations: wb.populations, transforms: wb.transforms, compensation: wb.compensation, groups: wb.groups, groupOf: wb.groupOf })

interface State {
  wb: Workbench
  files: Record<string, FcsFile> // loaded event data by sample id (not saved in the Workbench)
  missing: Record<string, string> // sample id -> reason it could not be loaded
  history: History<Doc>
  filePath: string | null
  dirty: boolean
  sampleId: string | null
  groupFilter: string // group shown in the sample list
  popId: string
  gatePopId: string | null // population whose gate is selected on the plot
  xParam: string
  yParam: string
  plotType: PlotType
  mode: Mode
  tool: Tool
  transformAxis: 'x' | 'y' | null
  status: Status | null
  busy: boolean
  theme: Theme
  scaleVersion: number // bumped when the shared default axis scales change (a sample was added), so plots redraw
  csvFormat: CsvFormat // how exported tables write numbers: the computer's language ('auto'), or fixed
  chartColId: string | null // table column the chart shows
  overlays: OverlayItem[] // populations drawn over the open plot (saved in the Workbench)
  overlayNormalize: boolean // histograms: every curve scaled to its own tallest bin
  overlaySmooth: number // histograms: smoothing passes
  addOverlays(items: OverlayItem[]): void
  removeOverlay(id: string): void
  setOverlayOptions(normalize: boolean, smooth: number): void
  cluster: ClusterRun | null
  setCluster(r: ClusterRun | null): void
  exportCluster(): Promise<void>
  contourLevels: number // contour and zebra plots: how many lines
  showOutliers: boolean // contour and zebra plots: draw the events outside the outermost line as dots
  setContour(levels: number, outliers: boolean): void
  gallery: boolean // Graphs mode shows the same plot for every sample of the group side by side
  setGallery(on: boolean): void
  sheet: boolean // Graphs mode shows several different plots of the selected sample
  setSheet(on: boolean): void
  setSheetTiles(tiles: SheetTile[]): void
  openTile(tile: SheetTile): void // shows a sheet tile as the big plot
  sheetEdit: string | null // the sheet tile open in the editor above the sheet, where its gates can be drawn and changed
  editTile(tile: SheetTile | null): void
  displayMode: DisplayMode
  setDisplayMode(m: DisplayMode): void
  thumbSize: ThumbSize
  setThumbSize(s: ThumbSize): void
  selectRelative(delta: number): void // the next (+1) or previous (-1) sample of the group shown on the left

  setTableColumns(columns: TableColumn[]): void
  setChartCol(id: string | null): void
  setReport(blocks: ReportBlock[]): void
  exportReport(): Promise<void>
  setCsvFormat(f: CsvFormat): void
  exportTable(): Promise<void>
  addFcs(files: FileData[]): void
  addDemo(): void
  pickFcs(): Promise<void>
  newWorkbench(): void
  openWorkbench(): Promise<void>
  exportStats(ids?: string[]): Promise<void>
  exportPlot(): Promise<void>
  openPaths(paths: string[]): Promise<void>
  openDropped(files: File[]): Promise<void>
  saveWorkbench(saveAs: boolean): Promise<void>
  selectSample(id: string): void
  selection: string[] // samples marked in the list (with Ctrl or Shift); the open sample is always one of the marked
  toggleSelect(id: string): void
  selectRange(id: string): void
  removeSamples(ids?: string[]): void
  removeFromGroup(ids?: string[]): void // takes samples out of their own group: they go up to the group it sits in, or to All Samples
  removeMarked(): void // what Delete does: leaves the group when a group is shown, removes from the Workbench when All Samples is
  selectIds(ids: string[]): void
  assignMatrixTo(ids: string[], matrixId: string | null): void
  copyGatingTo(sourceId: string, targetIds: string[]): void
  clearGating(ids: string[]): void
  renameSample(id: string, name: string): void
  sortSamples(key: SortKey, dir: SortDir): void // puts the samples of the Workbench in that order
  reorderSamples(ids: string[], beforeId: string | null): void
  nudgeSamples(delta: -1 | 1): void // the marked samples one place up or down among the ones shown
  selectPop(id: string): void
  selectGate(popId: string | null): void
  setAxis(axis: 'x' | 'y', name: string): void
  setPlotType(t: PlotType): void
  setMode(m: Mode): void
  setLinkGates(on: boolean): void
  addMatrix(name: string, parameters: string[]): void
  setMatrixValues(id: string, values: number[][]): void
  renameMatrix(id: string, name: string): void
  deleteMatrix(id: string): void
  assignMatrix(id: string | null, scope: 'sample' | 'all'): void
  setTool(t: Tool): void
  openTransform(axis: 'x' | 'y' | null): void
  setTransform(param: string, spec: TransformSpec | null): void
  addGate(geometry: GateGeometry): void
  addQuadrant(cx: number, cy: number): void
  addBoolean(name: string, op: BoolOp, operands: string[]): void
  updateGate(gateId: string, geometry: GateGeometry): void
  renamePop(id: string, name: string): void
  deletePop(id: string): void
  selectGroup(id: string): void
  addGroup(name: string, parentId?: string | null): void
  moveGroup(id: string, parentId: string | null): void
  moveSamples(ids: string[], groupId: string): void
  renameGroup(id: string, name: string): void
  deleteGroup(id: string): void
  moveSample(sampleId: string, groupId: string): void
  applyToGroup(resync: boolean, targets?: string[]): void // 	argets: other samples to copy to (all, a group, a subgroup, the marked ones); without it, the group of the open sample
  undo(): void
  redo(): void
  setTheme(t: Theme): void
  setStatus(s: Status | null): void
}

const uid = (): string => crypto.randomUUID()

// The samples that are marked in the list: the ones chosen with Ctrl or Shift, and always the open sample.
function markedOf(s: Pick<State, 'selection' | 'sampleId' | 'wb'>): string[] {
  const ids = new Set(s.wb.samples.map((x) => x.id))
  const out = s.selection.filter((id) => ids.has(id))
  if (s.sampleId && !out.includes(s.sampleId)) out.push(s.sampleId)
  return out
}
export const markedSamples = markedOf

function pickAxes(file: FcsFile): { x: string; y: string } {
  const names = file.parameters.map((p) => p.name)
  const x = names.find((n) => n === 'FSC-A') ?? names[0] ?? ''
  const y = names.find((n) => n === 'SSC-A') ?? names.find((n) => n !== x) ?? x
  return { x, y }
}

// Adds a problem to the notice without replacing one that is already showing (for example a file that failed to open).
function addProblem(set: (s: Partial<State>) => void, get: () => State, text: string): void {
  const prev = get().status
  set({ status: { kind: 'error', text: prev && prev.kind !== 'info' ? `${prev.text} ${text}` : text } })
}

export const THUMB_MIN = 110
export const THUMB_MAX = 640
const THUMB_KEY = 'freeflow.thumb'
function initialThumb(): number {
  try {
    const v = Number(localStorage.getItem(THUMB_KEY))
    if (Number.isFinite(v) && v >= THUMB_MIN && v <= THUMB_MAX) return v
  } catch { /* storage unavailable */ }
  return 250
}

const DISPLAY_KEY = 'freeflow.display'
function initialDisplay(): DisplayMode {
  try { return localStorage.getItem(DISPLAY_KEY) === 'raw' ? 'raw' : 'smooth' } catch { return 'smooth' }
}

const FORMAT_KEY = 'freeflow.csvFormat'
function initialCsvFormat(): CsvFormat {
  try {
    const v = localStorage.getItem(FORMAT_KEY)
    if (v === 'point' || v === 'comma' || v === 'auto') return v
  } catch { /* storage unavailable */ }
  return 'auto'
}
const csvOptions = (f: CsvFormat) => csvOptionsFor(f === 'point' ? '.' : f === 'comma' ? ',' : (1.5).toLocaleString().charAt(1))

// Characters Windows does not allow in a file name become dashes.
const safeFileName = (s: string): string => s.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled'

// Asks before throwing away unsaved work. Returns true when it is fine to continue.
function confirmDiscard(dirty: boolean): boolean {
  return !dirty || window.confirm('You have unsaved changes. Discard them?')
}

// A spillover matrix stored in the file is offered as a matrix of the Workbench (not applied until the person chooses).
function withFileMatrix(c: Workbench['compensation'], sampleName: string, file: FcsFile): Workbench['compensation'] {
  const m = parseSpillover(file.keywords, file.parameters)
  if (!m) return c
  const key = JSON.stringify([m.parameters, m.values])
  if (c.matrices.some((x) => JSON.stringify([x.parameters, x.values]) === key)) return c
  const matrix: CompMatrix = { id: crypto.randomUUID(), name: sampleName, parameters: m.parameters, values: m.values, source: 'file' }
  return { ...c, matrices: [...c.matrices, matrix] }
}

export const useStore = create<State>((set, get) => {
  const addLoaded = (ref: SampleRef, file: FcsFile): void => {
    set((s) => {
      const first = s.sampleId === null
      const axes = first ? pickAxes(file) : { x: s.xParam, y: s.yParam }
      // a sample added while a custom group is open joins that group
      const groupOf = s.groupFilter !== DEFAULT_GROUP && s.wb.groups.some((g) => g.id === s.groupFilter) ? { ...s.wb.groupOf, [ref.id]: s.groupFilter } : s.wb.groupOf
      const files = { ...s.files, [ref.id]: file }
      setDefaultScalePool(Object.values(files)) // every sample now shares the default scale of each parameter
      // with linked gates, a sample that joins a group takes the gating the group already has
      const added = { ...s.wb, samples: [...s.wb.samples, ref], groupOf, compensation: withFileMatrix(s.wb.compensation, ref.name, file) }
      return {
        wb: adoptGroupGating(added, ref.id),
        scaleVersion: s.scaleVersion + 1,
        files,
        sampleId: first ? ref.id : s.sampleId,
        xParam: axes.x,
        yParam: axes.y,
        dirty: true,
      }
    })
  }

  // Replaces the current work with a Workbench read from text. Sample files are read again from their paths.
  const loadWorkbench = async (json: string, path: string | null): Promise<void> => {
    const parsed = parseWorkbench(json)
    // the name shown is the name of the file it was opened from, which is what it was last saved as
    if (path) parsed.name = path.split(/[\\/]/).pop()!.replace(/\.(ffwb|fcwb)$/i, '')
    const files: Record<string, FcsFile> = {}
    const missing: Record<string, string> = {}
    for (const s of parsed.samples) {
      try {
        if (s.source.kind === 'demo') files[s.id] = parseFcs(makeDemoFcs(s.source.seed, 20000))
        else files[s.id] = parseFcs(await getBridge().readFile(s.source.path))
      } catch (e) {
        missing[s.id] = (e as Error).message
      }
    }
    // a file saved before gates were kept in real values is converted now that its samples can be read
    const up = upgradeGatesToRealValues(parsed, files)
    const wb = up.wb
    setDefaultScalePool(Object.values(files))
    const firstId = wb.samples.find((s) => files[s.id])?.id ?? null
    const axes = firstId ? pickAxes(files[firstId]) : { x: '', y: '' }
    const converted = up.upgraded && parsed.gates.length > 0 // an older file whose gates were just rewritten in real values
    const olderMode = wb.gateSpace === 'display' && wb.gates.length > 0 // an older file that could not be converted yet
    set({ scaleVersion: get().scaleVersion + 1, wb, files, missing, history: emptyHistory(), filePath: path, dirty: converted, sampleId: firstId ?? wb.samples[0]?.id ?? null, groupFilter: DEFAULT_GROUP, popId: ROOT_ID, gatePopId: null, xParam: axes.x, yParam: axes.y, plotType: 'pseudocolor', mode: 'graphs', tool: 'select', transformAxis: null, overlays: (wb.overlays ?? []).filter((o) => wb.samples.some((x) => x.id === o.sampleId)), cluster: null, selection: [], chartColId: wb.table?.[0]?.id ?? null,
      status: Object.keys(missing).length
        ? { kind: 'error', text: `${Object.keys(missing).length} sample file(s) could not be loaded (${Object.values(missing)[0]}); the gates were kept${olderMode ? '. This file was made with an older version, so its gates stay as they were until all its samples can be opened.' : ''}` }
        : converted
          ? { kind: 'warning', text: `Opened ${wb.name}. This file was made with an older version: its gates were converted to real data values, so they now stay on their events when a scale changes. Save it to keep the conversion.` }
          : { kind: 'info', text: `Opened ${wb.name}` } })
  }

  // Applies a change to gates, populations or transforms and remembers the previous state for undo.
  const change = (fn: (s: State) => Partial<State>): void =>
    set((s) => ({ ...fn(s), history: record(s.history, docOf(s.wb)), dirty: true }))

  const restore = (r: { history: History<Doc>; state: Doc } | null): void => {
    if (!r) return
    set((s) => {
      const wb = { ...s.wb, ...r.state }
      return {
        wb,
        history: r.history,
        popId: populationsFor(wb, s.sampleId).some((p) => p.id === s.popId) ? s.popId : ROOT_ID,
        groupFilter: wb.groups.some((g) => g.id === s.groupFilter) || s.groupFilter === DEFAULT_GROUP ? s.groupFilter : DEFAULT_GROUP,
        gatePopId: null,
        dirty: true,
      }
    })
  }

  return {
    wb: emptyWorkbench(),
    files: {},
    missing: {},
    history: emptyHistory(),
    filePath: null,
    dirty: false,
    sampleId: null,
    groupFilter: DEFAULT_GROUP,
    popId: ROOT_ID,
    gatePopId: null,
    xParam: '',
    yParam: '',
    plotType: 'pseudocolor',
    mode: 'graphs',
    tool: 'select',
    transformAxis: null,
    status: null,
    busy: false,
    theme: initialTheme(),
    scaleVersion: 0,
    csvFormat: initialCsvFormat(),
    chartColId: null,
    gallery: false,
    sheet: false,
    displayMode: initialDisplay(),
    thumbSize: initialThumb(),
    overlays: [],
    overlayNormalize: true,
    overlaySmooth: 0,
    addOverlays: (items) => set((s) => {
      const overlays = [...s.overlays, ...items.filter((i) => !s.overlays.some((o) => o.sampleId === i.sampleId && JSON.stringify(o.path) === JSON.stringify(i.path)))]
      return { overlays, wb: { ...s.wb, overlays }, dirty: true }
    }),
    removeOverlay: (id) => set((s) => {
      const overlays = s.overlays.filter((o) => o.id !== id)
      return { overlays, wb: { ...s.wb, overlays }, dirty: true }
    }),
    setOverlayOptions: (overlayNormalize, overlaySmooth) => set({ overlayNormalize, overlaySmooth }),
    contourLevels: 10,
    cluster: null,
    setCluster: (cluster) => set({ cluster }),
    async exportCluster() {
      const s = get()
      if (!s.cluster) { set({ status: { kind: 'error', text: 'Run the Cluster Explorer first.' } }); return }
      const c = s.cluster
      const csv = clusterCsv(c.input, c.input.params, c.embedding, c.labels, (id) => s.wb.samples.find((x) => x.id === id)?.name ?? id, csvOptions(s.csvFormat))
      try {
        const path = await getBridge().saveText(csv, `${safeFileName(s.wb.name)} clusters.csv`, 'CSV file', 'csv')
        if (path) set({ status: { kind: 'info', text: `Saved ${path}` } })
      } catch (e) {
        set({ status: { kind: 'error', text: `Could not save the events: ${(e as Error).message}` } })
      }
    },
    showOutliers: true,
    setContour: (contourLevels, showOutliers) => set({ contourLevels, showOutliers }),
    setGallery: (gallery) => set({ gallery, sheet: gallery ? false : get().sheet, transformAxis: null }),
    setSheet: (sheet) => set({ sheet, gallery: sheet ? false : get().gallery, transformAxis: null, sheetEdit: sheet ? get().sheetEdit : null }),
    setSheetTiles: (tiles) => set((s) => ({ wb: { ...s.wb, sheet: tiles }, dirty: true })),
    setDisplayMode(displayMode) {
      try { localStorage.setItem(DISPLAY_KEY, displayMode) } catch { /* storage unavailable */ }
      set({ displayMode })
    },
    setThumbSize(size) {
      const thumbSize = Math.min(THUMB_MAX, Math.max(THUMB_MIN, Math.round(size)))
      try { localStorage.setItem(THUMB_KEY, String(thumbSize)) } catch { /* storage unavailable */ }
      set({ thumbSize })
    },
    sheetEdit: null,
    editTile(tile) {
      if (!tile) { set({ sheetEdit: null }); return }
      const s = get()
      const pop = findByPath(populationsFor(s.wb, s.sampleId), s.sampleId ?? '', tile.path)
      set({ sheetEdit: tile.id, plotType: tile.plot, xParam: tile.x, yParam: tile.plot === 'histogram' ? s.yParam : tile.y, popId: pop?.id ?? ROOT_ID, gatePopId: null, tool: 'select' })
    },
    openTile(tile) {
      const s = get()
      const pop = findByPath(populationsFor(s.wb, s.sampleId), s.sampleId ?? '', tile.path)
      set({ plotType: tile.plot, xParam: tile.x, yParam: tile.plot === 'histogram' ? s.yParam : tile.y, popId: pop?.id ?? ROOT_ID, gatePopId: null, tool: 'select', gallery: false, sheet: false, sheetEdit: null })
    },
    selectRelative(delta) {
      const s = get()
      const members = samplesInGroup(s.wb, s.groupFilter)
      if (members.length === 0) return
      const i = members.findIndex((m) => m.id === s.sampleId)
      const next = members[Math.min(members.length - 1, Math.max(0, i < 0 ? 0 : i + delta))]
      if (next && next.id !== s.sampleId) get().selectSample(next.id)
    },

    setTableColumns(columns) {
      set((s) => ({ wb: { ...s.wb, table: columns }, dirty: true, chartColId: columns.some((c) => c.id === s.chartColId) ? s.chartColId : (columns[0]?.id ?? null) }))
    },
    setChartCol: (chartColId) => set({ chartColId }),
    setReport: (blocks) => set((s) => ({ wb: { ...s.wb, report: blocks }, dirty: true })),

    async exportReport() {
      const s = get()
      if (!(s.wb.report?.length)) { set({ status: { kind: 'error', text: 'The report is empty: add a block in the Reports mode first.' } }); return }
      try {
        const path = await getBridge().saveText(buildReportHtml(s.wb, s.files, s.groupFilter), `${safeFileName(s.wb.name)} report.html`, 'HTML file', 'html')
        if (path) set({ status: { kind: 'info', text: `Saved ${path}` } })
      } catch (e) {
        set({ status: { kind: 'error', text: `Could not save the report: ${(e as Error).message}` } })
      }
    },
    setCsvFormat(csvFormat) {
      try { localStorage.setItem(FORMAT_KEY, csvFormat) } catch { /* storage unavailable */ }
      set({ csvFormat })
    },

    async exportTable() {
      const s = get()
      const columns = s.wb.table ?? []
      if (columns.length === 0) { set({ status: { kind: 'error', text: 'The table has no columns yet: add one in the Tables mode first.' } }); return }
      const rows = computeTable(s.wb, s.files, s.groupFilter, columns)
      const csv = tableToCsv(rows, columns, csvOptions(s.csvFormat))
      try {
        const path = await getBridge().saveText(csv, `${safeFileName(s.wb.name)} table.csv`, 'CSV file', 'csv')
        if (path) set({ status: { kind: 'info', text: `Saved ${path}` } })
      } catch (e) {
        set({ status: { kind: 'error', text: `Could not save the table: ${(e as Error).message}` } })
      }
    },

    addFcs(files) {
      const errors: string[] = []
      const warnings: string[] = []
      let added = 0
      for (const f of files) {
        if (f.error || !f.data) { errors.push(`${f.name}: ${f.error ?? 'the file is empty'}`); continue }
        try {
          const file = parseFcs(f.data)
          addLoaded({ id: uid(), name: f.name, source: { kind: 'file', path: f.path ?? f.name } }, file)
          added++
          for (const w of file.warnings) warnings.push(`${f.name}: ${w}`)
        } catch (e) {
          errors.push(`${f.name}: ${(e as Error).message}`)
        }
      }
      const lead = added ? `Added ${added} of ${files.length} file(s). ` : ''
      if (errors.length) set({ status: { kind: 'error', text: `${lead}Could not open ${errors.join(' ')}` } })
      else if (warnings.length) set({ status: { kind: 'warning', text: `Added ${added} file(s) with a warning. ${warnings.join(' ')}` } })
      else set({ status: { kind: 'info', text: `Added ${added} file(s)` } })
    },

    addDemo() {
      const seed = get().wb.samples.filter((s) => s.source.kind === 'demo').length + 1
      addLoaded({ id: uid(), name: `Demo sample ${seed}`, source: { kind: 'demo', seed } }, parseFcs(makeDemoFcs(seed, 20000)))
      set({ status: { kind: 'info', text: 'Added a synthetic demo sample (20,000 events)' } })
    },

    async pickFcs() {
      try {
        const files = await getBridge().openFcs()
        if (files) get().addFcs(files)
      } catch (e) {
        set({ status: { kind: 'error', text: `Could not open files: ${(e as Error).message}` } })
      }
    },

    newWorkbench() {
      if (!confirmDiscard(get().dirty)) return
      setDefaultScalePool([])
      set({ scaleVersion: get().scaleVersion + 1, wb: emptyWorkbench(), files: {}, missing: {}, history: emptyHistory(), filePath: null, dirty: false, sampleId: null, groupFilter: DEFAULT_GROUP, popId: ROOT_ID, gatePopId: null, xParam: '', yParam: '', plotType: 'pseudocolor', mode: 'graphs', tool: 'select', transformAxis: null, overlays: [], cluster: null, selection: [], chartColId: null, status: null })
    },

    async openWorkbench() {
      if (!confirmDiscard(get().dirty)) return
      set({ busy: true })
      try {
        const r = await getBridge().openWorkbench()
        if (r) await loadWorkbench(r.json, r.path)
      } catch (e) {
        set({ status: { kind: 'error', text: `Could not open Workbench: ${(e as Error).message}` } })
      } finally {
        set({ busy: false })
      }
    },

    // Counts and percentages of every population of every sample, as a table that opens in Excel.
    async exportStats(ids) {
      const s = get()
      if (s.wb.samples.length === 0) { set({ status: { kind: 'error', text: 'There is nothing to export yet: add a sample first.' } }); return }
      const wbOut = ids ? { ...s.wb, samples: s.wb.samples.filter((x) => ids.includes(x.id)) } : s.wb
      const csv = toCsv(statsRows(wbOut, s.files), csvOptions(s.csvFormat))
      try {
        const path = await getBridge().saveText(csv, `${safeFileName(s.wb.name)} statistics.csv`, 'CSV file', 'csv')
        if (path) set({ status: { kind: 'info', text: `Saved ${path}` } })
      } catch (e) {
        set({ status: { kind: 'error', text: `Could not save the statistics: ${(e as Error).message}` } })
      }
    },

    async exportPlot() {
      const s = get()
      const png = s.mode === 'graphs' || s.mode === 'charts' || s.mode === 'qc' || s.mode === 'cluster' ? currentPlotPng() : null
      if (!png) { set({ status: { kind: 'error', text: 'Open a plot in the Graphs mode (or a chart in Charts or Quality Control) to export its image.' } }); return }
      const sample = s.wb.samples.find((x) => x.id === s.sampleId)?.name.replace(/\.fcs$/i, '') ?? 'plot'
      const axes = s.mode === 'charts' ? 'chart' : s.mode === 'qc' ? 'quality control' : s.mode === 'cluster' ? 'cluster map' : s.plotType === 'histogram' ? s.xParam : `${s.xParam} vs ${s.yParam}`
      try {
        const path = await getBridge().savePng(png, `${safeFileName(s.mode === 'charts' || s.mode === 'cluster' ? s.wb.name : sample)} ${safeFileName(axes)}.png`)
        if (path) set({ status: { kind: 'info', text: `Saved ${path}` } })
      } catch (e) {
        set({ status: { kind: 'error', text: `Could not save the image: ${(e as Error).message}` } })
      }
    },

    // Files given by path (double-click, "Open with", a second launch of the program) go to the right place by extension.
    async openPaths(paths) {
      const b = getBridge()
      const fcs: FileData[] = []
      const problems: string[] = []
      let workbench: string | null = null
      for (const p of paths) {
        const name = p.split(/[\\/]/).pop() ?? p
        if (/\.(ffwb|fcwb)$/i.test(name)) {
          if (workbench) { problems.push(`${name}: only one Workbench can be open at a time`); continue }
          workbench = p
        } else {
          try { fcs.push({ name, path: p, data: await b.readFile(p) }) } catch (e) { fcs.push({ name, path: p, error: (e as Error).message }) }
        }
      }
      if (workbench) {
        if (!confirmDiscard(get().dirty)) return
        try { await loadWorkbench(await b.readText(workbench), workbench) } catch (e) { set({ status: { kind: 'error', text: `Could not open ${workbench}: ${(e as Error).message}` } }) }
      }
      if (fcs.length) get().addFcs(fcs)
      if (problems.length) addProblem(set, get, problems.join(' '))
    },

    // Files dropped on the window: FCS files are added, a Workbench is opened, anything else is said so.
    async openDropped(files) {
      const b = getBridge()
      const fcs: FileData[] = []
      let wb: { json: string; path: string | null; name: string } | null = null
      const other: string[] = []
      for (const f of files) {
        const path = b.pathForFile(f)
        if (/\.(ffwb|fcwb)$/i.test(f.name)) wb = { json: await f.text(), path, name: f.name }
        else if (/\.fcs$/i.test(f.name)) fcs.push({ name: f.name, path, data: await f.arrayBuffer() })
        else other.push(f.name)
      }
      if (wb && confirmDiscard(get().dirty)) {
        try { await loadWorkbench(wb.json, wb.path) } catch (e) { set({ status: { kind: 'error', text: `Could not open ${wb.name}: ${(e as Error).message}` } }) }
      }
      if (fcs.length) get().addFcs(fcs)
      if (other.length) addProblem(set, get, `Not opened (only FCS files and Freeflow Workbenches can be dropped here): ${other.join(', ')}`)
    },

    async saveWorkbench(saveAs) {
      const { wb, filePath } = get()
      try {
        const suggested = `${wb.name || 'Untitled'}.ffwb`
        const path = await getBridge().saveWorkbench(JSON.stringify(wb, null, 2), filePath, saveAs, suggested)
        if (path) {
          const name = path.split(/[\\/]/).pop()!.replace(/\.(ffwb|fcwb)$/i, '')
          set({ filePath: path, dirty: false, wb: { ...get().wb, name }, status: { kind: 'info', text: `Saved ${path}` } })
        }
      } catch (e) {
        set({ status: { kind: 'error', text: `Could not save: ${(e as Error).message}` } })
      }
    },

    // Moving to another sample keeps looking at the same population when that sample has one with the same name path.
    selectSample(id) {
      const s = get()
      const path = namePath(populationsFor(s.wb, s.sampleId), s.popId)
      const same = findByPath(populationsFor(s.wb, id), id, path)
      set({ sampleId: id, popId: same?.id ?? ROOT_ID, gatePopId: null, selection: [id] })
    },
    selection: [],
    // Ctrl+click: adds a sample to the marked ones, or takes it off. The newly added one becomes the open sample.
    toggleSelect(id) {
      const s = get()
      const marked = new Set(markedOf(s))
      if (marked.has(id) && marked.size > 1) {
        marked.delete(id)
        const rest = [...marked]
        set({ selection: rest, ...(id === s.sampleId ? { sampleId: rest[rest.length - 1] } : {}) })
      } else if (!marked.has(id)) {
        get().selectSample(id)
        set({ selection: [...marked, id] })
      }
    },
    // Shift+click: marks every sample of the list between the open one and this one, without changing the open sample.
    selectRange(id) {
      const s = get()
      const members = samplesInGroup(s.wb, s.groupFilter).map((m) => m.id)
      const a = members.indexOf(s.sampleId ?? '')
      const b = members.indexOf(id)
      if (a < 0 || b < 0) { get().selectSample(id); return }
      set({ selection: members.slice(Math.min(a, b), Math.max(a, b) + 1) })
    },
    // A sample's name is how it is listed, sorted and labelled everywhere; the FCS file on disk keeps its own name.
    renameSample(id, name) {
      const clean = name.trim()
      if (!clean) return
      set((s) => ({ wb: { ...s.wb, samples: s.wb.samples.map((x) => (x.id === id ? { ...x, name: clean } : x)) }, dirty: true }))
    },
    // The order of the samples is saved with the Workbench but is not part of undo.
    sortSamples(key, dir) {
      const s = get()
      set({ wb: { ...s.wb, samples: sortList(s.wb, s.files, key, dir) }, dirty: true })
    },
    reorderSamples(ids, beforeId) {
      const s = get()
      if (beforeId !== null && ids.includes(beforeId)) return
      set({ wb: { ...s.wb, samples: moveBefore(s.wb.samples, ids, beforeId) }, dirty: true })
    },
    nudgeSamples(delta) {
      const s = get()
      const shown = samplesInGroup(s.wb, s.groupFilter).map((x) => x.id)
      set({ wb: { ...s.wb, samples: nudge(s.wb.samples, shown, markedOf(s), delta) }, dirty: true })
    },
    // Takes samples out of the Workbench (the FCS files on disk are not touched). Their gates go with them. This cannot be undone,
    // so it asks first, and the undo history is cleared because it would otherwise point at samples that are gone.
    removeSamples(ids) {
      const s = get()
      const gone = new Set(ids ?? markedOf(s))
      if (gone.size === 0) return
      const names = s.wb.samples.filter((x) => gone.has(x.id)).map((x) => x.name)
      const what = names.length === 1 ? `"${names[0]}"` : `${names.length} samples`
      if (!window.confirm(`Remove ${what} from the Workbench? The FCS file${names.length === 1 ? '' : 's'} on disk will not be touched, but the gates of ${names.length === 1 ? 'this sample' : 'these samples'} are lost. This cannot be undone.`)) return
      const samples = s.wb.samples.filter((x) => !gone.has(x.id))
      const populations = s.wb.populations.filter((p) => !(p.sampleId != null && gone.has(p.sampleId)))
      const usedGates = new Set(populations.map((p) => p.gateId))
      const keep = <T,>(o: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(o).filter(([k]) => !gone.has(k)))
      const overlays = s.overlays.filter((o) => !gone.has(o.sampleId))
      const files = keep(s.files)
      setDefaultScalePool(Object.values(files))
      const members = samplesInGroup({ ...s.wb, samples }, s.groupFilter)
      const next = (s.sampleId && !gone.has(s.sampleId) ? s.sampleId : (members[0]?.id ?? samples[0]?.id)) ?? null
      set({
        wb: {
          ...s.wb, samples, populations, gates: s.wb.gates.filter((g) => usedGates.has(g.id)), groupOf: keep(s.wb.groupOf),
          compensation: { ...s.wb.compensation, assignments: keep(s.wb.compensation.assignments) }, overlays,
        },
        files, missing: keep(s.missing), overlays,
        cluster: s.cluster && s.cluster.input.sampleIds.some((id) => gone.has(id)) ? null : s.cluster,
        sampleId: next, selection: next ? [next] : [], popId: ROOT_ID, gatePopId: null, history: emptyHistory(), dirty: true,
        scaleVersion: s.scaleVersion + 1,
        status: { kind: 'info', text: `Removed ${what}. The FCS files on disk were not touched.` },
      })
    },
    selectPop: (id) => set({ popId: id, gatePopId: null }),
    selectGate: (popId) => set({ gatePopId: popId }),
    setAxis: (axis, name) => set(axis === 'x' ? { xParam: name } : { yParam: name }),
    setPlotType: (plotType) => set({ plotType, tool: 'select', gatePopId: null }),
    setMode: (mode) => set({ mode, transformAxis: null }),
    setTool: (tool) => set({ tool }),
    openTransform: (axis) => set({ transformAxis: axis }),

    setTransform(param, spec) {
      change((s) => {
        const transforms = { ...s.wb.transforms }
        if (spec) transforms[param] = spec
        else delete transforms[param]
        return { wb: { ...s.wb, transforms } }
      })
    },

    addGate(geometry) {
      if (!get().sampleId) return
      change((s) => {
        const id = uid()
        const popIdNew = uid()
        // histograms plot one parameter, so a range gate has no second one
        const gate: Gate = { id, xParam: s.xParam, yParam: geometry.type === 'range' ? '' : s.yParam, geometry }
        return {
          wb: syncLinked({
            ...s.wb,
            gates: [...s.wb.gates, gate],
            populations: [...s.wb.populations, { id: popIdNew, name: nextGateName(populationsFor(s.wb, s.sampleId)), parentId: s.popId, gateId: id, sampleId: s.sampleId }],
          }, s.sampleId),
          gatePopId: popIdNew,
          tool: 'select',
        }
      })
    },

    // Changes the shape of a gate that already exists; the population it defines is recomputed from it.
    updateGate(gateId, geometry) {
      change((s) => {
        // the four quarters of a quadrant gate (in the same sample) keep sharing one crosshair
        const ids = new Set([gateId])
        if (geometry.type === 'quadrant') {
          const owner = s.wb.populations.find((p) => p.gateId === gateId)
          for (const p of s.wb.populations) {
            const g = s.wb.gates.find((x) => x.id === p.gateId)
            if (g && g.geometry.type === 'quadrant' && g.geometry.link === geometry.link && p.sampleId === owner?.sampleId) ids.add(g.id)
          }
        }
        return {
          wb: syncLinked({
            ...s.wb,
            gates: s.wb.gates.map((g) => {
              if (!ids.has(g.id)) return g
              if (g.id === gateId) return { ...g, geometry }
              return geometry.type === 'quadrant' && g.geometry.type === 'quadrant' ? { ...g, geometry: { ...g.geometry, cx: geometry.cx, cy: geometry.cy } } : g
            }),
          }, s.sampleId),
        }
      })
    },

    // A quadrant gate makes four populations at once, one per quarter, named after the two parameters.
    addQuadrant(cx, cy) {
      if (!get().sampleId) return
      change((s) => {
        const link = uid()
        const x = s.xParam
        const y = s.yParam
        const used = new Set(populationsFor(s.wb, s.sampleId).map((p) => p.name))
        const unique = (base: string): string => {
          let name = base
          for (let n = 2; used.has(name); n++) name = `${base} (${n})`
          used.add(name)
          return name
        }
        const defs: [Quadrant, string][] = [['nw', `${x}− ${y}+`], ['ne', `${x}+ ${y}+`], ['se', `${x}+ ${y}−`], ['sw', `${x}− ${y}−`]]
        const gates: Gate[] = []
        const pops: Workbench['populations'] = []
        for (const [q, name] of defs) {
          const gid = uid()
          gates.push({ id: gid, xParam: x, yParam: y, geometry: { type: 'quadrant', cx, cy, q, link } })
          pops.push({ id: uid(), name: unique(name), parentId: s.popId, gateId: gid, sampleId: s.sampleId })
        }
        return { wb: syncLinked({ ...s.wb, gates: [...s.wb.gates, ...gates], populations: [...s.wb.populations, ...pops] }, s.sampleId), gatePopId: pops[1].id, tool: 'select' }
      })
    },

    // A boolean population combines populations of the sample that is open, and sits directly under All events.
    addBoolean(name, op, operands) {
      const sid = get().sampleId
      if (!sid) return
      change((s) => {
        const used = new Set(populationsFor(s.wb, sid).map((p) => p.name))
        const base = name.trim() || (op === 'not' ? 'Not' : op === 'and' ? 'And' : 'Or')
        let unique = base
        for (let n = 2; used.has(unique); n++) unique = `${base} (${n})`
        const id = uid()
        return { wb: syncLinked({ ...s.wb, populations: [...s.wb.populations, { id, name: unique, parentId: ROOT_ID, gateId: null, sampleId: sid, bool: { op, operands } }] }, sid), popId: id, gatePopId: null }
      })
    },

    renamePop(id, name) {
      const clean = name.trim()
      if (!clean || id === ROOT_ID) return
      change((s) => ({ wb: syncLinked({ ...s.wb, populations: s.wb.populations.map((p) => (p.id === id ? { ...p, name: clean } : p)) }, s.sampleId) }))
    },

    deletePop(id) {
      if (id === ROOT_ID) return
      change((s) => {
        const gone = new Set([id, ...descendants(s.wb.populations, id)])
        // deleting one quarter of a quadrant gate deletes the gate: all four quarters and what is below them
        const own = s.wb.populations.find((p) => p.id === id)
        const g = own?.gateId ? s.wb.gates.find((x) => x.id === own.gateId) : undefined
        if (own && g?.geometry.type === 'quadrant') {
          const link = g.geometry.link
          for (const p of s.wb.populations) {
            const pg = s.wb.gates.find((x) => x.id === p.gateId)
            if (p.parentId === own.parentId && p.sampleId === own.sampleId && pg?.geometry.type === 'quadrant' && pg.geometry.link === link) {
              gone.add(p.id)
              for (const d of descendants(s.wb.populations, p.id)) gone.add(d)
            }
          }
        }
        // a boolean population that combines a deleted one goes with it, and so does what is below it
        for (let again = true; again;) {
          again = false
          for (const p of s.wb.populations) {
            if (!gone.has(p.id) && p.bool?.operands.some((o) => gone.has(o))) { gone.add(p.id); for (const d of descendants(s.wb.populations, p.id)) gone.add(d); again = true }
          }
        }
        const populations = s.wb.populations.filter((p) => !gone.has(p.id))
        const usedGates = new Set(populations.map((p) => p.gateId))
        return {
          wb: syncLinked({ ...s.wb, populations, gates: s.wb.gates.filter((g) => usedGates.has(g.id)) }, s.sampleId),
          popId: gone.has(s.popId) ? ROOT_ID : s.popId,
          gatePopId: null,
        }
      })
    },

    // With linking on, the samples of a group keep the same gates; turning it on makes them agree with this sample.
    setLinkGates(on) {
      const s = get()
      if (!on) { set({ wb: { ...s.wb, linkGates: false }, dirty: true }); return }
      const sid = s.sampleId
      const peers = sid ? linkedPeers(s.wb, sid) : []
      const differs = !!sid && peers.some((p) => gatingDiffers(s.wb, sid, p))
      if (differs && !window.confirm(`Make the gating of ${peers.length} other sample(s) in this group the same as this sample's? Their own gates will be replaced. You can undo this.`)) return
      change((st) => ({ wb: syncLinked({ ...st.wb, linkGates: true }, st.sampleId) }))
    },

    addMatrix(name, parameters) {
      const n = parameters.length
      change((s) => {
        const values = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
        const matrix: CompMatrix = { id: uid(), name: name.trim() || 'Matrix', parameters, values, source: 'manual' }
        return { wb: { ...s.wb, compensation: { ...s.wb.compensation, matrices: [...s.wb.compensation.matrices, matrix] } } }
      })
    },

    setMatrixValues(id, values) {
      change((s) => ({ wb: { ...s.wb, compensation: { ...s.wb.compensation, matrices: s.wb.compensation.matrices.map((m) => (m.id === id ? { ...m, values } : m)) } } }))
    },

    renameMatrix(id, name) {
      const clean = name.trim()
      if (!clean) return
      change((s) => ({ wb: { ...s.wb, compensation: { ...s.wb.compensation, matrices: s.wb.compensation.matrices.map((m) => (m.id === id ? { ...m, name: clean } : m)) } } }))
    },

    deleteMatrix(id) {
      change((s) => {
        const assignments = Object.fromEntries(Object.entries(s.wb.compensation.assignments).filter(([, m]) => m !== id))
        return { wb: { ...s.wb, compensation: { matrices: s.wb.compensation.matrices.filter((m) => m.id !== id), assignments } } }
      })
    },

    // id null removes the matrix from the target samples. "all" skips samples that lack one of the matrix parameters.
    assignMatrix(id, scope) {
      const s0 = get()
      const matrix = id ? s0.wb.compensation.matrices.find((m) => m.id === id) : undefined
      const has = (sid: string): boolean => !matrix || matrix.parameters.every((p) => s0.files[sid]?.parameters.some((q) => q.name === p))
      const targets = scope === 'sample' ? (s0.sampleId ? [s0.sampleId] : []) : s0.wb.samples.map((x) => x.id).filter(has)
      const skipped = scope === 'all' && id ? s0.wb.samples.length - targets.length : 0
      change((s) => {
        const assignments = { ...s.wb.compensation.assignments }
        for (const t of targets) {
          if (id) assignments[t] = id
          else delete assignments[t]
        }
        return { wb: { ...s.wb, compensation: { ...s.wb.compensation, assignments } } }
      })
      if (matrix) {
        const extra = skipped ? '; ' + skipped + ' skipped because they lack one of its parameters' : ''
        set({ status: { kind: 'info', text: matrix.name + ' applied to ' + targets.length + ' sample(s)' + extra } })
      }
    },

    selectGroup(id) {
      const s = get()
      const members = samplesInGroup(s.wb, id)
      const keep = s.sampleId && members.some((m) => m.id === s.sampleId)
      set({ groupFilter: id, ...(keep || members.length === 0 ? {} : { sampleId: members[0].id, popId: ROOT_ID, gatePopId: null }) })
    },

    addGroup(name, parentId = null) {
      const clean = name.trim() || 'New group'
      const id = uid()
      change((s) => ({ wb: { ...s.wb, groups: [...s.wb.groups, { id, name: clean, ...(parentId && s.wb.groups.some((g) => g.id === parentId) ? { parentId } : {}) }] }, groupFilter: id }))
    },

    // A group (with everything in it) becomes a subgroup of another, or a top-level group with null. Not into itself or below itself.
    moveGroup(id, parentId) {
      const s = get()
      if (parentId !== null && (groupSubtree(s.wb, id).includes(parentId) || !s.wb.groups.some((g) => g.id === parentId))) return
      if ((s.wb.groups.find((g) => g.id === id)?.parentId ?? null) === parentId) return
      change((st) => ({ wb: { ...st.wb, groups: st.wb.groups.map((g) => (g.id === id ? (parentId ? { ...g, parentId } : { id: g.id, name: g.name }) : g)) } }))
    },

    renameGroup(id, name) {
      const clean = name.trim()
      if (!clean) return
      change((s) => ({ wb: { ...s.wb, groups: s.wb.groups.map((g) => (g.id === id ? { ...g, name: clean } : g)) } }))
    },

    // Deleting a group never deletes samples or subgroups: they move up to the group it was in (or to All Samples).
    deleteGroup(id) {
      change((s) => {
        const parent = s.wb.groups.find((g) => g.id === id)?.parentId ?? null
        const groups = s.wb.groups.filter((g) => g.id !== id).map((g) => (g.parentId === id ? (parent ? { ...g, parentId: parent } : { id: g.id, name: g.name }) : g))
        const groupOf: Record<string, string> = {}
        for (const [sid, g] of Object.entries(s.wb.groupOf)) { if (g !== id) groupOf[sid] = g; else if (parent) groupOf[sid] = parent }
        return { wb: { ...s.wb, groups, groupOf }, groupFilter: s.groupFilter === id ? (parent ?? DEFAULT_GROUP) : s.groupFilter }
      })
    },

    moveSamples(ids, groupId) {
      for (const id of ids) get().moveSample(id, groupId)
      const s = get()
      set({ status: { kind: 'info', text: `Moved ${ids.length} sample(s) to ${groupId === DEFAULT_GROUP ? 'All Samples' : (s.wb.groups.find((g) => g.id === groupId)?.name ?? 'the group')}` } })
    },

    moveSample(sampleId, groupId) {
      change((s) => {
        const groupOf = { ...s.wb.groupOf }
        if (groupId === DEFAULT_GROUP) delete groupOf[sampleId]
        else groupOf[sampleId] = groupId
        return { wb: adoptGroupGating({ ...s.wb, groupOf }, sampleId) }
      })
    },

    // Copies the selected population (or, with resync, the whole gating tree) to the other samples of the group.
    // Leaving a group is not losing the sample: it goes up one level (to the group the group sits in, or to All Samples) and keeps its place in the list.
    removeFromGroup(ids) {
      const s = get()
      const chosen = (ids ?? markedOf(s)).filter((id) => s.wb.groupOf[id] && s.wb.groups.some((g) => g.id === s.wb.groupOf[id]))
      if (chosen.length === 0) { set({ status: { kind: 'info', text: 'These samples are not in a group.' } }); return }
      const up = (id: string): string => s.wb.groups.find((g) => g.id === s.wb.groupOf[id])?.parentId ?? DEFAULT_GROUP
      const where = new Set(chosen.map(up))
      for (const id of chosen) get().moveSample(id, up(id))
      const name = where.size === 1 ? ([...where][0] === DEFAULT_GROUP ? 'All Samples' : (s.wb.groups.find((g) => g.id === [...where][0])?.name ?? 'the group above')) : 'the groups above'
      const after = get()
      // the list shows the group they left: keep looking at a sample that is still there
      const here = samplesInGroup(after.wb, after.groupFilter)
      set({ status: { kind: 'info', text: `${chosen.length === 1 ? s.wb.samples.find((x) => x.id === chosen[0])?.name : `${chosen.length} samples`} left the group and went to ${name}. They are still in the Workbench.` }, ...(here.length && !here.some((m) => m.id === after.sampleId) ? { sampleId: here[0].id, selection: [here[0].id] } : {}) })
    },
    removeMarked() {
      const s = get()
      if (s.groupFilter === DEFAULT_GROUP) get().removeSamples()
      else get().removeFromGroup()
    },
    selectIds(ids) {
      const s = get()
      const valid = ids.filter((id) => s.wb.samples.some((x) => x.id === id))
      if (valid.length === 0) return
      set({ selection: valid, ...(valid.includes(s.sampleId ?? '') ? {} : { sampleId: valid[0] }) })
    },
    // A matrix (or none, with null) for each of these samples; a sample that lacks one of its parameters is skipped and said so.
    assignMatrixTo(ids, matrixId) {
      const s0 = get()
      const matrix = matrixId ? s0.wb.compensation.matrices.find((m) => m.id === matrixId) : undefined
      const ok = ids.filter((sid) => !matrix || matrix.parameters.every((p) => s0.files[sid]?.parameters.some((q) => q.name === p)))
      change((s) => {
        const assignments = { ...s.wb.compensation.assignments }
        for (const t of ok) { if (matrixId) assignments[t] = matrixId; else delete assignments[t] }
        return { wb: { ...s.wb, compensation: { ...s.wb.compensation, assignments } } }
      })
      const skipped = ids.length - ok.length
      set({ status: { kind: skipped ? 'error' : 'info', text: matrix ? `${matrix.name} applied to ${ok.length} sample(s)${skipped ? `; ${skipped} skipped because they lack one of its parameters` : ''}` : `Compensation removed from ${ids.length} sample(s)` } })
    },
    // Takes every gate off these samples (their populations other than All events). Can be undone.
    clearGating(ids) {
      const s = get()
      const gone = new Set(ids)
      const has = s.wb.populations.some((p) => p.id !== ROOT_ID && p.sampleId != null && gone.has(p.sampleId))
      if (!has) { set({ status: { kind: 'info', text: 'There are no gates to clear.' } }); return }
      if (!window.confirm(`Remove all the gates of ${ids.length === 1 ? s.wb.samples.find((x) => x.id === ids[0])?.name : `${ids.length} samples`}? ${s.wb.linkGates ? " With linked gates, the other samples of its group lose them too." : ""} You can undo this.`)) return
      change((st) => {
        const populations = st.wb.populations.filter((p) => !(p.id !== ROOT_ID && p.sampleId != null && gone.has(p.sampleId)))
        const used = new Set(populations.map((p) => p.gateId))
        return { wb: syncLinked({ ...st.wb, populations, gates: st.wb.gates.filter((g) => used.has(g.id)) }, ids.length === 1 ? ids[0] : null), popId: ROOT_ID, gatePopId: null }
      })
    },
    // The whole gating tree of one sample copied over the others (their own gating is replaced). Can be undone.
    copyGatingTo(sourceId, targetIds) {
      const s = get()
      const targets = targetIds.filter((id) => id !== sourceId)
      if (targets.length === 0) { set({ status: { kind: 'info', text: 'There are no other samples to copy the gating to.' } }); return }
      if (!window.confirm(`Replace the gating of ${targets.length} sample(s) with the gating of ${s.wb.samples.find((x) => x.id === sourceId)?.name}? You can undo this.`)) return
      const r = applyGateToGroup(s.wb, sourceId, ROOT_ID, true, targets)
      change(() => ({ wb: { ...s.wb, populations: r.populations, gates: r.gates } }))
      set({ status: { kind: 'info', text: `Gating copied to ${r.applied.length} sample(s)` } })
    },

    applyToGroup(resync, targets) {
      const s = get()
      const sid = s.sampleId
      if (!sid) return
      const peers = (targets ?? peersOf(s.wb, sid)).filter((id) => id !== sid)
      // the gate selected on the plot (just drawn, or clicked) wins; otherwise the population selected in the tree
      const target = s.gatePopId ?? s.popId
      if (peers.length === 0) { set({ status: { kind: 'info', text: targets ? 'There are no other samples there to apply it to.' : 'There are no other samples in this group.' } }); return }
      if (!resync && target === ROOT_ID) { set({ status: { kind: 'info', text: 'Select a gate to apply it to the group.' } }); return }
      if (resync && !window.confirm(`Replace the gating of ${peers.length} other sample(s) with this sample's gating? You can undo this.`)) return
      const r = applyGateToGroup(s.wb, sid, target, resync, targets ? peers : undefined)
      // a copied gate needs its parameters in the receiving sample; say so when one is missing
      const names = (id: string): Set<string> => {
        const f = s.files[id]
        const out = new Set(f ? f.parameters.map((p) => p.name) : [])
        const m = s.wb.compensation.matrices.find((x) => x.id === s.wb.compensation.assignments[id])
        if (m) for (const p of m.parameters) out.add(`Comp-${p}`)
        return out
      }
      const lacking = r.applied.filter((t) => {
        const have = names(t)
        return r.populations.some((p) => p.sampleId === t && r.gates.some((g) => g.id === p.gateId && (!have.has(g.xParam) || (g.yParam !== '' && !have.has(g.yParam)))))
      })
      change(() => ({ wb: { ...s.wb, populations: r.populations, gates: r.gates } }))
      const bits = [`Applied to ${r.applied.length} sample(s)`]
      if (r.skipped.length) bits.push(`${r.skipped.length} skipped: ${r.skipped.map((k) => `${s.wb.samples.find((x) => x.id === k.sampleId)?.name} ${k.reason}`).join('; ')}`)
      if (lacking.length) bits.push(`${lacking.length} lack a parameter used by a gate, so those gates are empty there`)
      set({ status: { kind: r.skipped.length || lacking.length ? 'error' : 'info', text: bits.join('. ') } })
    },

    undo: () => restore(undoStep(get().history, docOf(get().wb))),
    redo: () => restore(redoStep(get().history, docOf(get().wb))),

    setTheme(theme) {
      applyTheme(theme, true)
      set({ theme })
    },

    setStatus: (status) => set({ status }),
  }
})

