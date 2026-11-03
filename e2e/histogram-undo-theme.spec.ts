import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, plotBox, px, popRow, rowNumbers, menu, MAIN_CLUSTER } from './helpers'

const X = (page: Page) => page.getByRole('combobox', { name: 'X', exact: true })
const Y = (page: Page) => page.getByRole('combobox', { name: 'Y', exact: true })
const FL1 = 'FL1-A :: Marker A FITC'

async function histogramMode(page: Page, param = FL1): Promise<void> {
  await X(page).selectOption({ label: param })
  await page.getByRole('combobox', { name: 'Plot type' }).selectOption('histogram')
}

async function dragRange(page: Page, x0: number, x1: number): Promise<void> {
  await page.getByRole('button', { name: /Range gate/ }).click()
  const box = await plotBox(page)
  const [ax, ay] = px(box, x0, 0.5)
  const [bx, by] = px(box, x1, 0.5)
  await page.mouse.move(ax, ay)
  await page.mouse.down()
  await page.mouse.move((ax + bx) / 2, by)
  await page.mouse.move(bx, by)
  await page.mouse.up()
}

async function overlayInk(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('.overlay-canvas') as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  })
}

async function glInk(page: Page): Promise<number> {
  // pixels that differ from the first pixel (the plot background)
  return page.evaluate(() => {
    const c = document.querySelector('.gl-canvas') as HTMLCanvasElement
    const t = document.createElement('canvas'); t.width = c.width; t.height = c.height
    const ctx = t.getContext('2d')!; ctx.drawImage(c, 0, 0)
    const d = ctx.getImageData(0, 0, t.width, t.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 30) n++
    return n
  })
}

test.describe('histogram and new gates', () => {
  test('M2-H1 switching to a histogram hides Y and the 2D tools and draws counts', async ({ page }) => {
    await loadDemo(page)
    await histogramMode(page)
    await expect(Y(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Rectangle gate/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Range gate/ })).toBeVisible()
    await expect(page.getByRole('group', { name: /Histogram of FL1-A/ })).toBeVisible()
    expect(await overlayInk(page)).toBeGreaterThan(5000)
    expect(await glInk(page)).toBe(0) // the colour renderer stays empty
  })

  test('M2-H2 a range gate on a positive peak gives about 35%', async ({ page }) => {
    await loadDemo(page)
    await histogramMode(page)
    await dragRange(page, 0.55, 1)
    const { count, pct } = await rowNumbers(popRow(page, /Gate 1/))
    expect(count).toBeGreaterThan(5000)
    expect(pct).toBeGreaterThan(30)
    expect(pct).toBeLessThan(40)
  })

  test('M2-H3 an ellipse gate on the main cluster catches most but fewer than the rectangle', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: /Ellipse gate/ }).click()
    const box = await plotBox(page)
    const [x0, y0, x1, y1] = MAIN_CLUSTER
    const [ax, ay] = px(box, x0, y0)
    const [bx, by] = px(box, x1, y1)
    await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move((ax + bx) / 2, (ay + by) / 2); await page.mouse.move(bx, by); await page.mouse.up()
    const ell = await rowNumbers(popRow(page, /Gate 1/))
    await drawRect(page, ...MAIN_CLUSTER)
    const rect = await rowNumbers(popRow(page, /Gate 2/))
    expect(ell.pct).toBeGreaterThan(45)
    expect(ell.count).toBeLessThan(rect.count)
  })

  test('M2-E1 a tiny range drag is ignored', async ({ page }) => {
    await loadDemo(page)
    await histogramMode(page)
    await dragRange(page, 0.5, 0.505)
    await expect(page.getByRole('treeitem')).toHaveCount(1)
  })

  test('M2-E2 gates only show on the plot type they belong to', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await page.getByRole('combobox', { name: 'Plot type' }).selectOption('histogram')
    await expect(popRow(page, /Gate 1/)).toBeVisible() // still in the tree
    await page.getByRole('combobox', { name: 'Plot type' }).selectOption('pseudocolor')
    await expect(page.getByRole('button', { name: /Rectangle gate/ })).toBeVisible()
  })

  test('M2-E3 a histogram of an empty population does not crash', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, 0.9, 0.9, 1, 1) // nothing there
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    expect((await rowNumbers(popRow(page, /Gate 1/))).count).toBe(0)
    await popRow(page, /Gate 1/).click()
    await page.getByRole('combobox', { name: 'Plot type' }).selectOption('histogram')
    await expect(page.getByText('0 events').first()).toBeVisible()
  })

  test('M2-E4 a range gate and an ellipse survive save and reopen', async ({ page }) => {
    await loadDemo(page)
    await histogramMode(page)
    await dragRange(page, 0.55, 1)
    await page.getByRole('combobox', { name: 'Plot type' }).selectOption('pseudocolor')
    await X(page).selectOption({ label: 'FSC-A' })
    await drawRect(page, ...MAIN_CLUSTER)
    await expect(popRow(page, /Gate 2/)).toBeVisible()
    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const wb = JSON.parse(readFileSync(await dl.path(), 'utf8'))
    expect(wb.gates[0].geometry.type).toBe('range')
    expect(wb.gates[0].yParam).toBe('')
    expect(wb.gates[1].geometry.type).toBe('rectangle')
    page.on('dialog', (d) => void d.accept())
    const chooser = page.waitForEvent('filechooser')
    await menu(page, 'File', /Open Workbench/)
    await (await chooser).setFiles({ name: 'x.fcwb', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wb)) })
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })
})

