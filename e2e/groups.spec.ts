import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, drawRect, drawPolygon, popRow, rowNumbers, menu, addFile, fcsBuffer, MAIN_CLUSTER } from './helpers'
import { makeDemoFcs } from '../src/core/synth'

const samples = (page: Page) => page.getByRole('listbox', { name: 'Samples' }).getByRole('option')
const sample = (page: Page, name: RegExp | string) => page.getByRole('listbox', { name: 'Samples' }).getByRole('option', { name })
const groups = (page: Page) => page.getByRole('listbox', { name: 'Groups' }).getByRole('option')
const group = (page: Page, name: RegExp | string) => page.getByRole('listbox', { name: 'Groups' }).getByRole('option', { name })
const X = (page: Page) => page.getByRole('combobox', { name: 'X', exact: true })
const Y = (page: Page) => page.getByRole('combobox', { name: 'Y', exact: true })

// Three demo-like files with different seeds, so gating counts differ a little between them.
// Gates are linked across a group by default; the tests about independent copies turn that off.
async function loadThree(page: Page, linked = true): Promise<void> {
  await page.goto('/')
  for (const [i, n] of ['a.fcs', 'b.fcs', 'c.fcs'].entries()) await addFile(page, n, Buffer.from(makeDemoFcs(i + 1, 6000)))
  await expect(samples(page)).toHaveCount(3)
  if (!linked) await page.getByLabel('Link gates in group').uncheck()
  await sample(page, /a\.fcs/).click()
}

async function newGroup(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New group' }).click()
  await page.getByLabel('New group name').fill(name)
  await page.keyboard.press('Enter')
  await expect(group(page, new RegExp(name))).toBeVisible()
}

async function moveTo(page: Page, sampleName: RegExp, groupName: string): Promise<void> {
  await group(page, /All Samples/).click()
  await sample(page, sampleName).click()
  await page.getByRole('combobox', { name: 'Group' }).selectOption({ label: groupName })
}

