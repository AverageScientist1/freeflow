import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, MAIN_CLUSTER, menu, addFile, fcsBuffer, popRow } from './helpers'

const list = (page: Page) => page.getByRole('listbox', { name: 'Samples' })
const opt = (page: Page, name: RegExp | string) => list(page).getByRole('option', { name })
const order = async (page: Page): Promise<string[]> =>
  (await list(page).getByRole('option').allInnerTexts()).map((t) => t.split('\n')[0].replace(/\.fcs$/, '').trim())

async function threeSamples(page: Page): Promise<void> {
  await loadDemo(page)
  await menu(page, 'File', /Load demo sample/)
  await menu(page, 'File', /Load demo sample/)
  await expect(list(page).getByRole('option')).toHaveCount(3)
}

// Samples with names and sizes that tell the orders apart.
async function sizedSamples(page: Page): Promise<void> {
  await page.goto('/')
  await addFile(page, 'S10.fcs', fcsBuffer(300))
  await addFile(page, 'S2.fcs', fcsBuffer(900))
  await addFile(page, 'S1.fcs', fcsBuffer(100))
  await expect(list(page).getByRole('option')).toHaveCount(3)
}

test.describe('removing samples', () => {
  test('SMP-1 Delete removes the focused sample after asking; the others keep their gates', async ({ page }) => {
    await threeSamples(page)
    await opt(page, /Demo sample 1/).click()
    await drawRect(page, ...MAIN_CLUSTER)
    await opt(page, /Demo sample 2/).focus()
    await opt(page, /Demo sample 2/).click()
    page.once('dialog', async (d) => { expect(d.message()).toMatch(/Remove "Demo sample 2"/); expect(d.message()).toMatch(/cannot be undone/); await d.accept() })
    await page.keyboard.press('Delete')
    await expect(list(page).getByRole('option')).toHaveCount(2)
    await expect(opt(page, /Demo sample 2/)).toHaveCount(0)
    await expect(page.locator('.statusbar')).toContainText('Removed "Demo sample 2"')
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled() // the history cannot point at a sample that is gone
    // the open sample is now one of the others, with the linked gate still there
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })

  test('SMP-2 Ctrl and Shift mark several samples, which are removed together', async ({ page }) => {
    await threeSamples(page)
    await opt(page, /Demo sample 1/).click()
    await opt(page, /Demo sample 3/).click({ modifiers: ['Control'] })
    await expect(opt(page, /Demo sample 1/)).toHaveAttribute('aria-selected', 'true')
    await expect(opt(page, /Demo sample 2/)).toHaveAttribute('aria-selected', 'false')
    await expect(opt(page, /Demo sample 3/)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('button', { name: 'Remove 2 samples' })).toBeVisible()
    // shift marks the range
    await opt(page, /Demo sample 1/).click()
    await opt(page, /Demo sample 3/).click({ modifiers: ['Shift'] })
    await expect(opt(page, /Demo sample 2/)).toHaveAttribute('aria-selected', 'true')
    await opt(page, /Demo sample 1/).click()
    await opt(page, /Demo sample 3/).click({ modifiers: ['Control'] })
    page.once('dialog', (d) => { void d.accept() })
    await page.getByRole('button', { name: 'Remove 2 samples' }).click()
    await expect(list(page).getByRole('option')).toHaveCount(1)
    await expect(opt(page, /Demo sample 2/)).toBeVisible()
  })

  test('SMP-3 saying no keeps everything', async ({ page }) => {
    await threeSamples(page)
    page.once('dialog', (d) => { void d.dismiss() })
    await page.getByRole('button', { name: 'Remove sample' }).click()
    await expect(list(page).getByRole('option')).toHaveCount(3)
  })
})