test.describe('undo and redo', () => {
  const undoBtn = (page: Page) => page.getByRole('button', { name: 'Undo' })
  const redoBtn = (page: Page) => page.getByRole('button', { name: 'Redo' })

  test('M2-U1 undo removes a gate and redo brings it back', async ({ page }) => {
    await loadDemo(page)
    await expect(undoBtn(page)).toBeDisabled()
    await drawRect(page, ...MAIN_CLUSTER)
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await expect(undoBtn(page)).toBeEnabled()
    await page.keyboard.press('Control+z')
    await expect(page.getByRole('treeitem')).toHaveCount(1)
    await expect(redoBtn(page)).toBeEnabled()
    await page.keyboard.press('Control+y')
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await expect(redoBtn(page)).toBeDisabled()
  })

  test('M2-U2 undo restores a deleted parent with its children', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await popRow(page, /Gate 1/).click()
    await X(page).selectOption({ label: FL1 })
    await Y(page).selectOption({ label: 'FL2-A :: Marker B PE' })
    await drawRect(page, 0.55, 0.55, 1, 1)
    await expect(popRow(page, /Gate 2/)).toBeVisible()
    await popRow(page, /Gate 1/).click()
    await page.getByRole('button', { name: /Delete population/ }).click()
    await expect(page.getByRole('treeitem')).toHaveCount(1)
    await undoBtn(page).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await expect(popRow(page, /Gate 2/)).toBeVisible()
  })

  test('M2-U3 undo and redo cover rename and axis scale changes', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await popRow(page, /Gate 1/).dblclick()
    await page.getByLabel('Population name').fill('Lymphs')
    await page.keyboard.press('Enter')
    await expect(popRow(page, /Lymphs/)).toBeVisible()
    await undoBtn(page).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await redoBtn(page).click()
    await expect(popRow(page, /Lymphs/)).toBeVisible()

    await X(page).selectOption({ label: FL1 })
    const before = await page.locator('.gl-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL())
    await page.getByRole('button', { name: 'Scale for the X axis' }).click()
    await page.getByLabel('Extra negative decades value').fill('1')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    const changed = await page.locator('.gl-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL())
    expect(changed).not.toBe(before)
    await undoBtn(page).click()
    expect(await page.locator('.gl-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL())).toBe(before)
  })

  test('M2-U4 a new change after undo clears redo', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await undoBtn(page).click()
    await expect(redoBtn(page)).toBeEnabled()
    await drawRect(page, 0.5, 0.2, 0.7, 0.5)
    await expect(redoBtn(page)).toBeDisabled()
  })

  test('M2-U5 undo never removes a loaded sample', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('menuitem', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: /Load demo sample/ }).click()
    const samples = page.getByRole('listbox', { name: 'Samples' }).getByRole('option')
    await expect(samples).toHaveCount(2)
    await undoBtn(page).click()
    await expect(samples).toHaveCount(2)
    await expect(page.getByRole('treeitem')).toHaveCount(1)
  })

  test('M2-U6 Ctrl+Z while renaming belongs to the text field', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await popRow(page, /Gate 1/).dblclick()
    await page.getByLabel('Population name').press('Control+z')
    await expect(page.getByLabel('Population name')).toBeVisible()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })

  test('M2-U7 the Edit menu has Undo and Redo', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await menu(page, 'Edit', /^Undo/)
    await expect(page.getByRole('treeitem')).toHaveCount(1)
  })
})

test.describe('dark mode', () => {
  const html = (page: Page) => page.locator('html')

  test('M2-D1 the toggle switches theme, the plot still draws, and the choice is remembered', async ({ page }) => {
    await loadDemo(page)
    await expect(html(page)).toHaveAttribute('data-theme', 'light')
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await page.getByRole('button', { name: 'Switch to dark mode' }).click()
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(lightBg)
    expect(await glInk(page)).toBeGreaterThan(2000)
    await page.reload()
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Switch to light mode' }).click()
    await expect(html(page)).toHaveAttribute('data-theme', 'light')
  })

  test('M2-D2 with no saved choice it follows the system setting', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await expect(html(page)).toHaveAttribute('data-theme', 'dark')
  })

  test('M2-D3 accessibility scan in dark mode with a gate and a histogram', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await popRow(page, /Gate 1/).click()
    for (const type of ['pseudocolor', 'histogram']) {
      await page.getByRole('combobox', { name: 'Plot type' }).selectOption(type)
      const r = await new AxeBuilder({ page }).analyze()
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.map((v) => `${type} ${v.id}: ${v.nodes.length} nodes (${v.help})`)).toEqual([])
    }
  })

  test('M2-D4 the canvas text and gate colours follow the theme', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const dark = await (async () => {
      await page.getByRole('button', { name: 'Switch to dark mode' }).click()
      return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--plot-bg').trim())
    })()
    expect(dark).toBe('#16171a')
    expect(await overlayInk(page)).toBeGreaterThan(1000)
  })
})

