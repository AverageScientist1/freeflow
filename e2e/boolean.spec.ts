import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, MAIN_CLUSTER, popRow, rowNumbers, menu } from './helpers'

async function twoGates(page: Page): Promise<void> {
  await loadDemo(page)
  await drawRect(page, ...MAIN_CLUSTER)
  await page.getByRole('treeitem', { name: /All events/ }).click()
  await drawRect(page, 0.3, 0.0, 0.6, 0.3)
  await expect(popRow(page, /Gate 2/)).toBeVisible()
}

async function makeBoolean(page: Page, name: string, op: 'AND' | 'OR' | 'NOT', operands: string[]): Promise<void> {
  await page.getByRole('button', { name: 'Boolean…' }).click()
  const form = page.getByRole('form', { name: 'New boolean population' })
  await form.getByRole('textbox', { name: 'Name' }).fill(name)
  await form.getByRole('combobox', { name: 'Operation' }).selectOption({ label: new RegExp(`^${op}`) as never }).catch(async () => {
    await form.getByRole('combobox', { name: 'Operation' }).selectOption(op.toLowerCase())
  })
  for (const o of operands) await form.getByLabel(o, { exact: true }).check()
  await form.getByRole('button', { name: 'Create' }).click()
}

test.describe('boolean populations', () => {
  test('BOOL-1 AND, OR and NOT give the counts set arithmetic predicts', async ({ page }) => {
    await twoGates(page)
    const g1 = (await rowNumbers(popRow(page, /^Gate 1/))).count
    const g2 = (await rowNumbers(popRow(page, /^Gate 2/))).count
    await makeBoolean(page, 'Both', 'AND', ['Gate 1', 'Gate 2'])
    await makeBoolean(page, 'Either', 'OR', ['Gate 1', 'Gate 2'])
    await makeBoolean(page, 'Not G1', 'NOT', ['Gate 1'])
    const both = (await rowNumbers(popRow(page, /Both/))).count
    const either = (await rowNumbers(popRow(page, /Either/))).count
    const notG1 = (await rowNumbers(popRow(page, /Not G1/))).count
    expect(both).toBeGreaterThan(0)
    expect(both).toBeLessThanOrEqual(Math.min(g1, g2))
    expect(either).toBe(g1 + g2 - both) // inclusion-exclusion
    expect(g1 + notG1).toBe(20000)
  })

  test('BOOL-2 a boolean needs the right number of operands and can be gated further', async ({ page }) => {
    await twoGates(page)
    await page.getByRole('button', { name: 'Boolean…' }).click()
    const form = page.getByRole('form', { name: 'New boolean population' })
    await expect(form.getByRole('button', { name: 'Create' })).toBeDisabled()
    await form.getByLabel('Gate 1', { exact: true }).check()
    await expect(form.getByRole('button', { name: 'Create' })).toBeDisabled() // AND needs two
    await form.getByLabel('Gate 2', { exact: true }).check()
    await expect(form.getByRole('button', { name: 'Create' })).toBeEnabled()
    await form.getByRole('button', { name: 'Cancel' }).click()
    await expect(form).toHaveCount(0)
  })

  test('BOOL-3 deleting an operand deletes the boolean, and it follows linked samples', async ({ page }) => {
    await twoGates(page)
    await makeBoolean(page, 'Both', 'AND', ['Gate 1', 'Gate 2'])
    const before = (await rowNumbers(popRow(page, /Both/))).count
    await menu(page, 'File', /Load demo sample/) // joins the group and takes its gating, boolean included
    await page.getByRole('option', { name: /Demo sample 2/ }).click()
    await expect(popRow(page, /Both/)).toBeVisible()
    expect((await rowNumbers(popRow(page, /Both/))).count).toBeGreaterThan(0)
    await page.getByRole('option', { name: /Demo sample 1/ }).click()
    expect((await rowNumbers(popRow(page, /Both/))).count).toBe(before)
    await popRow(page, /^Gate 2/).click()
    await page.getByRole('button', { name: 'Delete population' }).click()
    await expect(popRow(page, /Both/)).toHaveCount(0)
    await page.getByRole('option', { name: /Demo sample 2/ }).click()
    await expect(popRow(page, /Both/)).toHaveCount(0)
  })
})