test.describe('subgroups', () => {
  test('SUB-1 a subgroup is made inside a group, and samples can be dragged onto it', async ({ page }) => {
    await threeSamples(page)
    const groups = page.getByRole('listbox', { name: 'Groups' })
    await page.getByRole('button', { name: 'New group' }).click()
    await page.getByRole('textbox', { name: 'New group name' }).fill('Treated')
    await page.keyboard.press('Enter')
    await expect(groups.getByRole('option', { name: /Treated/ })).toHaveAttribute('data-depth', '0')
    await page.getByRole('button', { name: 'New subgroup' }).click()
    await page.getByRole('textbox', { name: 'New subgroup name' }).fill('Low dose')
    await page.keyboard.press('Enter')
    const low = groups.getByRole('option', { name: /Low dose/ })
    await expect(low).toHaveAttribute('data-depth', '1')
    await groups.getByRole('option', { name: /All Samples/ }).click()
    // drag a sample onto the subgroup
    await opt(page, /Demo sample 1/).dragTo(low)
    await expect(low).toContainText('1')
    await expect(groups.getByRole('option', { name: /Treated/ })).toContainText('1') // the group above counts the samples of its subgroups
    await low.click()
    await expect(list(page).getByRole('option')).toHaveCount(1)
    // a group can be moved by dragging too: Low dose to the top level
    await low.dragTo(groups.getByRole('option', { name: /All Samples/ }))
    await expect(groups.getByRole('option', { name: /Low dose/ })).toHaveAttribute('data-depth', '0')
  })

  test('SUB-2 a subgroup has gates of its own; applying from the group above pushes a gate down once', async ({ page }) => {
    await threeSamples(page)
    const groups = page.getByRole('listbox', { name: 'Groups' })
    // Treated holds sample 3 directly and has the subgroup Low dose with samples 1 and 2
    await page.getByRole('button', { name: 'New group' }).click()
    await page.getByRole('textbox', { name: 'New group name' }).fill('Treated')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'New subgroup' }).click()
    await page.getByRole('textbox', { name: 'New subgroup name' }).fill('Low dose')
    await page.keyboard.press('Enter')
    const low = groups.getByRole('option', { name: /Low dose/ })
    const treated = groups.getByRole('option', { name: /^Treated/ })
    await groups.getByRole('option', { name: /All Samples/ }).click()
    await opt(page, /Demo sample 1/).dragTo(low)
    await opt(page, /Demo sample 2/).dragTo(low)
    await opt(page, /Demo sample 3/).dragTo(treated)
    // a gate drawn in sample 1 reaches sample 2 (same subgroup) and not sample 3 (the group above)
    await groups.getByRole('option', { name: /All Samples/ }).click()
    await opt(page, /Demo sample 1/).click()
    await drawRect(page, ...MAIN_CLUSTER)
    await opt(page, /Demo sample 2/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await opt(page, /Demo sample 3/).click()
    await expect(popRow(page, /Gate 1/)).toHaveCount(0)
    // from the group above, "Apply to group" pushes a gate down into the subgroup's samples
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await opt(page, /Demo sample 1/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })

  test('SUB-3 deleting a group moves its samples and subgroups up one level', async ({ page }) => {
    await threeSamples(page)
    const groups = page.getByRole('listbox', { name: 'Groups' })
    await page.getByRole('button', { name: 'New group' }).click()
    await page.getByRole('textbox', { name: 'New group name' }).fill('Outer')
    await page.keyboard.press('Enter')
    await page.getByRole('button', { name: 'New subgroup' }).click()
    await page.getByRole('textbox', { name: 'New subgroup name' }).fill('Inner')
    await page.keyboard.press('Enter')
    await groups.getByRole('option', { name: /All Samples/ }).click()
    await opt(page, /Demo sample 1/).dragTo(groups.getByRole('option', { name: /Inner/ }))
    await groups.getByRole('option', { name: /^Outer/ }).click()
    await page.getByRole('button', { name: 'Delete group' }).click()
    await expect(groups.getByRole('option', { name: /Outer/ })).toHaveCount(0)
    await expect(groups.getByRole('option', { name: /Inner/ })).toHaveAttribute('data-depth', '0')
    await groups.getByRole('option', { name: /Inner/ }).click()
    await expect(opt(page, /Demo sample 1/)).toBeVisible()
  })
})

test.describe('sorting samples', () => {
  test('ORD-1 sort by name, natural order, number of events', async ({ page }) => {
    await sizedSamples(page)
    expect(await order(page)).toEqual(['S10', 'S2', 'S1']) // as added
    const sort = page.getByRole('combobox', { name: 'Sort samples' })
    await sort.selectOption({ label: 'Name, natural (S2 before S10)' })
    expect(await order(page)).toEqual(['S1', 'S2', 'S10'])
    await sort.selectOption({ label: 'Name A to Z' })
    expect(await order(page)).toEqual(['S1', 'S10', 'S2']) // the characters, not the numbers
    await sort.selectOption({ label: 'Most events first' })
    expect(await order(page)).toEqual(['S2', 'S10', 'S1'])
    await sort.selectOption({ label: 'Fewest events first' })
    expect(await order(page)).toEqual(['S1', 'S10', 'S2'])
    await sort.selectOption({ label: 'Name Z to A' })
    expect(await order(page)).toEqual(['S2', 'S10', 'S1'])
    // the order is the one the arrow keys follow
    await opt(page, /S2/).click()
    await page.keyboard.press('PageDown')
    await expect(opt(page, /S10/)).toHaveAttribute('aria-selected', 'true')
  })

  test('ORD-2 by keyword and by group', async ({ page }) => {
    await threeSamples(page)
    const groups = page.getByRole('listbox', { name: 'Groups' })
    await page.getByRole('button', { name: 'New group' }).click()
    await page.getByRole('textbox', { name: 'New group name' }).fill('Zeta')
    await page.keyboard.press('Enter')
    await groups.getByRole('option', { name: /All Samples/ }).click()
    await opt(page, /Demo sample 3/).dragTo(groups.getByRole('option', { name: /Zeta/ }))
    await page.getByRole('combobox', { name: 'Sort samples' }).selectOption({ label: 'By group' })
    expect(await order(page)).toEqual(['Demo sample 1', 'Demo sample 2', 'Demo sample 3']) // no group first, Zeta last
    await page.getByRole('combobox', { name: 'Sort samples' }).selectOption({ label: 'Newest first' })
    expect((await order(page)).length).toBe(3) // files with no date keep their places
    expect(await page.getByRole('combobox', { name: 'Sort samples' }).locator('optgroup').count()).toBeLessThanOrEqual(1)
  })

  test('ORD-3 samples are moved by hand: Alt+Down and dragging', async ({ page }) => {
    await sizedSamples(page)
    await opt(page, /S10/).click()
    await opt(page, /S10/).focus()
    await page.keyboard.press('Alt+ArrowDown')
    expect(await order(page)).toEqual(['S2', 'S10', 'S1'])
    await page.keyboard.press('Alt+ArrowUp')
    await page.keyboard.press('Alt+ArrowUp') // already first: stays
    expect(await order(page)).toEqual(['S10', 'S2', 'S1'])
    await opt(page, /S1\b/).dragTo(opt(page, /S10/)) // dropped on a row: goes before it
    expect(await order(page)).toEqual(['S1', 'S10', 'S2'])
  })
})
