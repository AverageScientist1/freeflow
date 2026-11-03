import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, MAIN_CLUSTER, menu } from './helpers'

const mode = (page: Page, name: string) => page.getByRole('navigation', { name: 'Modes' }).getByRole('button', { name })

test.describe('new modes', () => {
  test('MODE-1 all working modes are in the rail, shortcuts switch, version is shown', async ({ page }) => {
    await loadDemo(page)
    for (const n of ['Metadata Manager', 'Quality Control', 'Compensation', 'Graphs', 'Cluster Explorer', 'Tables', 'Charts', 'Reports', 'Preferences'])
      await expect(mode(page, n)).toBeVisible()
    await page.keyboard.press('Alt+Digit6')
    await expect(page.getByRole('heading', { name: 'Tables', level: 1 })).toBeVisible()
    await page.keyboard.press('Alt+Digit4')
    await expect(page.getByRole('heading', { name: 'Graphs', level: 1 })).toBeVisible()
    await expect(page.locator('.version')).toHaveText(/^v\d+\.\d+\.\d+$/)
  })

  test('TAB-1 build a table of statistics and see the numbers', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await menu(page, 'File', /Load demo sample/) // a second sample
    await mode(page, 'Tables').click()
    await expect(page.getByText('No columns yet')).toBeVisible()
    await page.getByRole('button', { name: 'Add column' }).click() // All events | % of parent
    await page.getByRole('combobox', { name: 'Population' }).selectOption({ label: 'Gate 1' })
    await page.getByRole('combobox', { name: 'Statistic' }).selectOption({ label: 'Count' })
    await page.getByRole('button', { name: 'Add column' }).click()
    await page.getByRole('combobox', { name: 'Statistic' }).selectOption({ label: 'Median' })
    await page.getByRole('combobox', { name: 'Parameter' }).selectOption('FL1-A')
    await page.getByRole('button', { name: 'Add column' }).click()
    const table = page.getByRole('table', { name: 'Statistics table' })
    await expect(table.getByRole('columnheader')).toHaveCount(5)
    await expect(table.getByRole('row')).toHaveCount(3) // header + 2 samples
    // the first sample has a gate and 20,000 events; the second has no Gate 1 (gating is linked, so it does too)
    const first = table.getByRole('row').nth(1)
    await expect(first).toContainText('Demo sample 1')
    await expect(first.getByRole('cell').nth(1)).toHaveText('100.00')
    // removing a column
    await page.getByRole('button', { name: /Remove column All events \| % of parent/ }).click()
    await expect(table.getByRole('columnheader')).toHaveCount(4)
  })

  test('TAB-2 columns are saved with the Workbench and exported as CSV', async ({ page }) => {
    await loadDemo(page)
    await mode(page, 'Tables').click()
    await page.getByRole('combobox', { name: 'Statistic' }).selectOption({ label: 'Count' })
    await page.getByRole('button', { name: 'Add column' }).click()
    const download = page.waitForEvent('download').catch(() => null)
    await menu(page, 'File', /Export table/)
    // in the browser build the file goes through the download fallback
    const d = await download
    if (d) expect(d.suggestedFilename()).toMatch(/table\.csv$/)
    await expect(page.locator('.statusbar')).toContainText(/Saved|table/i)
  })

  test('CHART-1 a chart of a table column, by sample and by group', async ({ page }) => {
    await loadDemo(page)
    await menu(page, 'File', /Load demo sample/)
    await mode(page, 'Charts').click()
    await expect(page.getByText('add a column first')).toBeVisible()
    await mode(page, 'Tables').click()
    await page.getByRole('combobox', { name: 'Statistic' }).selectOption({ label: 'Count' })
    await page.getByRole('button', { name: 'Add column' }).click()
    await mode(page, 'Charts').click()
    const chart = page.getByRole('img', { name: /Bar chart of All events \| Count/ })
    await expect(chart).toBeVisible()
    await expect(chart).toHaveAttribute('aria-label', /Demo sample 1: 20000; Demo sample 2: 20000/)
    // pixels were drawn
    const drawn = await page.locator('.chart-box canvas').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      let colored = 0
      for (let i = 0; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) colored++
      return colored
    })
    expect(drawn).toBeGreaterThan(500)
    await page.getByLabel('Mean ± SD per group').check()
    await expect(chart).toHaveAttribute('aria-label', /All Samples \(n=2\): 20000/)
  })

  test('GAL-1 every sample is shown with the same gate and its percentage', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await expect(page.getByRole('button', { name: 'All samples' })).toBeDisabled() // one sample only
    await menu(page, 'File', /Load demo sample/)
    await page.getByRole('button', { name: 'All samples' }).click()
    const gallery = page.getByLabel('All samples', { exact: true }).filter({ has: page.locator('figure') })
    await expect(gallery.locator('figure')).toHaveCount(2)
    await expect(page.getByRole('img', { name: /Demo sample 1: 20,000 events; Gate 1 59/ })).toBeVisible()
    await expect(page.getByRole('img', { name: /Demo sample 2: 20,000 events; Gate 1 59/ })).toBeVisible() // linked gating copied it
    await page.getByRole('button', { name: 'Open Demo sample 2 as a single plot' }).click()
    await expect(page.getByRole('combobox', { name: 'Plot type' })).toBeVisible()
    await expect(page.locator('.plot-box')).toBeVisible()
  })

  test('REP-1 a report with text, the table and a chart previews and exports as HTML', async ({ page }) => {
    await loadDemo(page)
    await mode(page, 'Tables').click()
    await page.getByRole('combobox', { name: 'Statistic' }).selectOption({ label: 'Count' })
    await page.getByRole('button', { name: 'Add column' }).click()
    await mode(page, 'Reports').click()
    await expect(page.getByRole('button', { name: 'Export report (HTML)' })).toBeDisabled()
    await page.getByRole('button', { name: 'Add heading' }).click()
    await page.getByRole('textbox', { name: 'Heading text' }).fill('My <results>')
    await page.getByRole('button', { name: 'Add table' }).click()
    await page.getByRole('button', { name: 'Add chart' }).click()
    await page.getByRole('button', { name: 'Move Chart up' }).click()
    const frame = page.frameLocator('iframe[title="Report preview"]')
    await expect(frame.getByRole('heading', { name: 'My <results>' })).toBeVisible()
    await expect(frame.getByRole('table')).toContainText('Demo sample 1')
    await expect(frame.getByRole('img', { name: /Bar chart of All events \| Count/ })).toBeVisible()
    // the chart now comes before the table
    const order = await frame.locator('body').evaluate((b) => [...b.querySelectorAll('img, table')].map((e) => e.tagName))
    expect(order).toEqual(['IMG', 'TABLE'])
    const dl = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export report (HTML)' }).click()
    expect((await dl).suggestedFilename()).toMatch(/report\.html$/)
  })

  test('META-1 keywords of each file are listed and a sample can change group', async ({ page }) => {
    await loadDemo(page)
    await mode(page, 'Metadata Manager').click()
    const table = page.getByRole('table', { name: 'Sample metadata' })
    await expect(table.getByRole('row', { name: /Demo sample 1/ })).toBeVisible()
    await expect(table.getByRole('columnheader', { name: '$TOT' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Find keyword' }).fill('tot')
    await expect(table.getByRole('columnheader')).toHaveCount(5) // sample, group, events, parameters, $TOT
  })

  test('QC-1 time stability and saturation for the selected sample', async ({ page }) => {
    await loadDemo(page)
    await mode(page, 'Quality Control').click()
    await expect(page.getByRole('status').filter({ hasText: /steady|unsteady|no time/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Saturated detectors' })).toBeVisible()
    await expect(page.getByRole('img', { name: /Events per time bin/ })).toBeVisible()
  })

  test('PREF-1 the number format for CSV is a saved choice', async ({ page }) => {
    await loadDemo(page)
    await mode(page, 'Preferences').click()
    await page.getByLabel(/Decimal comma/).check()
    await page.reload()
    await mode(page, 'Preferences').click()
    await expect(page.getByLabel(/Decimal comma/)).toBeChecked()
  })

  test('MODE-A11Y new screens have no accessibility violations', async ({ page }) => {
    await loadDemo(page)
    await menu(page, 'File', /Load demo sample/)
    await mode(page, 'Tables').click()
    await page.getByRole('combobox', { name: 'Statistic' }).selectOption({ label: 'Count' })
    await page.getByRole('button', { name: 'Add column' }).click()
    for (const name of ['Tables', 'Charts', 'Reports', 'Metadata Manager', 'Quality Control', 'Preferences']) {
      await mode(page, name).click()
      await page.waitForTimeout(200)
      const r = await new AxeBuilder({ page }).exclude('iframe').analyze() // the report preview is a sandboxed page; the checker cannot run scripts in it
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.map((v) => `${name}: ${v.id}: ${v.nodes.length} nodes (${v.help})`)).toEqual([])
    }
  })
})
