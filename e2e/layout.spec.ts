import type { Page } from '@playwright/test'
import { test, expect, loadDemo, menu } from './helpers'

const width = async (page: Page, sel: string): Promise<number> => (await page.locator(sel).boundingBox())?.width ?? 0
const height = async (page: Page, sel: string): Promise<number> => (await page.locator(sel).boundingBox())?.height ?? 0

async function drag(page: Page, name: string, dx: number, dy: number): Promise<void> {
  const b = (await page.getByRole('separator', { name }).boundingBox())!
  const x = b.x + b.width / 2
  const y = b.y + b.height / 2 + (dy === 0 ? 120 : 0) // away from the fold button in the middle of a vertical bar
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx / 2, y + dy / 2)
  await page.mouse.move(x + dx, y + dy)
  await page.mouse.up()
}

test.describe('layout', () => {
  test('LAY-1 the panels can be resized by dragging, and the sizes are remembered', async ({ page }) => {
    await loadDemo(page)
    const left = await width(page, '.left-panel')
    await drag(page, 'Resize the left panel', 90, 0)
    await expect.poll(() => width(page, '.left-panel')).toBeGreaterThan(left + 70)
    const right = await width(page, '.right-panel')
    await drag(page, 'Resize the details panel', -60, 0) // towards the middle makes it bigger
    await expect.poll(() => width(page, '.right-panel')).toBeGreaterThan(right + 40)
    const sized = [await width(page, '.left-panel'), await width(page, '.right-panel')]
    await page.reload()
    await page.getByRole('button', { name: 'Load demo sample' }).click()
    expect(Math.abs((await width(page, '.left-panel')) - sized[0])).toBeLessThan(3)
    expect(Math.abs((await width(page, '.right-panel')) - sized[1])).toBeLessThan(3)
  })

  test('LAY-2 a panel folds away, the middle takes its room, and it comes back', async ({ page }) => {
    await loadDemo(page)
    const centre = await width(page, '.center')
    await page.getByRole('button', { name: 'Hide the details panel' }).click()
    await expect.poll(() => width(page, '.right-panel')).toBeLessThan(2)
    await expect.poll(() => width(page, '.center')).toBeGreaterThan(centre + 250)
    await page.getByRole('button', { name: 'Hide the left panel' }).click()
    await expect.poll(() => width(page, '.left-panel')).toBeLessThan(2)
    await expect(page.getByRole('option', { name: /Demo sample 1/ })).toBeHidden() // out of reach while folded
    await page.getByRole('button', { name: 'Show the left panel' }).click()
    await page.getByRole('button', { name: 'Show the details panel' }).click()
    await expect.poll(() => width(page, '.right-panel')).toBeGreaterThan(200)
    await expect(page.getByRole('option', { name: /Demo sample 1/ })).toBeVisible()
  })

  test('LAY-3 a bar can be moved with the keyboard', async ({ page }) => {
    await loadDemo(page)
    const bar = page.getByRole('separator', { name: 'Resize the details panel' })
    const before = await width(page, '.right-panel')
    await bar.focus()
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => width(page, '.right-panel')).toBeGreaterThan(before + 28)
    await page.keyboard.press('Home') // the smallest
    await expect.poll(() => width(page, '.right-panel')).toBeLessThan(before - 50)
    await expect(bar).toHaveAttribute('aria-valuenow', '220')
  })

  test('LAY-4 the sections of the left panel fold and change height', async ({ page }) => {
    await loadDemo(page)
    const groups = await height(page, '[data-box=groups]')
    await drag(page, 'Resize the groups list', 0, 70)
    await expect.poll(() => height(page, '[data-box=groups]')).toBeGreaterThan(groups + 50)
    const pops = await height(page, '[data-box=populations]')
    await page.getByRole('button', { name: /Fold Samples/ }).click()
    await expect(page.getByRole('option', { name: /Demo sample 1/ })).toBeHidden()
    await expect.poll(() => height(page, '[data-box=samples]')).toBeLessThan(40)
    await expect.poll(() => height(page, '[data-box=populations]')).toBeGreaterThan(pops)
    await page.getByRole('button', { name: /Show Samples/ }).click()
    await expect(page.getByRole('option', { name: /Demo sample 1/ })).toBeVisible()
  })

  test('LAY-5 blocks of the details panel fold, and Reset the layout puts everything back', async ({ page }) => {
    await loadDemo(page)
    await expect(page.getByRole('table').filter({ hasText: 'Stain' })).toBeVisible()
    await page.getByRole('button', { name: /Fold Parameters/ }).click()
    await expect(page.getByRole('table').filter({ hasText: 'Stain' })).toBeHidden()
    const defaults = await width(page, '.left-panel')
    await drag(page, 'Resize the left panel', 80, 0)
    await page.getByRole('button', { name: 'Hide the details panel' }).click()
    await menu(page, 'View', /Reset the layout/)
    await expect(page.getByRole('table').filter({ hasText: 'Stain' })).toBeVisible()
    await expect.poll(async () => Math.abs((await width(page, '.left-panel')) - defaults)).toBeLessThan(3)
    await expect.poll(() => width(page, '.right-panel')).toBeGreaterThan(200)
  })
})
