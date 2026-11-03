import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, loadDemo, drawRect, MAIN_CLUSTER, menu, addFile, spilledFcs, popRow } from './helpers'

const list = (page: Page) => page.getByRole('listbox', { name: 'Samples' })
const opt = (page: Page, name: RegExp | string) => list(page).getByRole('option', { name })
const groups = (page: Page) => page.getByRole('listbox', { name: 'Groups' })
const sampleMenu = (page: Page) => page.getByRole('menu', { name: 'Sample menu' })

async function threeSamples(page: Page): Promise<void> {
  await loadDemo(page)
  await menu(page, 'File', /Load demo sample/)
  await menu(page, 'File', /Load demo sample/)
  await expect(list(page).getByRole('option')).toHaveCount(3)
}

async function makeGroup(page: Page, name: string, sub = false): Promise<void> {
  await page.getByRole('button', { name: sub ? 'New subgroup' : 'New group' }).click()
  await page.getByRole('textbox', { name: sub ? 'New subgroup name' : 'New group name' }).fill(name)
  await page.keyboard.press('Enter')
}

test.describe('Delete inside a group', () => {
  test('DEL-1 in a subgroup, Delete takes the sample out of the subgroup; it goes up to the group and stays in the Workbench', async ({ page }) => {
    await threeSamples(page)
    await makeGroup(page, 'Treated')
    await makeGroup(page, 'Low dose', true)
    await groups(page).getByRole('option', { name: /All Samples/ }).click()
    await opt(page, /Demo sample 1/).dragTo(groups(page).getByRole('option', { name: /Low dose/ }))
    await groups(page).getByRole('option', { name: /Low dose/ }).click()
    await expect(list(page).getByRole('option')).toHaveCount(1)
    page.on('dialog', () => { throw new Error('no question should be asked when a sample only leaves a group') })
    await opt(page, /Demo sample 1/).focus()
    await page.keyboard.press('Delete')
    await expect(page.locator('.statusbar')).toContainText(/left the group and went to Treated/)
    await expect(page.locator('.statusbar')).toContainText('still in the Workbench')
    // the subgroup is empty now, the group above has it, and All Samples still has all three
    await expect(groups(page).getByRole('option', { name: /Low dose/ })).toContainText('0')
    await expect(groups(page).getByRole('option', { name: /^Treated/ })).toContainText('1')
    await groups(page).getByRole('option', { name: /All Samples/ }).click()
    await expect(list(page).getByRole('option')).toHaveCount(3)
    // from the top-level group it goes to All Samples
    await groups(page).getByRole('option', { name: /^Treated/ }).click()
    await opt(page, /Demo sample 1/).focus()
    await page.keyboard.press('Delete')
    await expect(page.locator('.statusbar')).toContainText(/went to All Samples/)
    await groups(page).getByRole('option', { name: /All Samples/ }).click()
    await expect(list(page).getByRole('option')).toHaveCount(3)
  })

  test('DEL-2 the trash button says what it does in a group and in All Samples', async ({ page }) => {
    await threeSamples(page)
    await expect(page.getByRole('button', { name: 'Remove sample', exact: true })).toBeVisible()
    await makeGroup(page, 'Treated')
    await groups(page).getByRole('option', { name: /All Samples/ }).click()
    await opt(page, /Demo sample 2/).dragTo(groups(page).getByRole('option', { name: /Treated/ }))
    await groups(page).getByRole('option', { name: /Treated/ }).click()
    await expect(page.getByRole('button', { name: 'Remove sample from the group' })).toBeVisible()
    await page.getByRole('button', { name: 'Remove sample from the group' }).click()
    await groups(page).getByRole('option', { name: /All Samples/ }).click()
    await expect(list(page).getByRole('option')).toHaveCount(3)
  })
})

