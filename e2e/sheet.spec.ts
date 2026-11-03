import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, MAIN_CLUSTER, menu } from './helpers'

const sample = (page: Page, n: number) => page.getByRole('option', { name: new RegExp(`Demo sample ${n}`) })

async function threeSamples(page: Page): Promise<void> {
  await loadDemo(page)
  await menu(page, 'File', /Load demo sample/)
  await menu(page, 'File', /Load demo sample/)
  await sample(page, 1).click()
}

// Number of different colours in the points canvas of the big plot (density colours give many, plain dots give few).
async function colours(page: Page): Promise<number> {
  return page.locator('.gl-canvas').evaluate((c: HTMLCanvasElement) => {
    const t = document.createElement('canvas')
    t.width = c.width; t.height = c.height
    const ctx = t.getContext('2d')!
    ctx.drawImage(c, 0, 0)
    const d = ctx.getImageData(0, 0, t.width, t.height).data
    const seen = new Set<number>()
    for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3))
    return seen.size
  })
}

test.describe('moving through samples', () => {
  test('NAV-1 Up, Down, Home and End move through the sample list and the focus follows', async ({ page }) => {
    await threeSamples(page)
    await sample(page, 1).focus()
    await page.keyboard.press('ArrowDown')
    await expect(sample(page, 2)).toHaveAttribute('aria-selected', 'true')
    await expect(sample(page, 2)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(sample(page, 3)).toBeFocused()
    await page.keyboard.press('ArrowDown') // the end of the list: it stays
    await expect(sample(page, 3)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowUp')
    await expect(sample(page, 2)).toBeFocused()
    await page.keyboard.press('Home')
    await expect(sample(page, 1)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('End')
    await expect(sample(page, 3)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Demo sample 3').first()).toBeVisible()
  })

  test('NAV-2 Page Down and Page Up change sample from anywhere, and the plot follows', async ({ page }) => {
    await threeSamples(page)
    await drawRect(page, ...MAIN_CLUSTER) // leaves the focus in the plot area
    await page.keyboard.press('PageDown')
    await expect(sample(page, 2)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('treeitem', { name: /Gate 1/ })).toBeVisible() // the linked gate came along
    await page.keyboard.press('PageDown')
    await page.keyboard.press('PageUp')
    await expect(sample(page, 2)).toHaveAttribute('aria-selected', 'true')
  })

  test('NAV-3 the arrow keys move through the thumbnails of All samples', async ({ page }) => {
    await threeSamples(page)
    await page.getByRole('button', { name: 'All samples' }).click()
    await page.locator('.gallery').focus()
    await page.keyboard.press('ArrowRight')
    await expect(sample(page, 2)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowRight')
    await expect(sample(page, 3)).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(sample(page, 2)).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('smooth and raw', () => {
  test('RAW-1 raw draws plain dots, smooth draws density colours; the choice is remembered', async ({ page }) => {
    await loadDemo(page)
    const smooth = page.getByRole('group', { name: 'Display' }).getByRole('button', { name: 'Smooth' })
    const raw = page.getByRole('group', { name: 'Display' }).getByRole('button', { name: 'Raw' })
    await expect(smooth).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => colours(page)).toBeGreaterThan(12)
    await raw.click()
    await expect(raw).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => colours(page)).toBeLessThan(6)
    await page.reload()
    await page.getByRole('button', { name: 'Load demo sample' }).click()
    await expect(page.getByRole('group', { name: 'Display' }).getByRole('button', { name: 'Raw' })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('group', { name: 'Display' }).getByRole('button', { name: 'Smooth' }).click()
    await expect.poll(() => colours(page)).toBeGreaterThan(12)
  })

  test('RAW-2 a histogram is drawn differently raw and smooth, and smooth again gives the same picture', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('combobox', { name: 'Plot type' }).selectOption('histogram')
    await page.getByRole('combobox', { name: 'X', exact: true }).selectOption({ label: 'FL1-A :: Marker A FITC' })
    const picture = (): Promise<string> => page.locator('.overlay-canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL())
    await expect.poll(async () => (await picture()).length).toBeGreaterThan(1000)
    const smooth = await picture()
    await page.getByRole('group', { name: 'Display' }).getByRole('button', { name: 'Raw' }).click()
    await expect.poll(async () => (await picture()) !== smooth).toBe(true)
    await page.getByRole('group', { name: 'Display' }).getByRole('button', { name: 'Smooth' }).click()
    await expect.poll(async () => (await picture()) === smooth).toBe(true) // back to exactly the same picture
  })
})

test.describe('sheet', () => {
  test('SHEET-1 one plot per gate, the same plots for the next sample, edit and open', async ({ page }) => {
    await threeSamples(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: 'Sheet' }).click()
    await expect(page.getByText('The sheet is empty')).toBeVisible()
    await page.getByRole('button', { name: 'Plots from gates' }).click()
    const sheet = page.getByLabel('Sheet of plots')
    await expect(sheet.locator('figure')).toHaveCount(1)
    await expect(page.getByRole('img', { name: /Plot 1 of Demo sample 1: pseudocolor SSC-A against FSC-A, 20,000 events; Gate 1 59/ })).toBeVisible()
    // add the plot that is open, then change its axes
    await page.getByRole('button', { name: 'Add plot' }).click()
    await expect(sheet.locator('figure')).toHaveCount(2)
    await page.getByRole('combobox', { name: 'X of plot 2' }).selectOption('FL1-A')
    await page.getByRole('combobox', { name: 'Plot type of plot 2' }).selectOption('histogram')
    await expect(page.getByRole('img', { name: /Plot 2 of Demo sample 1: histogram FL1-A/ })).toBeVisible()
    // the next sample shows the same two plots, with its own numbers
    await page.getByRole('button', { name: 'Next sample' }).click()
    await expect(page.locator('.sheet-nav')).toContainText('Demo sample 2')
    await expect(page.getByRole('img', { name: /Plot 1 of Demo sample 2: pseudocolor SSC-A against FSC-A, 20,000 events; Gate 1 59/ })).toBeVisible()
    await expect(page.getByRole('img', { name: /Plot 2 of Demo sample 2: histogram FL1-A/ })).toBeVisible()
    // arrow keys on the sheet do the same
    await sheet.focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.sheet-nav')).toContainText('Demo sample 3')
    // opening a plot makes it the big one
    await page.getByRole('button', { name: 'Open plot 2 as the single plot' }).click()
    await expect(page.getByRole('combobox', { name: 'Plot type' })).toHaveValue('histogram')
    await expect(page.getByRole('combobox', { name: 'X', exact: true })).toHaveValue('FL1-A')
    // removing
    await page.getByRole('button', { name: 'Sheet' }).click()
    await page.getByRole('button', { name: 'Remove plot 2' }).click()
    await expect(sheet.locator('figure')).toHaveCount(1)
    await page.getByRole('button', { name: 'Clear sheet' }).click()
    await expect(page.getByText('The sheet is empty')).toBeVisible()
  })

  test('SHEET-2 the sheet is saved with the Workbench and thumbnails can change size', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Sheet' }).click()
    await page.getByRole('button', { name: 'Add plot' }).click()
    const tile = page.locator('.sheet figure canvas')
    const medium = (await tile.boundingBox())!
    await page.getByRole('slider', { name: 'Thumbnail size' }).fill('450')
    await expect.poll(async () => (await tile.boundingBox())!.width).toBeGreaterThan(medium.width + 50)
    await page.getByRole('slider', { name: 'Thumbnail size' }).fill('150')
    await expect.poll(async () => (await tile.boundingBox())!.width).toBeLessThan(medium.width - 30)
    // the dirty mark shows the sheet is part of the work that gets saved
    await expect(page.locator('.wb-name')).toContainText('•')
  })

  test('SHEET-3 gates are drawn inside the sheet, the thumbnails follow, and the editor and the tile stay in step', async ({ page }) => {
    await threeSamples(page)
    await page.getByRole('button', { name: 'Sheet' }).click()
    await page.getByRole('button', { name: 'Add plot' }).click()
    await expect(page.getByRole('region', { name: 'Plot editor' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Edit gates of plot 1' }).click()
    const editor = page.getByRole('region', { name: 'Plot editor' })
    await expect(editor).toBeVisible()
    await expect(editor.locator('.plot-box')).toBeVisible()
    await drawRect(page, ...MAIN_CLUSTER)
    await expect(page.getByRole('treeitem', { name: /Gate 1/ })).toBeVisible()
    // the thumbnail of the same plot now carries the gate and its share
    await expect(page.getByRole('img', { name: /Plot 1 of Demo sample 1: pseudocolor SSC-A against FSC-A, 20,000 events; Gate 1 59/ })).toBeVisible()
    // changing the axes in the editor changes the tile
    await editor.getByRole('combobox', { name: 'X', exact: true }).selectOption({ label: 'FL1-A :: Marker A FITC' })
    await expect(page.getByRole('img', { name: /Plot 1 of Demo sample 1: pseudocolor SSC-A against FL1-A/ })).toBeVisible()
    // and the next sample is edited with the same plot
    await page.keyboard.press('PageDown')
    await expect(page.locator('.sheet-nav')).toContainText('Demo sample 2')
    await expect(editor.getByRole('group', { name: /Plot of SSC-A against FL1-A/ })).toBeVisible()
    await editor.getByRole('button', { name: 'Close editor' }).click()
    await expect(editor).toHaveCount(0)
  })
  test('SHEET-A11Y the sheet and gallery have no serious accessibility violations', async ({ page }) => {
    const { default: AxeBuilder } = await import('@axe-core/playwright')
    await threeSamples(page)
    await drawRect(page, ...MAIN_CLUSTER)
    for (const view of ['Sheet', 'All samples']) {
      await page.getByRole('button', { name: view }).click()
      if (view === 'Sheet') await page.getByRole('button', { name: 'Plots from gates' }).click()
      await page.waitForTimeout(300)
      const r = await new AxeBuilder({ page }).analyze()
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.map((v) => `${view}: ${v.id}: ${v.nodes.length} nodes (${v.help})`)).toEqual([])
    }
  })
})
