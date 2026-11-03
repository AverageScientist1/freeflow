import { DEFAULT_GROUP, DEFAULT_GROUP_NAME, ROOT_ID } from '@core/workbench'
import { groupIdOf, groupSubtree, groupTree, namePath, samplesInGroup } from '@core/groups'
import { populationsFor } from '@core/workbench'
import type { SortDir, SortKey } from '@core/sort'
import { getBridge } from './api'
import { markedSamples, useStore } from './store'
import type { MenuItem } from './ContextMenu'
import { DELETE_LABEL } from './platform'

// What the right-click menus offer. They are built when the menu opens, from the state of the program at that moment.

const state = () => useStore.getState()
const indent = (depth: number): string => '  '.repeat(depth)

export function sortItems(): MenuItem[] {
  const sort = (k: SortKey, d: SortDir) => (): void => state().sortSamples(k, d)
  const keywords = new Set<string>()
  for (const f of Object.values(state().files)) for (const k of Object.keys(f.keywords)) if (!/^(\$BEGIN|\$END|\$NEXTDATA|\$BYTEORD|\$DATATYPE|\$MODE|\$PAR|\$TOT|\$P\d|\$SPILL|\$COMP|FCSversion|\$TIMESTEP|\$FIL|\$DATE|\$BTIM|\$ETIM)/i.test(k)) keywords.add(k)
  return [
    { label: 'Name, natural (S2 before S10)', onSelect: sort('natural', 'asc') },
    { label: 'Name A to Z', onSelect: sort('name', 'asc') },
    { label: 'Name Z to A', onSelect: sort('name', 'desc') },
    { separator: true },
    { label: 'Most events first', onSelect: sort('events', 'desc') },
    { label: 'Fewest events first', onSelect: sort('events', 'asc') },
    { label: 'Oldest first', onSelect: sort('date', 'asc') },
    { label: 'Newest first', onSelect: sort('date', 'desc') },
    { label: 'By group', onSelect: sort('group', 'asc') },
    ...(keywords.size ? [{ label: 'By keyword', items: [...keywords].sort().map((k): MenuItem => ({ label: k, onSelect: sort(`kw:${k}`, 'asc') })) } as MenuItem] : []),
  ]
}

function groupChoices(ids: string[], pick: (gid: string) => void, exclude: string[] = []): MenuItem[] {
  const st = state()
  const current = new Set(ids.map((id) => groupIdOf(st.wb, id)))
  return groupTree(st.wb).filter((g) => !exclude.includes(g.id)).map((g): MenuItem => ({ label: indent(g.depth) + g.name, checked: current.size === 1 && current.has(g.id), onSelect: () => pick(g.id) }))
}

function newGroupName(): string {
  const used = new Set(state().wb.groups.map((g) => g.name))
  let n = 1
  while (used.has(`Group ${n}`)) n++
  return `Group ${n}`
}

