import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, MAIN_CLUSTER, popRow, rowNumbers, menu } from './helpers'

const plotType = (page: Page) => page.getByRole('combobox', { name: 'Plot type' })

// Pixels of the overlay canvas that are not transparent: axes and gates only for a pseudocolor plot, much more with lines or fills.
async function inked(page: Page): Promise<number> {
  return page.locator('.overlay-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  })
}

test.describe('contour and zebra plots', () => {
  test('CONT-1 contour and zebra draw lines and fills; zebra fills more', async ({ page }) => {
    await loadDemo(page)
    await expect(page.locator('.gl-canvas')).toBeVisible()
    const base = await inked(page)
    await plotType(page).selectOption('contour')
    await expect(page.getByRole('combobox', { name: 'Contour lines' })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Outliers' })).toBeChecked()
    await expect.poll(() => inked(page)).toBeGreaterThan(base + 1500)
    const contour = await inked(page)
    await plotType(page).selectOption('zebra')
    await expect.poll(() => inked(page)).toBeGreaterThan(contour + 5000)
    await plotType(page).selectOption('pseudocolor')
    await expect(page.getByRole('combobox', { name: 'Contour lines' })).toHaveCount(0)
  })

  test('CONT-2 more lines draw more ink; outliers can be turned off', async ({ page }) => {
    await loadDemo(page)
    await plotType(page).selectOption('contour')
    const lines = page.getByRole('combobox', { name: 'Contour lines' })
    await lines.selectOption('5')
    await expect.poll(async () => inked(page)).toBeGreaterThan(0)
    await page.waitForTimeout(200)
    const few = await inked(page)
    await lines.selectOption('20')
    await expect.poll(() => inked(page)).toBeGreaterThan(few)
    const withOutliers = await inked(page)
    await page.getByRole('checkbox', { name: 'Outliers' }).uncheck()
    await expect.poll(() => inked(page)).toBeLessThan(withOutliers)
  })

  test('CONT-3 gates are drawn and counted on a contour plot like on any other', async ({ page }) => {
    await loadDemo(page)
    await plotType(page).selectOption('contour')
    await drawRect(page, ...MAIN_CLUSTER)
    const row = popRow(page, /Gate 1/)
    await expect(row).toBeVisible()
    const n = await rowNumbers(row)
    expect(n.count).toBeGreaterThan(5000)
    // looking inside the gate gives the plot of that population only
    await row.click()
    await expect(page.getByRole('group', { name: /Plot of SSC-A against FSC-A/ })).toBeVisible()
  })

  test('CONT-4 the gallery shows the chosen style for every sample', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await menu(page, 'File', /Load demo sample/)
    await plotType(page).selectOption('zebra')
    await page.getByRole('button', { name: 'All samples' }).click()
    await expect(page.getByRole('combobox', { name: 'Plot type' })).toHaveValue('zebra')
    const tiles = page.locator('.gallery figure canvas')
    await expect(tiles).toHaveCount(2)
    const colored = await tiles.first().evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
      const seen = new Set<number>()
      for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
      return seen.size
    })
    expect(colored).toBeGreaterThan(3) // background, axes, two zebra tones, lines
    await expect(page.getByRole('img', { name: /Demo sample 2: 20,000 events; Gate 1 59/ })).toBeVisible()
  })

  test('CONT-5 the picture can be exported as a PNG', async ({ page }) => {
    await loadDemo(page)
    await plotType(page).selectOption('contour')
    const dl = page.waitForEvent('download')
    await menu(page, 'File', /Export plot or chart image/)
    expect((await dl).suggestedFilename()).toMatch(/\.png$/)
  })
})
