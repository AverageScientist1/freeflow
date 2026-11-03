import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, MAIN_CLUSTER, menu } from './helpers'

const plotType = (page: Page) => page.getByRole('combobox', { name: 'Plot type' })
const sampleButton = (page: Page, name: string) => page.getByRole('tabpanel').getByRole('button', { name, exact: true })

async function twoSamples(page: Page): Promise<void> {
  await loadDemo(page)
  await menu(page, 'File', /Load demo sample/)
  await page.getByRole('option', { name: /Demo sample 1/ }).click()
}

// How many pixels of the overlay canvas are close to a colour (the overlay palette starts with this blue).
async function nearColor(page: Page, rgb: [number, number, number]): Promise<number> {
  return page.locator('.overlay-canvas').evaluate((c: HTMLCanvasElement, want) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && Math.abs(d[i] - want[0]) < 12 && Math.abs(d[i + 1] - want[1]) < 12 && Math.abs(d[i + 2] - want[2]) < 12) n++
    return n
  }, rgb)
}
const BLUE: [number, number, number] = [0x3f, 0x8f, 0xd1]

test.describe('overlays', () => {
  test('OVL-1 a histogram of another sample is drawn over this one, normalized, with a legend entry', async ({ page }) => {
    await twoSamples(page)
    await plotType(page).selectOption('histogram')
    await page.getByRole('combobox', { name: 'X', exact: true }).selectOption({ label: 'FL1-A :: Marker A FITC' })
    expect(await nearColor(page, BLUE)).toBe(0)
    await page.getByRole('button', { name: 'Overlays' }).click()
    await sampleButton(page, 'Demo sample 2').click()
    await expect(page.getByRole('list', { name: 'Active overlays' }).getByText('Demo sample 2 · All events')).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Normalize to mode' })).toBeChecked()
    await expect.poll(() => nearColor(page, BLUE)).toBeGreaterThan(200)
    // pressing the same sample again takes its overlay off, and again puts it back (never twice)
    await sampleButton(page, 'Demo sample 2').click()
    await expect(page.getByRole('list', { name: 'Active overlays' })).toHaveCount(0)
    await sampleButton(page, 'Demo sample 2').click()
    await expect(page.getByRole('list', { name: 'Active overlays' }).getByRole('listitem')).toHaveCount(1)
    // smoothing changes the curve
    const before = await nearColor(page, BLUE)
    await page.getByRole('combobox', { name: 'Smooth' }).selectOption({ label: 'High' })
    await expect.poll(() => nearColor(page, BLUE)).not.toBe(before)
  })

  test('OVL-2 on a two-parameter plot the overlay is coloured dots', async ({ page }) => {
    await twoSamples(page)
    await page.getByRole('button', { name: 'Overlays' }).click()
    await sampleButton(page, 'Demo sample 2').click()
    await expect(page.getByRole('checkbox', { name: 'Normalize to mode' })).toHaveCount(0) // histograms only
    await expect.poll(() => nearColor(page, BLUE)).toBeGreaterThan(500)
  })

  test('OVL-3 Overlay group adds the open population of every other sample; chips can be removed', async ({ page }) => {
    await twoSamples(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await menu(page, 'File', /Load demo sample/) // a third sample, with the same gating
    await page.getByRole('option', { name: /Demo sample 1/ }).click()
    await page.getByRole('treeitem', { name: /Gate 1/ }).click()
    await page.getByRole('button', { name: 'Overlays' }).click()
    await page.getByRole('button', { name: 'Overlay all' }).click()
    const chips = page.getByRole('list', { name: 'Active overlays' }).getByRole('listitem')
    await expect(chips).toHaveCount(2)
    await expect(chips.first()).toContainText('Demo sample 2 · Gate 1')
    await page.getByRole('button', { name: 'Remove overlay Demo sample 2 · Gate 1' }).click()
    await expect(chips).toHaveCount(1)
  })

  test('OVL-4 overlays are not carried into a new Workbench, and the picture exports', async ({ page }) => {
    await twoSamples(page)
    await plotType(page).selectOption('histogram')
    await page.getByRole('button', { name: 'Overlays' }).click()
    await sampleButton(page, 'Demo sample 2').click()
    const dl = page.waitForEvent('download')
    await menu(page, 'File', /Export plot or chart image/)
    expect((await dl).suggestedFilename()).toMatch(/\.png$/)
    page.once('dialog', (d) => { d.accept().catch(() => undefined) })
    await menu(page, 'File', /New Workbench/)
    await expect(page.getByRole('list', { name: 'Active overlays' })).toHaveCount(0)
  })

  test('OVL-5 only the top-level groups are tabs; subgroups are a selector beside the population, shown when there are some', async ({ page }) => {
    await twoSamples(page)
    await menu(page, 'File', /Load demo sample/) // a third sample
    const groups = page.getByRole('listbox', { name: 'Groups' })
    await page.getByRole('button', { name: 'New group' }).click()
    await page.getByRole('textbox', { name: 'New group name' }).fill('Treated')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'New subgroup' }).click()
    await page.getByRole('textbox', { name: 'New subgroup name' }).fill('Low dose')
    await page.keyboard.press('Enter')
    await groups.getByRole('option', { name: /All Samples/ }).click()
    await page.getByRole('listbox', { name: 'Samples' }).getByRole('option', { name: /Demo sample 2/ }).dragTo(groups.getByRole('option', { name: /Low dose/ }))
    await page.getByRole('listbox', { name: 'Samples' }).getByRole('option', { name: /Demo sample 3/ }).dragTo(groups.getByRole('option', { name: /^Treated/ }))
    await page.getByRole('button', { name: 'Overlays' }).click()
    const tabs = page.getByRole('tablist', { name: 'Group to overlay from' })
    await expect(tabs.getByRole('tab')).toHaveText(['All Samples', 'Treated']) // the subgroup is not a tab
    await expect(page.getByRole('combobox', { name: 'Subgroup' })).toHaveCount(0) // nothing below All Samples to choose
    await tabs.getByRole('tab', { name: 'Treated' }).click()
    const subgroup = page.getByRole('combobox', { name: 'Subgroup' })
    await expect(subgroup).toBeVisible()
    // the selector comes before the population selector
    const order = await page.locator('.overlay-controls select').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    expect(order.slice(0, 2)).toEqual(['Subgroup', 'Overlay population'])
    await expect(subgroup.locator('option')).toHaveText(['All of Treated (2)', 'Low dose (1)'])
    // the whole group lists its own samples and those of its subgroups; the subgroup only its own
    await expect(page.getByRole('tabpanel').getByRole('listitem')).toHaveText(['Demo sample 2', 'Demo sample 3'])
    await subgroup.selectOption({ label: 'Low dose (1)' })
    await expect(page.getByRole('tabpanel').getByRole('listitem')).toHaveText(['Demo sample 2'])
    await subgroup.selectOption({ label: 'All of Treated (2)' })
    await sampleButton(page, 'Demo sample 3').click()
    await expect(page.getByRole('list', { name: 'Active overlays' }).getByText('Demo sample 3 · All events')).toBeVisible()
    await expect(sampleButton(page, 'Demo sample 3')).toHaveAttribute('aria-pressed', 'true')
    // "Overlay all" adds the rest of what is listed at once, "Remove all" clears; the arrow keys move between tabs
    await page.getByRole('button', { name: 'Overlay all' }).click()
    await expect(page.getByRole('list', { name: 'Active overlays' }).getByRole('listitem')).toHaveCount(2)
    await page.getByRole('button', { name: /Remove all \(2\)/ }).click()
    await expect(page.getByRole('list', { name: 'Active overlays' })).toHaveCount(0)
    await tabs.getByRole('tab', { name: 'All Samples' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(tabs.getByRole('tab', { name: 'Treated' })).toHaveAttribute('aria-selected', 'true')
  })
})