test.describe('right-click menus', () => {
  test('MENU-1 a right click on a sample opens its menu; it follows the theme and closes with Escape or a click elsewhere', async ({ page }) => {
    await threeSamples(page)
    const bg = (): Promise<number> => sampleMenu(page).evaluate((el) => {
      const m = /rgba?\((\d+), (\d+), (\d+)/.exec(getComputedStyle(el).backgroundColor)!
      return (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3
    })
    await opt(page, /Demo sample 2/).click({ button: 'right' })
    await expect(sampleMenu(page)).toBeVisible()
    await expect(opt(page, /Demo sample 2/)).toHaveAttribute('aria-selected', 'true') // the sample clicked is the one it is about
    for (const item of ['Show', /Overlay "Demo sample 2"/, 'Rename…', 'Move to group', 'Gates', 'Compensation matrix', 'Export', 'File', 'Sort the list', /Remove from the Workbench/])
      await expect(sampleMenu(page).getByRole('menuitem', { name: item })).toBeVisible()
    expect(await bg()).toBeGreaterThan(200) // light theme: light menu
    await page.keyboard.press('Escape')
    await expect(sampleMenu(page)).toHaveCount(0)
    await page.getByRole('button', { name: /Switch to dark mode/ }).click()
    await opt(page, /Demo sample 2/).click({ button: 'right' })
    expect(await bg()).toBeLessThan(80) // dark theme: dark menu
    await page.mouse.click(700, 500)
    await expect(sampleMenu(page)).toHaveCount(0)
  })

  test('MENU-2 submenus open on hover or with the arrow keys, and an item acts on the sample', async ({ page }) => {
    await threeSamples(page)
    await makeGroup(page, 'Treated')
    await groups(page).getByRole('option', { name: /All Samples/ }).click()
    await opt(page, /Demo sample 3/).click({ button: 'right' })
    await sampleMenu(page).getByRole('menuitem', { name: 'Move to group' }).hover()
    const sub = page.getByRole('menu', { name: 'Move to group' })
    await expect(sub).toBeVisible()
    await sub.getByRole('menuitem', { name: 'Treated' }).click()
    await expect(sampleMenu(page)).toHaveCount(0)
    await expect(groups(page).getByRole('option', { name: /Treated/ })).toContainText('1')
    // with the keyboard
    await opt(page, /Demo sample 1/).click({ button: 'right' })
    await sampleMenu(page).getByRole('menuitem', { name: 'Move to group' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('menu', { name: 'Move to group' })).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByRole('menu', { name: 'Move to group' })).toHaveCount(0)
    await expect(sampleMenu(page).getByRole('menuitem', { name: 'Move to group' })).toBeFocused()
  })

  test('MENU-3 the menu key (Shift+F10) opens it from the keyboard and Escape gives the focus back', async ({ page }) => {
    await threeSamples(page)
    await opt(page, /Demo sample 2/).focus()
    await page.keyboard.press('Shift+F10')
    await expect(sampleMenu(page)).toBeVisible()
    await expect(sampleMenu(page).getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await expect(sampleMenu(page)).toHaveCount(0)
    await expect(opt(page, /Demo sample 2/)).toBeFocused()
  })

  test('MENU-4 with several samples marked, the menu acts on all of them', async ({ page }) => {
    await threeSamples(page)
    await opt(page, /Demo sample 1/).click()
    await opt(page, /Demo sample 3/).click({ modifiers: ['ControlOrMeta'] })
    await opt(page, /Demo sample 3/).click({ button: 'right' })
    const item = sampleMenu(page).getByRole('menuitem', { name: 'Remove 2 samples from the Workbench…' })
    await expect(item).toBeVisible()
    page.once('dialog', (d) => { void d.accept() })
    await item.click()
    await expect(list(page).getByRole('option')).toHaveCount(1)
    await expect(opt(page, /Demo sample 2/)).toBeVisible()
  })

  test('MENU-5 compensation and gates from the menu', async ({ page }) => {
    await page.goto('/')
    await addFile(page, 'spilled.fcs', spilledFcs())
    await addFile(page, 'second.fcs', spilledFcs(1000))
    await expect(list(page).getByRole('option')).toHaveCount(2)
    await opt(page, /second\.fcs/).click({ button: 'right' })
    await sampleMenu(page).getByRole('menuitem', { name: 'Compensation matrix' }).hover()
    const sub = page.getByRole('menu', { name: 'Compensation matrix' })
    await sub.getByRole('menuitem', { name: /spilled\.fcs|second\.fcs/ }).first().click()
    await expect(page.locator('.statusbar')).toContainText(/applied to 1 sample/)
    // draw a gate, then clear it from the menu (linked, so both samples lose it)
    await opt(page, /spilled\.fcs/).click()
    await drawRect(page, ...MAIN_CLUSTER)
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await opt(page, /spilled\.fcs/).click({ button: 'right' })
    await sampleMenu(page).getByRole('menuitem', { name: 'Gates' }).hover()
    page.once('dialog', (d) => { expect(d.message()).toMatch(/Remove all the gates of spilled\.fcs/); void d.accept() })
    await page.getByRole('menu', { name: 'Gates' }).getByRole('menuitem', { name: /Clear the gates/ }).click()
    await expect(popRow(page, /Gate 1/)).toHaveCount(0)
  })

  test('MENU-6 groups, populations and the empty list have menus too', async ({ page }) => {
    await threeSamples(page)
    await makeGroup(page, 'Treated')
    await groups(page).getByRole('option', { name: /Treated/ }).click({ button: 'right' })
    const gm = page.getByRole('menu', { name: 'Group menu' })
    await expect(gm).toBeVisible()
    await gm.getByRole('menuitem', { name: 'New subgroup here' }).click()
    await page.getByRole('textbox', { name: 'New subgroup name' }).fill('Inner')
    await page.keyboard.press('Enter')
    await expect(groups(page).getByRole('option', { name: /Inner/ })).toHaveAttribute('data-depth', '1')
    // a population
    await groups(page).getByRole('option', { name: /All Samples/ }).click()
    await opt(page, /Demo sample 1/).click()
    await drawRect(page, ...MAIN_CLUSTER)
    await popRow(page, /Gate 1/).click({ button: 'right' })
    const pm = page.getByRole('menu', { name: 'Population menu' })
    await expect(pm.getByRole('menuitem', { name: 'Rename…' })).toBeVisible()
    await pm.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(popRow(page, /Gate 1/)).toHaveCount(0)
    // the empty part of the list of samples
    await list(page).click({ button: 'right', position: { x: 60, y: 120 } })
    const lm = page.getByRole('menu', { name: 'List menu' })
    await expect(lm.getByRole('menuitem', { name: 'Select all' })).toBeVisible()
    await lm.getByRole('menuitem', { name: 'Select all' }).click()
    await expect(page.getByRole('button', { name: 'Remove 3 samples' })).toBeVisible()
  })

  test('MENU-7 rename from the menu, and a sorting submenu', async ({ page }) => {
    await threeSamples(page)
    await opt(page, /Demo sample 2/).click({ button: 'right' })
    await sampleMenu(page).getByRole('menuitem', { name: 'Rename…' }).click()
    await expect(page.getByRole('textbox', { name: 'Sample name' })).toBeFocused()
    await page.keyboard.type('Zed')
    await page.keyboard.press('Enter')
    await opt(page, /Zed/).click({ button: 'right' })
    await sampleMenu(page).getByRole('menuitem', { name: 'Sort the list' }).hover()
    await page.getByRole('menu', { name: 'Sort the list' }).getByRole('menuitem', { name: 'Name Z to A' }).click()
    expect((await list(page).getByRole('option').allInnerTexts())[0]).toContain('Zed')
  })

  test('MENU-A11Y an open menu has no serious accessibility violations, in both themes', async ({ page }) => {
    await threeSamples(page)
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: /Switch to dark mode/ }).click()
      await opt(page, /Demo sample 2/).click({ button: 'right' })
      await sampleMenu(page).getByRole('menuitem', { name: 'Show' }).hover()
      const r = await new AxeBuilder({ page }).analyze()
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.map((v) => `${theme}: ${v.id}: ${v.nodes.length} nodes (${v.help})`)).toEqual([])
      await page.keyboard.press('Escape')
    }
  })
})
