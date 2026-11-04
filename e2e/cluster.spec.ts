import type { Page } from '@playwright/test'
import { test, expect, loadDemo, menu } from './helpers'

const mode = (page: Page, name: string) => page.getByRole('navigation', { name: 'Modes' }).getByRole('button', { name })

async function threeSamples(page: Page): Promise<void> {
  await loadDemo(page)
  await menu(page, 'File', /Load demo sample/)
  await menu(page, 'File', /Load demo sample/)
  await page.getByRole('option', { name: /Demo sample 1/ }).click()
  await mode(page, 'Cluster Explorer').click()
}

test.describe('cluster explorer', () => {
  test('CLU-1 a UMAP map of one sample, clusters, heat map, highlight and colour by marker', async ({ page }) => {
    await threeSamples(page)
    await expect(page.getByText('No map yet')).toBeVisible()
    await page.getByRole('spinbutton', { name: 'Events per sample' }).fill('500')
    await page.getByRole('spinbutton', { name: 'Clusters' }).fill('4')
    await page.getByRole('button', { name: 'Run' }).click()
    const map = page.getByRole('img', { name: /UMAP map of 500 events from 1 sample\(s\), 4 clusters/ })
    await expect(map).toBeVisible({ timeout: 60000 })
    const table = page.getByRole('table', { name: 'Clusters and their markers' })
    await expect(table.getByRole('row')).toHaveCount(5) // header + 4
    await expect(table.getByRole('columnheader', { name: 'FL1-A' })).toBeVisible()
    const counts = await table.locator('tbody tr td:nth-child(2)').allInnerTexts()
    expect(counts.map((c) => Number(c.replace(/\D/g, ''))).reduce((a, b) => a + b, 0)).toBe(500)
    // the picture has colour in it
    const colours = await page.locator('.chart-box canvas').evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      const seen = new Set<number>()
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
      return seen.size
    })
    expect(colours).toBeGreaterThan(4)
    // highlight one cluster
    const first = table.getByRole('button', { name: /Cluster 1/ })
    await first.click()
    await expect(first).toHaveAttribute('aria-pressed', 'true')
    await first.click()
    await expect(first).toHaveAttribute('aria-pressed', 'false')
    await page.getByRole('combobox', { name: 'Colour by' }).selectOption('p:FL1-A')
    await expect(map).toBeVisible()
    // it survives a visit to another mode
    await mode(page, 'Tables').click()
    await mode(page, 'Cluster Explorer').click()
    await expect(map).toBeVisible()
  })

  test('CLU-2 the whole group joins into one map, with each sample weighing the same and a share table', async ({ page }) => {
    await threeSamples(page)
    await page.getByLabel(/The whole group/).check()
    await page.getByRole('spinbutton', { name: 'Events per sample' }).fill('300')
    await page.getByRole('spinbutton', { name: 'Clusters' }).fill('3')
    await page.getByRole('button', { name: 'Run' }).click()
    await expect(page.getByRole('img', { name: /UMAP map of 900 events from 3 sample\(s\), 3 clusters/ })).toBeVisible({ timeout: 60000 })
    await page.getByRole('combobox', { name: 'Colour by' }).selectOption('sample')
    await expect(page.getByRole('list', { name: 'Samples' }).getByRole('listitem')).toHaveCount(3)
    const share = page.getByRole('table', { name: 'Share of each sample in each cluster' })
    await expect(share.getByRole('columnheader')).toHaveCount(4)
    // each sample's shares add up to 100%
    const col = (await share.locator('tbody tr td:nth-child(2)').allInnerTexts()).map((v) => parseFloat(v.replace(',', '.')))
    expect(col.reduce((a, b) => a + b, 0)).toBeGreaterThan(99.5)
    expect(col.reduce((a, b) => a + b, 0)).toBeLessThan(100.5)
  })

  test('CLU-3 asks for two parameters, and re-clustering changes the number of clusters', async ({ page }) => {
    await threeSamples(page)
    await page.getByRole('button', { name: 'None' }).click()
    await page.getByRole('button', { name: 'Run' }).click()
    await expect(page.getByRole('alert')).toContainText('at least two parameters')
    await page.getByRole('button', { name: 'Markers' }).click()
    await page.getByRole('spinbutton', { name: 'Events per sample' }).fill('400')
    await page.getByRole('spinbutton', { name: 'Clusters' }).fill('3')
    await page.getByRole('button', { name: 'Run' }).click()
    const table = page.getByRole('table', { name: 'Clusters and their markers' })
    await expect(table.getByRole('row')).toHaveCount(4, { timeout: 60000 })
    await page.getByRole('spinbutton', { name: 'Clusters' }).fill('6')
    await page.getByRole('button', { name: 'Re-cluster' }).click()
    await expect(table.getByRole('row')).toHaveCount(7)
  })

  test('CLU-4 t-SNE works, a run can be cancelled, and the events can be exported', async ({ page }) => {
    test.slow(!!process.env['CI'], 'heavy on a shared CI machine')
    await threeSamples(page)
    await page.getByLabel(/t-SNE/).check()
    await page.getByRole('spinbutton', { name: 'Events per sample' }).fill('2000')
    await page.getByRole('button', { name: 'Run' }).click()
    await expect(page.getByRole('progressbar', { name: 'Progress' })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByText('No map yet')).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0) // cancelling is not an error
    await page.getByRole('spinbutton', { name: 'Events per sample' }).fill('300')
    await page.getByRole('button', { name: 'Run' }).click()
    await expect(page.getByRole('img', { name: /t-SNE map of 300 events/ })).toBeVisible({ timeout: 60000 })
    const csv = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export events (CSV)' }).click()
    expect((await csv).suggestedFilename()).toMatch(/clusters\.csv$/)
    const png = page.waitForEvent('download')
    await menu(page, 'File', /Export plot or chart image/)
    expect((await png).suggestedFilename()).toMatch(/\.png$/)
  })

  test('CLU-A11Y the explorer has no serious accessibility violations', async ({ page }) => {
    const { default: AxeBuilder } = await import('@axe-core/playwright')
    await threeSamples(page)
    await page.getByRole('spinbutton', { name: 'Events per sample' }).fill('300')
    await page.getByRole('button', { name: 'Run' }).click()
    await expect(page.getByRole('img', { name: /UMAP map/ })).toBeVisible({ timeout: 60000 })
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      if (scheme === 'dark') await page.getByRole('button', { name: /Switch to dark mode/ }).click()
      const r = await new AxeBuilder({ page }).analyze()
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.map((v) => `${scheme}: ${v.id}: ${v.nodes.length} nodes (${v.help})`)).toEqual([])
    }
  })
})