// The menu of a sample (or of all the marked samples, when the one clicked is one of them).
export function sampleMenu(id: string, rename: (id: string) => void): MenuItem[] {
  const st = state()
  const marked = markedSamples(st)
  const ids = marked.includes(id) ? marked : [id]
  const one = ids.length === 1
  const sample = st.wb.samples.find((s) => s.id === id)
  if (!sample) return []
  const noun = one ? `"${sample.name}"` : `${ids.length} samples`
  const inGraphs = st.mode === 'graphs'
  const openPath = namePath(populationsFor(st.wb, st.sampleId), st.popId)
  const overlayOf = (sid: string) => st.overlays.find((o) => o.sampleId === sid && JSON.stringify(o.path) === JSON.stringify(openPath))
  const overlayTargets = ids.filter((sid) => !(sid === st.sampleId))
  const allOverlaid = overlayTargets.length > 0 && overlayTargets.every((sid) => overlayOf(sid))
  const inGroup = ids.some((sid) => st.wb.groupOf[sid] && st.wb.groups.some((g) => g.id === st.wb.groupOf[sid]))
  const inGroupView = st.groupFilter !== DEFAULT_GROUP
  const show = (mode: Parameters<typeof st.setMode>[0], view?: 'single' | 'samples' | 'sheet') => (): void => {
    st.selectSample(id)
    st.setMode(mode)
    if (mode === 'graphs') { st.setGallery(view === 'samples'); st.setSheet(view === 'sheet') }
  }
  const file = st.wb.samples.find((s) => s.id === id)?.source
  const path = file && file.kind === 'file' ? file.path : null
  const noFile = !path || !/[\\/]/.test(path)
  const allSamples = st.wb.samples.map((s) => s.id)
  const sameGroup = samplesInGroup(st.wb, groupIdOf(st.wb, id)).map((s) => s.id)
  const matrices = st.wb.compensation.matrices
  const assigned = one ? st.wb.compensation.assignments[id] : undefined

  return [
    { label: 'Show', items: [
      { label: 'As the single plot', onSelect: show('graphs', 'single') },
      { label: 'The same plot for all samples', disabled: st.wb.samples.length < 2, onSelect: show('graphs', 'samples') },
      { label: 'In the sheet', onSelect: show('graphs', 'sheet') },
      { separator: true },
      { label: 'Quality control', onSelect: show('qc') },
      { label: 'Metadata', onSelect: show('meta') },
      { label: 'Compensation', onSelect: show('compensation') },
      { label: 'In the Cluster Explorer', onSelect: show('cluster') },
    ] },
    { label: `Overlay ${noun} on the open plot`, checked: allOverlaid, disabled: !inGraphs || overlayTargets.length === 0, hint: inGraphs ? undefined : 'Graphs mode',
      onSelect: () => {
        if (allOverlaid) for (const sid of overlayTargets) { const o = overlayOf(sid); if (o) st.removeOverlay(o.id) }
        else st.addOverlays(overlayTargets.filter((sid) => !overlayOf(sid)).map((sid) => ({ id: crypto.randomUUID(), sampleId: sid, path: openPath })))
      } },
    { separator: true },
    { label: 'Rename…', hint: 'F2', disabled: !one, onSelect: () => rename(id) },
    { label: one ? 'Move to group' : `Move ${ids.length} samples to group`, items: [
      { label: `${DEFAULT_GROUP_NAME} (no group)`, checked: ids.every((sid) => groupIdOf(st.wb, sid) === DEFAULT_GROUP), onSelect: () => st.moveSamples(ids, DEFAULT_GROUP) },
      ...groupChoices(ids, (gid) => st.moveSamples(ids, gid)),
      { separator: true },
      { label: 'New group from the selection', onSelect: () => { st.addGroup(newGroupName()); const g = state().wb.groups[state().wb.groups.length - 1]; if (g) state().moveSamples(ids, g.id) } },
    ] },
    { label: 'Gates', items: [
      { label: `Copy the gating of "${sample.name}" to`, items: [
        { label: 'The other marked samples', disabled: ids.length < 2, onSelect: () => st.copyGatingTo(id, ids) },
        { label: 'The rest of its group', disabled: sameGroup.length < 2, onSelect: () => st.copyGatingTo(id, sameGroup) },
        { label: 'All samples', disabled: allSamples.length < 2, onSelect: () => st.copyGatingTo(id, allSamples) },
      ] },
      { label: `Clear the gates of ${noun}…`, danger: true, onSelect: () => st.clearGating(ids) },
    ] },
    { label: 'Compensation matrix', items: matrices.length === 0
      ? [{ label: 'No matrices yet', disabled: true }, { label: 'Open the compensation editor', onSelect: show('compensation') }]
      : [
        ...matrices.map((m): MenuItem => ({ label: m.name, checked: assigned === m.id, onSelect: () => st.assignMatrixTo(ids, m.id) })),
        { separator: true },
        { label: 'None', checked: one && !assigned, onSelect: () => st.assignMatrixTo(ids, null) },
      ] },
    { separator: true },
    { label: 'Export', items: [
      { label: `Statistics of ${noun} (CSV)…`, onSelect: () => void st.exportStats(ids) },
      { label: 'Statistics of all samples (CSV)…', onSelect: () => void st.exportStats() },
    ] },
    { label: 'File', items: [
      { label: 'Show in folder', disabled: noFile, onSelect: () => { if (path) void getBridge().reveal(path) } },
      { label: 'Copy the file path', disabled: noFile, onSelect: () => { if (path) void navigator.clipboard?.writeText(path).then(() => state().setStatus({ kind: 'info', text: 'File path copied' }), () => undefined) } },
    ] },
    { label: 'Sort the list', items: sortItems() },
    { separator: true },
    { label: one ? 'Remove from its group' : `Remove ${ids.length} samples from their groups`, disabled: !inGroup, hint: inGroupView ? DELETE_LABEL : undefined, onSelect: () => st.removeFromGroup(ids) },
    { label: one ? 'Remove from the Workbench…' : `Remove ${ids.length} samples from the Workbench…`, danger: true, hint: inGroupView ? undefined : DELETE_LABEL, onSelect: () => st.removeSamples(ids) },
  ]
}

