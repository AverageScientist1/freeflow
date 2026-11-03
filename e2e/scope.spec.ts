import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, MAIN_CLUSTER, menu, popRow } from './helpers'

const list = (page: Page) => page.getByRole('listbox', { name: 'Samples' })
const opt = (page: Page, name: RegExp | string) => list(page).getByRole('option', { name })
const groups = (page: Page) => page.getByRole('listbox', { name: 'Groups' })

async function makeGroup(page: Page, name: string, sub = false): Promise<void> {
  await page.getByRole('button', { name: sub ? 'New subgroup' : 'New group' }).click()
  await page.getByRole('textbox', { name: sub ? 'New subgroup name' : 'New group name' }).fill(name)
  await page.keyboard.press('Enter')
}

// Treated has two subgroups: Low dose (sample 1) and High dose (sample 2). Sample 3 is in no group and sample 4 is in Treated itself.
async function setup(page: Page): Promise<void> {
  await loadDemo(page)
  for (let i = 0; i < 3; i++) await menu(page, 'File', /Load demo sample/)
  await makeGroup(page, 'Treated')
  await makeGroup(page, 'Low dose', true)
  await groups(page).getByRole('option', { name: /^Treated/ }).click()
  await makeGroup(page, 'High dose', true)
  await groups(page).getByRole('option', { name: /All Samples/ }).click()
  await opt(page, /Demo sample 1/).dragTo(groups(page).getByRole('option', { name: /Low dose/ }))
  await opt(page, /Demo sample 2/).dragTo(groups(page).getByRole('option', { name: /High dose/ }))
  await opt(page, /Demo sample 4/).dragTo(groups(page).getByRole('option', { name: /^Treated/ }))
  await groups(page).getByRole('option', { name: /All Samples/ }).click()
}

const hasGate = async (page: Page, n: number): Promise<boolean> => {
  await opt(page, new RegExp(`Demo sample ${n}`)).click()
  return (await popRow(page, /Gate 1/).count()) > 0
}

test.describe('applying gates to a chosen scope', () => {
  test('SCOPE-1 the Apply to… menu offers all samples, each group above the sample, and the marked ones', async ({ page }) => {
    await setup(page)
    await opt(page, /Demo sample 1/).click()
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: /Apply to…/ }).click()
    const root = page.getByRole('menu', { name: 'Apply menu' })
    await root.getByRole('menuitem', { name: 'Apply the selected gate to' }).hover()
    const sub = page.getByRole('menu', { name: 'Apply the selected gate to' })
    await expect(sub.getByRole('menuitem')).toHaveText([/All samples \(3\)/, /Group Treated \(2\)/, /Subgroup Treated › Low dose \(0\)/])
    await expect(sub.getByRole('menuitem', { name: /Low dose/ })).toHaveAttribute('aria-disabled', 'true') // nobody else in it
    // the group above: its other subgroup and its own sample get the gate, the ungrouped sample does not
    await sub.getByRole('menuitem', { name: /Group Treated/ }).click()
    await expect(page.locator('.statusbar')).toContainText('Applied to 2 sample(s)')
    expect(await hasGate(page, 2)).toBe(true) // High dose
    expect(await hasGate(page, 4)).toBe(true) // Treated itself
    expect(await hasGate(page, 3)).toBe(false) // no group
    // then every sample
    await opt(page, /Demo sample 1/).click()
    await page.getByRole('treeitem', { name: /Gate 1/ }).click()
    await page.getByRole('button', { name: /Apply to…/ }).click()
    await page.getByRole('menuitem', { name: 'Apply the selected gate to' }).hover()
    await page.getByRole('menu', { name: 'Apply the selected gate to' }).getByRole('menuitem', { name: /All samples/ }).click()
    expect(await hasGate(page, 3)).toBe(true)
  })

  test('SCOPE-2 the marked samples are a scope, and the population menu has it too', async ({ page }) => {
    await setup(page)
    await opt(page, /Demo sample 3/).click()
    await drawRect(page, ...MAIN_CLUSTER) // sample 3 has no group: its gate stays in sample 3
    expect(await hasGate(page, 1)).toBe(false)
    await opt(page, /Demo sample 1/).click()
    await opt(page, /Demo sample 4/).click({ modifiers: ['Control'] })
    await opt(page, /Demo sample 3/).click({ modifiers: ['Control'] }) // the last one added is the open one
    await popRow(page, /Gate 1/).click({ button: 'right' })
    const pm = page.getByRole('menu', { name: 'Population menu' })
    await pm.getByRole('menuitem', { name: 'Apply to…' }).hover()
    const sub = page.getByRole('menu', { name: 'Apply to…' })
    await expect(sub.getByRole('menuitem', { name: /The marked samples \(2\)/ })).toBeVisible()
    await sub.getByRole('menuitem', { name: /The marked samples/ }).click()
    expect(await hasGate(page, 1)).toBe(true)
    expect(await hasGate(page, 4)).toBe(true)
    expect(await hasGate(page, 2)).toBe(false) // not marked
  })

  test('SCOPE-3 the whole gating can be replaced in a scope, after asking', async ({ page }) => {
    await setup(page)
    await opt(page, /Demo sample 1/).click()
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: /Apply to…/ }).click()
    await page.getByRole('menuitem', { name: 'Replace the whole gating of' }).hover()
    page.once('dialog', (d) => { expect(d.message()).toMatch(/Replace the gating of 3 other sample/); void d.accept() })
    await page.getByRole('menu', { name: 'Replace the whole gating of' }).getByRole('menuitem', { name: /All samples/ }).click()
    expect(await hasGate(page, 3)).toBe(true)
  })
})

test.describe('the group tree', () => {
  test('TREE-1 subgroups are drawn as branches, can be folded, and a sample says which subgroup it is in', async ({ page }) => {
    await setup(page)
    const treated = groups(page).getByRole('option', { name: /^Treated/ })
    const low = groups(page).getByRole('option', { name: /Low dose/ })
    const high = groups(page).getByRole('option', { name: /High dose/ })
    await expect(low.locator('.tree-guides .g.elbow')).toHaveCount(1)
    await expect(low.locator('.tree-guides .g.elbow.last')).toHaveCount(0) // another subgroup comes after it
    await expect(high.locator('.tree-guides .g.elbow.last')).toHaveCount(1) // the last one closes the branch
    await expect(treated.locator('.tree-guides')).toHaveCount(0)
    // folding hides the subgroups; with the keyboard too
    await treated.locator('.fold-toggle').click()
    await expect(low).toHaveCount(0)
    await expect(high).toHaveCount(0)
    await treated.focus()
    await page.keyboard.press('ArrowRight')
    await expect(low).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(low).toHaveCount(0)
    await page.keyboard.press('ArrowRight')
    // in the list of samples, the tag shows the path to its group
    await expect(opt(page, /Demo sample 1/).locator('.tag')).toHaveText('Treated › Low dose')
    await expect(opt(page, /Demo sample 4/).locator('.tag')).toHaveText('Treated')
    await expect(opt(page, /Demo sample 3/).locator('.tag')).toHaveCount(0)
  })
})
