import { describe, it, expect } from 'vitest'
import { escapeHtml, reportHtml, type ReportInput } from '../src/core/report'
import { emptyWorkbench, parseWorkbench } from '../src/core/workbench'
import { formatStat } from '../src/core/table'

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  title: 'WT vs <KO> & "co"',
  date: '1/1/2026',
  groupName: 'All Samples',
  blocks: [],
  columns: [{ id: 'c', path: ['FITC+'], stat: 'freqParent' }],
  rows: [{ sampleId: 's', name: '<img src=x onerror=alert(1)>.fcs', group: 'G', values: [59.381] }],
  format: (c, v) => formatStat(c.stat, v),
  chartImages: {},
  ...over,
})

describe('report page', () => {
  it('escapes everything a person typed or a file name contains', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
    const html = reportHtml(input({ blocks: [{ id: '1', kind: 'heading', text: '<script>x</script>' }, { id: '2', kind: 'text', text: 'a < b' }, { id: '3', kind: 'table' }] }))
    expect(html).not.toContain('<script>x')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;x&lt;/script&gt;')
    expect(html).toContain('<title>WT vs &lt;KO&gt; &amp; &quot;co&quot;</title>')
  })

  it('keeps block order and writes the table with formatted numbers', () => {
    const html = reportHtml(input({ blocks: [{ id: '1', kind: 'text', text: 'first' }, { id: '2', kind: 'table' }, { id: '3', kind: 'text', text: 'last' }] }))
    expect(html.indexOf('first')).toBeLessThan(html.indexOf('<table'))
    expect(html.indexOf('<table')).toBeLessThan(html.indexOf('last'))
    expect(html).toContain('FITC+ | % of parent')
    expect(html).toContain('59.38')
  })

  it('says so for a table with no columns and a chart whose column is gone', () => {
    const html = reportHtml(input({ columns: [], rows: [], blocks: [{ id: '1', kind: 'table' }, { id: '2', kind: 'chart', colId: 'gone', by: 'sample' }] }))
    expect(html).toContain('The table has no columns yet.')
    expect(html).toContain('missing its table column')
  })

  it('embeds a chart image', () => {
    const html = reportHtml(input({ blocks: [{ id: 'k', kind: 'chart', colId: 'c', by: 'group' }], chartImages: { k: 'data:image/png;base64,AAAA' } }))
    expect(html).toContain('<img alt="Bar chart of FITC+ | % of parent" src="data:image/png;base64,AAAA">')
  })
})

describe('report in the Workbench file', () => {
  it('round-trips and rejects a damaged one', () => {
    const wb = emptyWorkbench('t')
    wb.report = [{ id: 'a', kind: 'heading', text: 'Hi' }, { id: 'b', kind: 'chart', colId: 'c', by: 'group' }]
    expect(parseWorkbench(JSON.stringify(wb)).report).toEqual(wb.report)
    expect(() => parseWorkbench(JSON.stringify({ ...wb, report: [{ id: 'a', kind: 'chart', colId: 'c', by: 'sideways' }] }))).toThrow(/report/)
    expect(() => parseWorkbench(JSON.stringify({ ...wb, report: [{ id: 'a', kind: 'video' }] }))).toThrow(/report/)
  })
})