// The menu of the empty part of the list of samples.
export function samplesBackgroundMenu(): MenuItem[] {
  const st = state()
  return [
    { label: 'Select all', onSelect: () => st.selectIds(samplesInGroup(st.wb, st.groupFilter).map((s) => s.id)), disabled: samplesInGroup(st.wb, st.groupFilter).length === 0 },
    { label: 'Sort the list', items: sortItems() },
    { separator: true },
    { label: 'Add FCS files…', onSelect: () => void st.pickFcs() },
    { label: 'Load a demo sample', onSelect: st.addDemo },
  ]
}

// The menu of a group in the list of groups.
export function groupMenu(gid: string, edit: { rename: (id: string) => void; newGroup: () => void; newSubgroup: (id: string) => void }): MenuItem[] {
  const st = state()
  const isAll = gid === DEFAULT_GROUP
  const g = st.wb.groups.find((x) => x.id === gid)
  const members = samplesInGroup(st.wb, gid)
  const below = isAll ? [] : groupSubtree(st.wb, gid)
  const openPath = namePath(populationsFor(st.wb, st.sampleId), st.popId)
  const inGraphs = st.mode === 'graphs'
  return [
    { label: 'New group', onSelect: edit.newGroup },
    { label: 'New subgroup here', disabled: isAll, onSelect: () => edit.newSubgroup(gid) },
    { label: 'Rename…', hint: 'F2', disabled: isAll, onSelect: () => edit.rename(gid) },
    { label: 'Move into', disabled: isAll, items: [
      { label: 'Top level', checked: !g?.parentId, onSelect: () => st.moveGroup(gid, null) },
      ...groupChoices([], (pid) => st.moveGroup(gid, pid), below).map((it) => ({ ...it, checked: false })),
    ] },
    { separator: true },
    { label: `Select its samples (${members.length})`, disabled: members.length === 0, onSelect: () => { st.selectGroup(gid); st.selectIds(members.map((s) => s.id)) } },
    { label: 'Overlay its samples on the open plot', disabled: !inGraphs || members.length === 0,
      onSelect: () => st.addOverlays(members.filter((m) => m.id !== st.sampleId).map((m) => ({ id: crypto.randomUUID(), sampleId: m.id, path: openPath }))) },
    { label: 'Sort its samples', items: sortItems() },
    { separator: true },
    { label: 'Delete the group', danger: true, disabled: isAll, hint: undefined, onSelect: () => st.deleteGroup(gid) },
  ]
}

