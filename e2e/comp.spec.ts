import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, popRow, rowNumbers, menu, addFile, fcsBuffer, spilledFcs } from './helpers'

const X = (page: Page) => page.getByRole('combobox', { name: 'X', exact: true })
const Y = (page: Page) => page.getByRole('combobox', { name: 'Y', exact: true })
const modeButton = (page: Page, name: 'Compensation' | 'Graphs') => page.getByRole('navigation', { name: 'Modes' }).getByRole('button', { name })
const cell = (page: Page, from: string, to: string) => page.getByRole('textbox', { name: `${from} into ${to}` })

async function loadSpilled(page: Page): Promise<void> {
  await page.goto('/')
  await addFile(page, 'spilled.fcs', spilledFcs())
  await expect(page.getByRole('listbox', { name: 'Samples' }).getByRole('option', { name: /spilled\.fcs/ })).toBeVisible()
}

async function optionTexts(select: ReturnType<typeof X>): Promise<string[]> {
  return select.locator('option').allInnerTexts()
}

test.describe('compensation', () => {
  test('COMP-1 a spillover matrix in the file is offered, not applied', async ({ page }) => {
    await loadSpilled(page)
    await modeButton(page, 'Compensation').click()
    await expect(page.getByRole('heading', { name: 'Compensation', level: 1 })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Matrix' })).toContainText('spilled.fcs')
    await expect(cell(page, 'FL1-A', 'FL2-A')).toHaveValue('0.2')
    await expect(cell(page, 'FL2-A', 'FL1-A')).toHaveValue('0.05')
    await expect(cell(page, 'FL1-A', 'FL1-A')).toHaveValue('1')
    await expect(page.getByText('Not applied to any sample.')).toBeVisible()
    // nothing is applied yet: the plot parameters are the file's own
    await modeButton(page, 'Graphs').click()
    expect((await optionTexts(X(page))).some((t) => t.startsWith('Comp-'))).toBe(false)
  })

  test('COMP-2 applying the matrix recovers the true populations; without it they are mixed', async ({ page }) => {
    await loadSpilled(page)
    await modeButton(page, 'Compensation').click()
    await page.getByRole('button', { name: 'Apply to this sample' }).click()
    await expect(page.getByText('Applied to: spilled.fcs')).toBeVisible()
    await modeButton(page, 'Graphs').click()
    expect((await optionTexts(X(page))).some((t) => t.startsWith('Comp-FL1-A'))).toBe(true)

    // uncompensated: FL1-positive cells leak into FL2, so the FL1+ / FL2-negative corner is almost empty
    await X(page).selectOption({ label: 'FL1-A :: Marker A FITC' })
    await Y(page).selectOption({ label: 'FL2-A :: Marker B PE' })
    await drawRect(page, 0.6, 0.0, 1, 0.35)
    const raw = await rowNumbers(popRow(page, /Gate 1/))
    expect(raw.pct).toBeLessThan(5)

    // compensated: about 40% x 50% = 20% are FL1+ and FL2-
    await popRow(page, /All events/).click()
    await X(page).selectOption({ label: 'Comp-FL1-A :: Marker A FITC' })
    await Y(page).selectOption({ label: 'Comp-FL2-A :: Marker B PE' })
    await drawRect(page, 0.6, 0.0, 1, 0.35)
    const comp = await rowNumbers(popRow(page, /Gate 2/))
    expect(comp.pct).toBeGreaterThan(15)
    expect(comp.pct).toBeLessThan(25)
  })

  test('COMP-3 editing a value, an invalid entry and undo', async ({ page }) => {
    await loadSpilled(page)
    await modeButton(page, 'Compensation').click()
    await cell(page, 'FL1-A', 'FL2-A').fill('0.3')
    await cell(page, 'FL1-A', 'FL2-A').press('Enter')
    await expect(cell(page, 'FL1-A', 'FL2-A')).toHaveValue('0.3')
    await cell(page, 'FL1-A', 'FL2-A').fill('abc')
    await cell(page, 'FL1-A', 'FL2-A').press('Enter')
    await expect(cell(page, 'FL1-A', 'FL2-A')).toHaveValue('0.3') // refused, value restored
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(cell(page, 'FL1-A', 'FL2-A')).toHaveValue('0.2')
  })

  test('COMP-4 a matrix that cannot be inverted is refused', async ({ page }) => {
    await loadSpilled(page)
    await modeButton(page, 'Compensation').click()
    await cell(page, 'FL1-A', 'FL2-A').fill('20') // 20 x 0.05 = 1: singular
    await cell(page, 'FL1-A', 'FL2-A').press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: /cannot be inverted/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply to this sample' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Apply to all samples' })).toBeDisabled()
  })

  test('COMP-5 apply to all skips samples that lack a parameter', async ({ page }) => {
    await loadSpilled(page)
    await addFile(page, 'other.fcs', fcsBuffer(50, [{ name: 'CD3', range: 262144 }, { name: 'CD4', range: 262144 }]))
    await page.getByRole('option', { name: /spilled\.fcs/ }).click()
    await modeButton(page, 'Compensation').click()
    await page.getByRole('button', { name: 'Apply to all samples' }).click()
    await expect(page.getByText(/applied to 1 sample\(s\); 1 skipped/)).toBeVisible()
    await expect(page.getByText('Applied to: spilled.fcs')).toBeVisible()
  })

  test('COMP-6 removing the matrix removes the Comp- parameters; a gate on one becomes empty', async ({ page }) => {
    await loadSpilled(page)
    await modeButton(page, 'Compensation').click()
    await page.getByRole('button', { name: 'Apply to this sample' }).click()
    await modeButton(page, 'Graphs').click()
    await X(page).selectOption({ label: 'Comp-FL1-A :: Marker A FITC' })
    await Y(page).selectOption({ label: 'Comp-FL2-A :: Marker B PE' })
    await drawRect(page, 0.6, 0.0, 1, 0.35)
    expect((await rowNumbers(popRow(page, /Gate 1/))).count).toBeGreaterThan(500)
    await modeButton(page, 'Compensation').click()
    await page.getByRole('button', { name: 'Remove from this sample' }).click()
    await modeButton(page, 'Graphs').click()
    expect((await optionTexts(X(page))).some((t) => t.startsWith('Comp-'))).toBe(false)
    expect((await rowNumbers(popRow(page, /Gate 1/))).count).toBe(0) // the gate needs a parameter this sample no longer has
  })

  test('COMP-7 undo of applying removes the Comp- parameters', async ({ page }) => {
    await loadSpilled(page)
    await modeButton(page, 'Compensation').click()
    await page.getByRole('button', { name: 'Apply to this sample' }).click()
    await expect(page.getByText('Applied to: spilled.fcs')).toBeVisible()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Not applied to any sample.')).toBeVisible()
  })

  test('COMP-8 make a matrix by hand, apply it, save and reopen', async ({ page }) => {
    await loadDemo(page)
    await modeButton(page, 'Compensation').click()
    await expect(page.getByRole('heading', { name: 'No compensation matrix' })).toBeVisible()
    await page.getByRole('button', { name: 'New matrix' }).click()
    await expect(page.getByRole('button', { name: 'Create' })).toBeDisabled()
    await page.getByLabel('FL1-A').check()
    await page.getByLabel('FL2-A').check()
    await page.getByLabel('Name').first().fill('By hand')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(cell(page, 'FL1-A', 'FL1-A')).toHaveValue('1')
    await expect(cell(page, 'FL1-A', 'FL2-A')).toHaveValue('0')
    await expect(page.getByText('This is an identity matrix: it changes nothing.')).toBeVisible()
    await cell(page, 'FL1-A', 'FL2-A').fill('0.1')
    await cell(page, 'FL1-A', 'FL2-A').press('Enter')
    await page.getByRole('button', { name: 'Apply to this sample' }).click()

    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const wb = JSON.parse(readFileSync(await dl.path(), 'utf8'))
    expect(wb.compensation.matrices[0].name).toBe('By hand')
    expect(wb.compensation.matrices[0].values).toEqual([[1, 0.1], [0, 1]])
    expect(Object.keys(wb.compensation.assignments)).toHaveLength(1)

    page.on('dialog', (d) => void d.accept())
    await menu(page, 'File', /New Workbench/)
    const chooser = page.waitForEvent('filechooser')
    await menu(page, 'File', /Open Workbench/)
    await (await chooser).setFiles({ name: 'x.fcwb', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wb)) })
    await modeButton(page, 'Graphs').click()
    expect((await optionTexts(X(page))).some((t) => t.startsWith('Comp-FL1-A'))).toBe(true)
  })

  test('COMP-9 the Alt+3 and Alt+4 shortcuts switch modes', async ({ page }) => {
    await loadDemo(page)
    await page.keyboard.press('Alt+3')
    await expect(page.getByRole('heading', { name: 'Compensation', level: 1 })).toBeVisible()
    await page.keyboard.press('Alt+4')
    await expect(page.getByRole('heading', { name: 'Graphs', level: 1 })).toBeVisible()
  })

  test('COMP-10 a matrix whose parameters the selected sample lacks cannot be applied there', async ({ page }) => {
    await loadSpilled(page)
    await addFile(page, 'other.fcs', fcsBuffer(50, [{ name: 'CD3', range: 262144 }, { name: 'CD4', range: 262144 }]))
    await page.getByRole('option', { name: /other\.fcs/ }).click()
    await modeButton(page, 'Compensation').click()
    await expect(page.getByText(/has no parameter named FL1-A, FL2-A/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply to this sample' })).toBeDisabled()
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`COMP-11 accessibility scan of the compensation screen (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await loadSpilled(page)
      await modeButton(page, 'Compensation').click()
      await expect(cell(page, 'FL1-A', 'FL2-A')).toBeVisible()
      const r = await new AxeBuilder({ page }).analyze()
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.map((v) => `${v.id}: ${v.nodes.length} nodes (${v.help})`)).toEqual([])
    })
  }

  test('COMP-12 an old Workbench file without a compensation section still opens', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, 0.18, 0.0, 0.45, 0.2)
    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const wb = JSON.parse(readFileSync(await dl.path(), 'utf8'))
    delete wb.compensation
    page.on('dialog', (d) => void d.accept())
    const chooser = page.waitForEvent('filechooser')
    await menu(page, 'File', /Open Workbench/)
    await (await chooser).setFiles({ name: 'old.fcwb', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wb)) })
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })
})