test.describe('groups', () => {
  test('GRP-1 a new group starts empty; moving samples into it; All Samples keeps everything', async ({ page }) => {
    await loadThree(page)
    await expect(group(page, /All Samples/)).toContainText('3')
    await newGroup(page, 'Treated')
    await expect(samples(page)).toHaveCount(0) // the new group is open and empty
    await expect(page.getByText(/No samples in this group/)).toBeVisible()
    await moveTo(page, /a\.fcs/, 'Treated')
    await moveTo(page, /b\.fcs/, 'Treated')
    await expect(group(page, /Treated/)).toContainText('2')
    await expect(group(page, /All Samples/)).toContainText('3')
    await group(page, /Treated/).click()
    await expect(samples(page)).toHaveCount(2)
    await group(page, /All Samples/).click()
    await expect(samples(page)).toHaveCount(3)
  })

  test('GRP-2 rename and delete a group; its samples stay in All Samples', async ({ page }) => {
    await loadThree(page)
    await newGroup(page, 'Temp')
    await moveTo(page, /c\.fcs/, 'Temp')
    await group(page, /Temp/).dblclick()
    await page.getByLabel('Group name').fill('Controls')
    await page.keyboard.press('Enter')
    await expect(group(page, /Controls/)).toBeVisible()
    await group(page, /Controls/).click()
    await page.getByRole('button', { name: 'Delete group' }).click()
    await expect(groups(page)).toHaveCount(1)
    await expect(samples(page)).toHaveCount(3)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(group(page, /Controls/)).toBeVisible()
  })

  test('GRP-3 the group list cannot rename or delete All Samples; empty names are ignored', async ({ page }) => {
    await loadThree(page)
    await group(page, /All Samples/).dblclick()
    await expect(page.getByLabel('Group name')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete group' })).toBeDisabled()
    await page.getByRole('button', { name: 'New group' }).click()
    await page.getByLabel('New group name').fill('   ')
    await page.keyboard.press('Enter')
    await expect(groups(page)).toHaveCount(1)
  })

  test('GRP-4 each sample has its own gating tree', async ({ page }) => {
    await loadThree(page, false)
    await drawRect(page, ...MAIN_CLUSTER)
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await sample(page, /b\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toHaveCount(0) // not shared
    await expect(page.getByRole('treeitem')).toHaveCount(1)
    await sample(page, /a\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })
})

test.describe('apply gate to group', () => {
  test('GRP-5 Apply to group copies the gate to the other samples', async ({ page }) => {
    await loadThree(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const a = await rowNumbers(popRow(page, /Gate 1/))
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await expect(page.getByText(/Applied to 2 sample\(s\)/)).toBeVisible()
    for (const n of [/b\.fcs/, /c\.fcs/]) {
      await sample(page, n).click()
      await expect(popRow(page, /Gate 1/)).toBeVisible()
      const r = await rowNumbers(popRow(page, /Gate 1/))
      expect(Math.abs(r.pct - a.pct)).toBeLessThan(3) // same gate on similar data
    }
  })

  test('GRP-6 a copy is independent: deleting it in one sample leaves the others', async ({ page }) => {
    await loadThree(page, false)
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await sample(page, /b\.fcs/).click()
    await popRow(page, /Gate 1/).click()
    await page.getByRole('button', { name: /Delete population/ }).click()
    await expect(page.getByRole('treeitem')).toHaveCount(1)
    await sample(page, /c\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await sample(page, /a\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })

  test('GRP-7 children travel with the gate; applying a child needs its parent elsewhere', async ({ page }) => {
    await loadThree(page, false)
    await drawRect(page, ...MAIN_CLUSTER)
    await popRow(page, /Gate 1/).click()
    await X(page).selectOption({ label: 'FL1-A :: Marker A FITC' })
    await Y(page).selectOption({ label: 'FL2-A :: Marker B PE' })
    await drawRect(page, 0.55, 0.55, 1, 1)
    await expect(popRow(page, /Gate 2/)).toBeVisible()
    // the child alone cannot be applied: the others have no "Gate 1" to put it under
    await popRow(page, /Gate 2/).click()
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: /skipped/ })).toBeVisible()
    await sample(page, /b\.fcs/).click()
    await expect(page.getByRole('treeitem')).toHaveCount(1)
    // the parent brings the child along
    await sample(page, /a\.fcs/).click()
    await popRow(page, /Gate 1/).click()
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await sample(page, /b\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await expect(popRow(page, /Gate 2/)).toBeVisible()
    expect(await popRow(page, /Gate 2/).getAttribute('aria-level')).toBe('3')
  })

  test('GRP-8 applying again replaces instead of duplicating', async ({ page }) => {
    await loadThree(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await sample(page, /b\.fcs/).click()
    await expect(page.getByRole('treeitem')).toHaveCount(2)
  })

  test('GRP-9 only the samples of the custom group receive it', async ({ page }) => {
    await loadThree(page)
    await newGroup(page, 'Pair')
    await moveTo(page, /a\.fcs/, 'Pair')
    await moveTo(page, /b\.fcs/, 'Pair')
    await group(page, /Pair/).click()
    await sample(page, /a\.fcs/).click()
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await expect(page.getByText(/Applied to 1 sample\(s\)/)).toBeVisible()
    await group(page, /All Samples/).click()
    await sample(page, /c\.fcs/).click()
    await expect(page.getByRole('treeitem')).toHaveCount(1) // c is not in the group
  })

  test('GRP-10 Resync all replaces the other samples\' whole gating (and asks first)', async ({ page }) => {
    await loadThree(page, false)
    await drawRect(page, ...MAIN_CLUSTER)
    await sample(page, /b\.fcs/).click()
    await drawRect(page, 0.5, 0.2, 0.7, 0.5)
    await drawPolygon(page, [[0.0, 0.0], [0.1, 0.0], [0.1, 0.1], [0.0, 0.1]])
    await expect(page.getByRole('treeitem')).toHaveCount(3) // b has Gate 1 and Gate 2
    await sample(page, /a\.fcs/).click()
    let asked = ''
    page.once('dialog', (d) => { asked = d.message(); void d.dismiss() })
    await page.getByRole('button', { name: 'Resync all' }).click()
    expect(asked).toMatch(/Replace the gating of 2 other sample/)
    await sample(page, /b\.fcs/).click()
    await expect(page.getByRole('treeitem')).toHaveCount(3) // dismissing changed nothing
    await sample(page, /a\.fcs/).click()
    page.once('dialog', (d) => void d.accept())
    await page.getByRole('button', { name: 'Resync all' }).click()
    await sample(page, /b\.fcs/).click()
    await expect(page.getByRole('treeitem')).toHaveCount(2) // exactly a's tree: root and Gate 1
  })

  test('GRP-11 undo reverts Apply to group in one step', async ({ page }) => {
    await loadThree(page, false)
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await page.getByRole('button', { name: 'Undo' }).click()
    await sample(page, /b\.fcs/).click()
    await expect(page.getByRole('treeitem')).toHaveCount(1)
    await sample(page, /a\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible() // a's own gate is still there
  })

  test('GRP-12 the buttons are off with no other sample or no selected gate', async ({ page }) => {
    await page.goto('/')
    await addFile(page, 'only.fcs', Buffer.from(makeDemoFcs(1, 3000)))
    await expect(page.getByRole('button', { name: 'Apply to group', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Resync all' })).toBeDisabled()
    await addFile(page, 'two.fcs', Buffer.from(makeDemoFcs(2, 3000)))
    await expect(page.getByRole('button', { name: 'Resync all' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Apply to group', exact: true })).toBeDisabled() // root selected
  })

  test('GRP-13 Alt+G and the Gating menu do the same', async ({ page }) => {
    await loadThree(page, false)
    await drawRect(page, ...MAIN_CLUSTER)
    await page.keyboard.press('Alt+g')
    await expect(page.getByText(/Applied to 2 sample\(s\)/)).toBeVisible()
    await sample(page, /b\.fcs/).click()
    await popRow(page, /Gate 1/).click()
    await page.getByRole('button', { name: /Delete population/ }).click()
    await sample(page, /a\.fcs/).click()
    await popRow(page, /Gate 1/).click()
    await menu(page, 'Gating', /^Apply gate to group\s+Alt\+G$/)
    await sample(page, /b\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })

  test('GRP-14 a copied gate whose parameter is missing in a sample is flagged and empty there', async ({ page }) => {
    await loadThree(page)
    await addFile(page, 'other.fcs', fcsBuffer(80, [{ name: 'FSC-A', range: 262144 }, { name: 'CD3', range: 262144 }]))
    await sample(page, /a\.fcs/).click()
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: /lack a parameter/ })).toBeVisible()
    await sample(page, /other\.fcs/).click()
    expect((await rowNumbers(popRow(page, /Gate 1/))).count).toBe(0)
  })
})

test.describe('group view and file', () => {
  test('GRP-15 the group table compares the same population across the group', async ({ page }) => {
    await loadThree(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await popRow(page, /Gate 1/).click()
    const table = page.getByRole('region', { name: /Gate 1 across All Samples/ })
    await expect(table).toBeVisible()
    await expect(table.getByRole('row')).toHaveCount(4) // header and 3 samples
    // clicking a sample name moves there and keeps looking at "Gate 1"
    await table.getByRole('button', { name: 'b.fcs' }).click()
    await expect(page.getByRole('treeitem', { name: /Gate 1/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('GRP-16 switching samples keeps the same population selected when it exists there', async ({ page }) => {
    await loadThree(page)
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await popRow(page, /Gate 1/).click()
    await sample(page, /c\.fcs/).click()
    await expect(page.getByRole('treeitem', { name: /Gate 1/ })).toHaveAttribute('aria-selected', 'true')
    await sample(page, /b\.fcs/).click()
    await popRow(page, /Gate 1/).click()
    await page.getByRole('button', { name: /Delete population/ }).click()
    await expect(page.getByRole('treeitem', { name: /All events/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('GRP-17 groups and per-sample gating survive save and reopen', async ({ page }) => {
    await page.goto('/')
    // demo samples can be rebuilt on open, so this round trip does not need the files
    for (let i = 0; i < 2; i++) {
      await page.getByRole('menuitem', { name: 'File', exact: true }).click()
      await page.getByRole('menuitem', { name: /Load demo sample/ }).click()
    }
    await newGroup(page, 'Both')
    await moveTo(page, /Demo sample 1/, 'Both')
    await moveTo(page, /Demo sample 2/, 'Both')
    await group(page, /Both/).click()
    await sample(page, /Demo sample 1/).click()
    await drawRect(page, ...MAIN_CLUSTER)
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const wb = JSON.parse(readFileSync(await dl.path(), 'utf8'))
    expect(wb.version).toBe(3)
    expect(wb.groups.map((g: { name: string }) => g.name)).toEqual(['Both'])
    expect(Object.keys(wb.groupOf)).toHaveLength(2)
    const owned = wb.populations.filter((p: { sampleId?: string }) => p.sampleId)
    expect(new Set(owned.map((p: { sampleId: string }) => p.sampleId)).size).toBe(2)

    page.on('dialog', (d) => void d.accept())
    await menu(page, 'File', /New Workbench/)
    const chooser = page.waitForEvent('filechooser')
    await menu(page, 'File', /Open Workbench/)
    await (await chooser).setFiles({ name: 'g.fcwb', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wb)) })
    await expect(group(page, /Both/)).toContainText('2')
    await group(page, /Both/).click()
    await sample(page, /Demo sample 2/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })

  test('GRP-18 an older Workbench file (one shared tree) gives every sample its own copy', async ({ page }) => {
    await page.goto('/')
    for (let i = 0; i < 2; i++) {
      await page.getByRole('menuitem', { name: 'File', exact: true }).click()
      await page.getByRole('menuitem', { name: /Load demo sample/ }).click()
    }
    await sample(page, /Demo sample 1/).click()
    await drawRect(page, ...MAIN_CLUSTER)
    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const wb = JSON.parse(readFileSync(await dl.path(), 'utf8'))
    // turn it into a version 1 file: shared populations, no groups, gates measured on the screen, nothing linked
    wb.version = 1
    delete wb.groups
    delete wb.groupOf
    delete wb.gateSpace
    delete wb.linkGates
    // an old file had ONE shared tree, not one per sample
    const firstSample = wb.samples[0].id
    wb.populations = wb.populations.filter((p: { id: string; sampleId?: string }) => p.id === 'root' || p.sampleId === firstSample)
    const used = new Set(wb.populations.map((p: { gateId: string | null }) => p.gateId))
    wb.gates = wb.gates.filter((g: { id: string }) => used.has(g.id))
    for (const p of wb.populations) delete p.sampleId
    wb.gates[0].geometry = { type: 'rectangle', x0: 0.18, y0: 0, x1: 0.45, y1: 0.2 }
    page.on('dialog', (d) => void d.accept())
    const chooser = page.waitForEvent('filechooser')
    await menu(page, 'File', /Open Workbench/)
    await (await chooser).setFiles({ name: 'old.fcwb', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wb)) })
    for (const n of [/Demo sample 1/, /Demo sample 2/]) {
      await sample(page, n).click()
      await expect(popRow(page, /Gate 1/)).toBeVisible()
    }
    // and they are now independent
    await popRow(page, /Gate 1/).click()
    await page.getByRole('button', { name: /Delete population/ }).click()
    await sample(page, /Demo sample 1/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`GRP-19 accessibility scan with groups and the group table (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await loadThree(page)
      await newGroup(page, 'Pair')
      await drawRect(page, ...MAIN_CLUSTER)
      await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
      await popRow(page, /Gate 1/).click()
      const r = await new AxeBuilder({ page }).analyze()
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.map((v) => `${v.id}: ${v.nodes.length} nodes (${v.help})`)).toEqual([])
    })
  }
})


