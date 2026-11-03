import { describe, it, expect } from 'vitest'
import { acquisitionTime, moveBefore, naturalCompare, nudge, sortSamples } from '../src/core/sort'
import { emptyWorkbench, type Workbench } from '../src/core/workbench'
import { parseFcs } from '../src/core/fcs'
import { makeDemoFcs } from '../src/core/synth'

const file = (events: number, kw: Record<string, string> = {}) => ({ ...parseFcs(makeDemoFcs(1, 50)), eventCount: events, keywords: { ...parseFcs(makeDemoFcs(1, 50)).keywords, ...kw } })

function build(): { wb: Workbench; files: Record<string, ReturnType<typeof file>> } {
  const wb = emptyWorkbench('t')
  wb.samples = ['S10', 'S2', 'S1', 'ko', 'WT', 'gone'].map((n, i) => ({ id: `s${i}`, name: `${n}.fcs`, source: { kind: 'demo' as const, seed: 1 } }))
  wb.groups = [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Beta' }]
  wb.groupOf = { s0: 'B', s1: 'A', s2: 'A' }
  const files = {
    s0: file(500, { $DATE: '03-NOV-2026', $BTIM: '09:00:00', TUBE: 'tube 10' }),
    s1: file(9000, { $DATE: '27-Oct-26', $BTIM: '14:30:00', TUBE: 'tube 2' }),
    s2: file(100, { $DATE: '2026-10-27', $BTIM: '08:00:00', TUBE: 'tube 1' }),
    s3: file(700),
    s4: file(700, { $DATE: '01-JAN-2027' }),
  }
  return { wb, files }
}
const names = (r: { name: string }[]): string[] => r.map((s) => s.name.replace('.fcs', ''))

describe('sorting samples', () => {
  const { wb, files } = build()

  it('natural order puts Sample 2 before Sample 10; plain name order does not care for numbers', () => {
    expect(naturalCompare('S2', 'S10')).toBeLessThan(0)
    expect(names(sortSamples(wb, files, 'natural'))).toEqual(['gone', 'ko', 'S1', 'S2', 'S10', 'WT'])
    expect(names(sortSamples(wb, files, 'name'))).toEqual(['gone', 'ko', 'S1', 'S10', 'S2', 'WT'])
    expect(names(sortSamples(wb, files, 'natural', 'desc'))).toEqual(['WT', 'S10', 'S2', 'S1', 'ko', 'gone'])
  })

  it('by events, with the sample without a file last in either direction, and ties by name', () => {
    expect(names(sortSamples(wb, files, 'events'))).toEqual(['S1', 'S10', 'ko', 'WT', 'S2', 'gone'])
    expect(names(sortSamples(wb, files, 'events', 'desc'))).toEqual(['S2', 'ko', 'WT', 'S10', 'S1', 'gone'])
  })

  it('by date acquired reads several date styles and the time; no date goes last', () => {
    expect(names(sortSamples(wb, files, 'date'))).toEqual(['S1', 'S2', 'S10', 'WT', 'ko', 'gone'])
    expect(names(sortSamples(wb, files, 'date', 'desc'))).toEqual(['WT', 'S10', 'S2', 'S1', 'ko', 'gone'])
  })

  it('by a keyword, in natural order', () => {
    expect(names(sortSamples(wb, files, 'kw:TUBE'))).toEqual(['S1', 'S2', 'S10', 'ko', 'WT', 'gone'])
  })

  it('by group: no group first, then the groups in the order they are listed', () => {
    expect(names(sortSamples(wb, files, 'group'))).toEqual(['gone', 'ko', 'WT', 'S1', 'S2', 'S10'])
  })

  it('reads dates', () => {
    expect(acquisitionTime(file(1, { $DATE: '27-OCT-2026', $BTIM: '14:03:22' }))).toBe(Date.UTC(2026, 9, 27, 14, 3, 22))
    expect(acquisitionTime(file(1, { $DATE: '5-Mar-99' }))).toBe(Date.UTC(1999, 2, 5))
    expect(acquisitionTime(file(1, { $DATE: 'yesterday' }))).toBeNull()
  })
})

describe('moving samples by hand', () => {
  const s = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id, source: { kind: 'demo' as const, seed: 1 } }))
  const ids = (r: { id: string }[]): string => r.map((x) => x.id).join('')

  it('moves a block before another sample, or to the end', () => {
    expect(ids(moveBefore(s, ['d'], 'b'))).toBe('adbce')
    expect(ids(moveBefore(s, ['a', 'b'], 'e'))).toBe('cdabe')
    expect(ids(moveBefore(s, ['a'], null))).toBe('bcdea')
    expect(ids(moveBefore(s, ['a'], 'nope'))).toBe('abcde')
  })

  it('moves one place up or down among the samples that are shown', () => {
    expect(ids(nudge(s, ['a', 'b', 'c', 'd', 'e'], ['c'], -1))).toBe('acbde')
    expect(ids(nudge(s, ['a', 'b', 'c', 'd', 'e'], ['c'], 1))).toBe('abdce')
    expect(ids(nudge(s, ['a', 'b', 'c', 'd', 'e'], ['a'], -1))).toBe('abcde') // already first
    expect(ids(nudge(s, ['a', 'b', 'c', 'd', 'e'], ['e'], 1))).toBe('abcde')
    expect(ids(nudge(s, ['a', 'b', 'c', 'd', 'e'], ['b', 'c'], 1))).toBe('adbce')
    // only some are shown: it jumps over the hidden ones
    expect(ids(nudge(s, ['a', 'c', 'e'], ['c'], 1))).toBe('abdec') // c lands after e
  })
})
