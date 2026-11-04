import type { Page } from '@playwright/test'
import { test, expect, loadDemo, menu } from './helpers'

const list = (page: Page) => page.getByRole('listbox', { name: 'Samples' })
const opt = (page: Page, name: RegExp | string) => list(page).getByRole('option', { name })

async function threeSamples(page: Page): Promise<void> {
  await loadDemo(page)
  await menu(page, 'File', /Load demo sample/)
  await menu(page, 'File', /Load demo sample/)
  await expect(list(page).getByRole('option')).toHaveCount(3)
}

test.describe('renaming samples', () => {
  test('REN-1 F2 or a double-click renames a sample; it is used everywhere and sorts by the new name', async ({ page }) => {
    await threeSamples(page)
    await opt(page, /Demo sample 2/).focus()
    await page.keyboard.press('F2')
    const box = page.getByRole('textbox', { name: 'Sample name' })
    await expect(box).toBeFocused()
    await box.fill('A first')
    await page.keyboard.press('Enter')
    await expect(opt(page, /A first/)).toBeVisible()
    await expect(opt(page, /Demo sample 2/)).toHaveCount(0)
    await expect(page.locator('.wb-name')).toContainText('•') // the Workbench has unsaved changes
    // double-click, and Escape leaves the name as it was
    await opt(page, /Demo sample 3/).getByText('Demo sample 3').dblclick()
    await page.getByRole('textbox', { name: 'Sample name' }).fill('thrown away')
    await page.keyboard.press('Escape')
    await expect(opt(page, /Demo sample 3/)).toBeVisible()
    // an empty name is refused
    await opt(page, /Demo sample 3/).focus()
    await page.keyboard.press('F2')
    await page.getByRole('textbox', { name: 'Sample name' }).fill('   ')
    await page.keyboard.press('Enter')
    await expect(opt(page, /Demo sample 3/)).toBeVisible()
    // the new name sorts and shows in the details
    await page.getByRole('combobox', { name: 'Sort samples' }).selectOption({ label: 'Name A to Z' })
    expect((await list(page).getByRole('option').allInnerTexts())[0]).toContain('A first')
    await expect(page.getByText('A first').first()).toBeVisible()
  })
})

test.describe('zoom of the thumbnails', () => {
  test('ZOOM-1 Ctrl + mouse wheel over the thumbnails makes all of them bigger or smaller; the slider does too', async ({ page }) => {
    test.slow(!!process.env['CI'], 'heavy on a shared CI machine')
    await threeSamples(page)
    await page.getByRole('button', { name: 'All samples' }).click()
    const tile = page.locator('.gallery figure canvas').first()
    const w0 = (await tile.boundingBox())!.width
    const gallery = page.locator('.gallery')
    const box = (await gallery.boundingBox())!
    await page.mouse.move(box.x + 100, box.y + 100)
    await page.keyboard.down('ControlOrMeta')
    await page.mouse.wheel(0, -300) // up: bigger
    await page.mouse.wheel(0, -300)
    await page.keyboard.up('ControlOrMeta')
    await expect.poll(async () => (await tile.boundingBox())!.width).toBeGreaterThan(w0 + 30)
    const big = (await tile.boundingBox())!.width
    await page.keyboard.down('ControlOrMeta')
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300) // down: smaller
    await page.keyboard.up('ControlOrMeta')
    await expect.poll(async () => (await tile.boundingBox())!.width).toBeLessThan(big - 60)
    // every thumbnail has the same size
    const widths = await page.locator('.gallery figure canvas').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))
    expect(new Set(widths).size).toBe(1)
    // a plain wheel does not change the size
    const w1 = (await tile.boundingBox())!.width
    await page.mouse.wheel(0, 200)
    expect(Math.abs((await tile.boundingBox())!.width - w1)).toBeLessThan(1)
    // the slider, and the choice is remembered
    await page.getByRole('slider', { name: 'Thumbnail size' }).fill('400')
    await expect.poll(async () => Math.round((await tile.boundingBox())!.width)).toBe(400)
    await page.reload()
    await threeSamples(page)
    await page.getByRole('button', { name: 'All samples' }).click()
    await expect.poll(async () => Math.round((await page.locator('.gallery figure canvas').first().boundingBox())!.width)).toBe(400)
  })

  test('ZOOM-2 the sheet zooms the same way, within limits', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Sheet' }).click()
    await page.getByRole('button', { name: 'Add plot' }).click()
    const tile = page.locator('.sheet figure canvas')
    await page.getByRole('slider', { name: 'Thumbnail size' }).fill('640')
    await expect.poll(async () => Math.round((await tile.boundingBox())!.width)).toBe(640)
    const box = (await page.locator('.sheet-scroll').boundingBox())!
    await page.mouse.move(box.x + 50, box.y + 50)
    await page.keyboard.down('ControlOrMeta')
    await page.mouse.wheel(0, -300) // already the biggest
    await page.keyboard.up('ControlOrMeta')
    await expect.poll(async () => Math.round((await tile.boundingBox())!.width)).toBe(640)
  })
})

test.describe('axis scale panel', () => {
  test('SCALE-1 the T button opens the details panel when it is folded away', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: 'Hide the details panel' }).click()
    await expect.poll(async () => (await page.locator('.right-panel').boundingBox())?.width ?? 0).toBeLessThan(2)
    await page.getByRole('button', { name: 'Scale for the X axis' }).click()
    await expect.poll(async () => (await page.locator('.right-panel').boundingBox())?.width ?? 0).toBeGreaterThan(200)
    await expect(page.getByText('Axis scale: FSC-A')).toBeVisible()
  })
})
