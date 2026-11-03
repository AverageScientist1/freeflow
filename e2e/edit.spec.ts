import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, drawPolygon, plotBox, px, popRow, rowNumbers, menu, MAIN_CLUSTER } from './helpers'

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = await plotBox(page)
  const [ax, ay] = px(box, ...from)
  const [bx, by] = px(box, ...to)
  await page.mouse.move(ax, ay)
  await page.mouse.down()
  await page.mouse.move((ax + bx) / 2, (ay + by) / 2)
  await page.mouse.move(bx, by)
  await page.mouse.up()
}

const count = async (page: Page): Promise<number> => (await rowNumbers(popRow(page, /Gate 1/))).count

async function savedGeometry(page: Page): Promise<Record<string, number>> {
  const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
  return JSON.parse(readFileSync(await dl.path(), 'utf8')).gates[0].geometry
}

test.describe('editing a gate after it is drawn', () => {
  test('EDIT-1 dragging a corner resizes a rectangle and the population follows', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER) // x 0.18..0.45, y 0..0.2
    const before = await count(page)
    const g0 = await savedGeometry(page) // gates are saved in real data values
    await drag(page, [0.45, 0.2], [0.6, 0.45]) // the top-right handle
    await expect.poll(() => count(page)).toBeGreaterThan(before)
    const g = await savedGeometry(page)
    expect(g.x0).toBeCloseTo(g0.x0, 0) // the opposite corner did not move
    expect(g.y0).toBeCloseTo(g0.y0, 0)
    expect(g.x1).toBeGreaterThan(g0.x1 * 1.2)
    expect(g.y1).toBeGreaterThan(g0.y1 * 1.5)
  })

  test('EDIT-2 dragging inside moves the gate without changing its size', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const before = await count(page)
    const g0 = await savedGeometry(page)
    await drag(page, [0.3, 0.1], [0.62, 0.1])
    await expect.poll(() => count(page)).toBeLessThan(before / 4) // the cluster is no longer inside
    const g = await savedGeometry(page)
    expect((g.x1 - g.x0) / (g0.x1 - g0.x0)).toBeCloseTo(1, 1) // same width (the scatter axis is linear)
    expect(g.x0).toBeGreaterThan(g0.x1) // and it now starts beyond where it used to end
  })

  test('EDIT-3 one undo reverts a whole drag, redo brings it back', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const original = await count(page)
    await drag(page, [0.45, 0.2], [0.6, 0.45])
    await expect.poll(() => count(page)).toBeGreaterThan(original)
    const edited = await count(page)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => count(page)).toBe(original)
    await page.getByRole('button', { name: 'Redo' }).click()
    await expect.poll(() => count(page)).toBe(edited)
  })

  test('EDIT-4 a polygon vertex can be dragged', async ({ page }) => {
    await loadDemo(page)
    await drawPolygon(page, [[0.15, 0.02], [0.5, 0.02], [0.5, 0.2], [0.15, 0.2]])
    const before = await count(page)
    await drag(page, [0.15, 0.02], [0.0, 0.0]) // the bottom-left vertex reaches out to the small population at the origin
    await expect.poll(() => count(page)).toBeGreaterThan(before)
    // and pulling a vertex inward cuts events out again
    const wider = await count(page)
    await drag(page, [0.5, 0.02], [0.66, 0.5])
    await expect.poll(() => count(page)).toBeLessThan(wider)
  })

  test('EDIT-5 an ellipse is resized from its extremes', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: /Ellipse gate/ }).click()
    await drag(page, [0.17, 0.0], [0.45, 0.2]) // centre 0.31, 0.1; the west extreme is at x 0.17
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    const before = await count(page)
    await drag(page, [0.17, 0.1], [0.0, 0.1])
    await expect.poll(() => count(page)).toBeGreaterThan(before)
  })

  test('EDIT-6 a range gate on a histogram can be widened from its edge', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('combobox', { name: 'X', exact: true }).selectOption({ label: 'FL1-A :: Marker A FITC' })
    await page.getByRole('combobox', { name: 'Plot type' }).selectOption('histogram')
    await page.getByRole('button', { name: /Range gate/ }).click()
    await drag(page, [0.55, 0.5], [1, 0.5])
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    const before = await count(page)
    await drag(page, [0.55, 0.5], [0.02, 0.5]) // the left edge now reaches the negative population
    await expect.poll(() => count(page)).toBeGreaterThan(before * 1.5)
  })

  test('EDIT-7 arrow keys nudge the selected gate', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const before = await count(page)
    const g0 = await savedGeometry(page)
    await page.locator('.plot-box').focus()
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight') // 30 x 0.005 = 0.15 of the axis
    await expect.poll(() => count(page)).toBeLessThan(before)
    const g = await savedGeometry(page)
    expect((g.x0 - g0.x0) / 262144).toBeCloseTo(0.15, 1) // moved by 15% of the axis (0 to 262,144)
  })

  test('EDIT-8 a gate cannot be dragged off the plot', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const box = await plotBox(page)
    const [ax, ay] = px(box, 0.3, 0.1)
    await page.mouse.move(ax, ay)
    await page.mouse.down()
    await page.mouse.move(box.x + box.pw + 300, ay) // far outside the plot, to the right
    await page.mouse.up()
    const g = await savedGeometry(page)
    expect(g.x1).toBeLessThanOrEqual(262144 + 1) // not beyond the end of the axis
    expect(g.x1).toBeGreaterThan(262144 * 0.99) // pushed right up against it
    expect((g.x1 - g.x0) / 262144).toBeCloseTo(0.27, 1) // still the same size
  })

  test('EDIT-9 Escape during a drag cancels it', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const before = await count(page)
    const box = await plotBox(page)
    const [ax, ay] = px(box, 0.3, 0.1)
    const [bx, by] = px(box, 0.7, 0.1)
    await page.mouse.move(ax, ay)
    await page.mouse.down()
    await page.mouse.move(bx, by)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    expect(await count(page)).toBe(before)
    await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled() // the drawing itself is still undoable
  })

  test('EDIT-10 clicking a gate without moving it is not an undo step', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const box = await plotBox(page)
    await page.mouse.click(...px(box, 0.3, 0.1))
    await page.getByRole('button', { name: 'Undo' }).click() // one undo removes the gate: no no-op step in between
    await expect(page.getByRole('treeitem')).toHaveCount(1)
  })

  test('EDIT-11 a gate that is not selected is selected by pressing on it, and can then be moved', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await popRow(page, /All events/).click() // selecting a population in the tree deselects the gate
    const before = await count(page)
    await drag(page, [0.3, 0.1], [0.62, 0.1])
    await expect.poll(() => count(page)).toBeLessThan(before / 4)
  })
})