// Where a gate (or a whole gating) can be applied from the open sample: every other sample, the groups it sits in (the top-level one down to
// its own subgroup, each with the samples of the groups below it), or the samples marked in the list.
export function applyScopeItems(popId: string | null, resync: boolean): MenuItem[] {
  const st = state()
  const sid = st.sampleId
  if (!sid) return [{ label: 'Open a sample first', disabled: true }]
  const others = (ids: string[]): string[] => ids.filter((id) => id !== sid)
  const run = (targets: string[]) => (): void => { if (popId && !resync) st.selectPop(popId); st.applyToGroup(resync, targets) }
  const items: MenuItem[] = []
  const all = others(st.wb.samples.map((s) => s.id))
  items.push({ label: `All samples (${all.length})`, disabled: all.length === 0, onSelect: run(all) })
  // from the group's top-level ancestor down to the sample's own group
  const chain: string[] = []
  let cur = st.wb.groups.find((g) => g.id === groupIdOf(st.wb, sid))
  while (cur && chain.length < 20) { chain.unshift(cur.id); const p: string | null | undefined = cur.parentId; cur = p ? st.wb.groups.find((g) => g.id === p) : undefined }
  const nameOf = (gid: string): string => { const parts: string[] = []; let c = st.wb.groups.find((g) => g.id === gid); while (c && parts.length < 20) { parts.unshift(c.name); const p: string | null | undefined = c.parentId; c = p ? st.wb.groups.find((g) => g.id === p) : undefined } return parts.join(' › ') }
  chain.forEach((gid, i) => {
    const ids = others(samplesInGroup(st.wb, gid).map((s) => s.id))
    const below = groupSubtree(st.wb, gid).length > 1
    items.push({ label: `${i === 0 ? 'Group' : 'Subgroup'} ${nameOf(gid)}${below && i === chain.length - 1 ? ' and what is below' : ''} (${ids.length})`, disabled: ids.length === 0, onSelect: run(ids) })
  })
  const marked = others(markedSamples(st))
  if (marked.length > 0) items.push({ separator: true }, { label: `The marked samples (${marked.length})`, onSelect: run(marked) })
  return items
}

// The two things that can be done with a gate and a scope, for the button under the population tree and for the population's own menu.
export function applyMenu(popId: string | null): MenuItem[] {
  return [
    { label: 'Apply the selected gate to', disabled: !popId || popId === ROOT_ID, items: applyScopeItems(popId, false) },
    { label: 'Replace the whole gating of', items: applyScopeItems(popId, true) },
  ]
}

// The menu of a population in the tree of the open sample.
export function populationMenu(popId: string, edit: { rename: (id: string) => void; boolean: () => void }): MenuItem[] {
  const st = state()
  const isRoot = popId === ROOT_ID
  const pops = populationsFor(st.wb, st.sampleId)
  const path = namePath(pops, popId)
  const others = st.wb.samples.length > 1
  return [
    { label: 'Show as the plot', onSelect: () => { st.selectPop(popId); st.setMode('graphs'); st.setGallery(false); st.setSheet(false) } },
    { label: 'Overlay on the open plot', disabled: st.mode !== 'graphs' || !st.sampleId, onSelect: () => { if (st.sampleId) st.addOverlays([{ id: crypto.randomUUID(), sampleId: st.sampleId, path }]) } },
    { label: 'Same population in all samples', disabled: !others || st.mode !== 'graphs', onSelect: () => st.addOverlays(st.wb.samples.filter((s) => s.id !== st.sampleId).map((s) => ({ id: crypto.randomUUID(), sampleId: s.id, path }))) },
    { separator: true },
    { label: 'Rename…', hint: 'F2', disabled: isRoot, onSelect: () => edit.rename(popId) },
    { label: 'Apply to its group', hint: 'Alt+G', disabled: isRoot, onSelect: () => { st.selectPop(popId); st.applyToGroup(false) } },
    { label: 'Apply to…', disabled: isRoot, items: applyScopeItems(popId, false) },
    { label: 'New boolean population…', onSelect: edit.boolean },
    { separator: true },
    { label: 'Delete', danger: true, disabled: isRoot, hint: DELETE_LABEL, onSelect: () => st.deletePop(popId) },
  ]
}
