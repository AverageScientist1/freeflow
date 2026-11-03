import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, plotBox, px, popRow, rowNumbers, menu, addFile } from './helpers'
import { mulberry32, writeFcs } from '../src/core/synth'

// The scenario that matters: gate a reference ("wild type") sample, switch to the others, and read off the outliers.

const samples = (page: Page) => page.getByRole('listbox', { name: 'Samples' }).getByRole('option')
const sample = (page: Page, name: RegExp) => page.getByRole('listbox', { name: 'Samples' }).getByRole('option', { name })
const group = (page: Page, name: RegExp) => page.getByRole('listbox', { name: 'Groups' }).getByRole('option', { name })

// FL1-H sits around `level` (log-normal), FSC and SSC are the same for every file
function fcs(level: number, seed: number, n = 8000): Buffer {
  const rand = mulberry32(seed)
  const g = (): number => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-9))) * Math.cos(2 * Math.PI * rand())
  const fsc = Float32Array.from({ length: n }, () => 100000 + 25000 * g())
  const ssc = Float32Array.from({ length: n }, () => 30000 + 8000 * g())
  const fl1 = Float32Array.from({ length: n }, () => level * Math.exp(0.35 * g()) - 120 * rand())
  return Buffer.from(writeFcs([{ name: 'FSC-A', range: 262144 }, { name: 'SSC-A', range: 262144 }, { name: 'FL1-H', stain: 'FDG FITC-H', range: 262144 }], [fsc, ssc, fl1]))
}

async function load(page: Page, files: [string, number, number][]): Promise<void> {
  await page.goto('/')
  for (const [name, level, seed] of files) await addFile(page, name, fcs(level, seed))
  await expect(samples(page)).toHaveCount(files.length)
  await sample(page, new RegExp(files[0][0].replace('.', '\\.'))).click()
}

async function histogramOfFl1(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: 'X', exact: true }).selectOption({ label: 'FL1-H :: FDG FITC-H' })
  await page.getByRole('combobox', { name: 'Plot type' }).selectOption('histogram')
}

// a range around where the reference sample sits (about 600)
async function gateReference(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Range gate/ }).click()
  const box = await plotBox(page)
  const [ax, ay] = px(box, 0.3, 0.5)
  const [bx] = px(box, 0.66, 0.5)
  await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, ay); await page.mouse.up()
  await expect(popRow(page, /Gate 1/)).toBeVisible()
}

async function savedGates(page: Page): Promise<{ id: string; geometry: { x0: number; x1: number } }[]> {
  const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
  const wb = JSON.parse(readFileSync(await dl.path(), 'utf8'))
  return wb.gates
}

const pct = async (page: Page): Promise<number> => (await rowNumbers(popRow(page, /Gate 1/))).pct
const count = async (page: Page): Promise<number> => (await rowNumbers(popRow(page, /Gate 1/))).count

test.describe('a reference sample and the others', () => {
  test('LINK-1 the gate drawn on the reference follows to the other samples, which show their share inside', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2], ['near.fcs', 900, 3]])
    await histogramOfFl1(page)
    await gateReference(page)
    const wt = await pct(page)
    expect(wt).toBeGreaterThan(80) // most of the reference is inside its own gate

    await sample(page, /mutant\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible() // it followed, no extra click
    const mutant = await pct(page)
    expect(mutant).toBeLessThan(wt - 40) // most of the shifted sample is outside: the outliers

    await sample(page, /near\.fcs/).click()
    const near = await pct(page)
    expect(near).toBeGreaterThan(mutant) // a sample close to the reference is mostly inside
  })

  test('LINK-2 every sample gets exactly the same thresholds, in real values', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2]])
    await histogramOfFl1(page)
    await gateReference(page)
    const gates = await savedGates(page)
    expect(gates).toHaveLength(2) // one per sample
    expect(gates[1].geometry.x0).toBeCloseTo(gates[0].geometry.x0, 6)
    expect(gates[1].geometry.x1).toBeCloseTo(gates[0].geometry.x1, 6)
    expect(gates[0].geometry.x0).toBeGreaterThan(100) // real FL1-H values, not a position between 0 and 1
    expect(gates[0].geometry.x1).toBeGreaterThan(gates[0].geometry.x0)
  })

  test('LINK-3 changing the scale does not move the gate off its events', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2]])
    await histogramOfFl1(page)
    await gateReference(page)
    const before = { count: await count(page), pct: await pct(page), gates: await savedGates(page) }
    await sample(page, /mutant\.fcs/).click()
    const mutantBefore = await pct(page)
    await sample(page, /wt\.fcs/).click()
    await page.getByRole('button', { name: 'Scale for the X axis' }).click()
    await page.getByLabel('Extra negative decades value').fill('1.8')
    await page.getByLabel('Width (decades) value').fill('1.2')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    expect(Math.abs((await count(page)) - before.count)).toBeLessThanOrEqual(before.count * 0.01 + 3) // the same events
    const after = await savedGates(page)
    expect(after[0].geometry.x0).toBeCloseTo(before.gates[0].geometry.x0, 6) // the same values
    expect(after[0].geometry.x1).toBeCloseTo(before.gates[0].geometry.x1, 6)
    // and the other sample did not change either
    await sample(page, /mutant\.fcs/).click()
    expect(Math.abs((await pct(page)) - mutantBefore)).toBeLessThan(0.5)
  })

  test('LINK-4 a parameter has the same default scale in every sample', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2]])
    await histogramOfFl1(page)
    await page.getByRole('button', { name: 'Scale for the X axis' }).click()
    const read = async (): Promise<string[]> => [await page.getByLabel('Positive decades value').inputValue(), await page.getByLabel('Width (decades) value').inputValue(), await page.getByLabel('Extra negative decades value').inputValue()]
    const first = await read()
    await sample(page, /mutant\.fcs/).click()
    expect(await read()).toEqual(first)
  })

  test('LINK-5 renaming and deleting in one sample are mirrored', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2]])
    await histogramOfFl1(page)
    await gateReference(page)
    await popRow(page, /Gate 1/).dblclick()
    await page.getByLabel('Population name').fill('Baseline')
    await page.keyboard.press('Enter')
    await sample(page, /mutant\.fcs/).click()
    await expect(popRow(page, /Baseline/)).toBeVisible()
    await popRow(page, /Baseline/).click()
    await page.getByRole('button', { name: /Delete population/ }).click()
    await sample(page, /wt\.fcs/).click()
    await expect(page.getByRole('treeitem')).toHaveCount(1) // gone from the reference too
  })

  test('LINK-6 moving a gate in one sample moves it in the others', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2]])
    await histogramOfFl1(page)
    await gateReference(page)
    const before = await savedGates(page)
    const box = await plotBox(page)
    const [ax, ay] = px(box, 0.5, 0.5)
    const [bx] = px(box, 0.8, 0.5)
    await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, ay); await page.mouse.up() // drag the gate to the right
    await expect.poll(async () => (await savedGates(page))[1].geometry.x0).toBeGreaterThan(before[1].geometry.x0 * 2)
    const after = await savedGates(page)
    expect(after[1].geometry.x0).toBeCloseTo(after[0].geometry.x0, 6)
  })

  test('LINK-7 one undo reverts the change in every sample', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2], ['near.fcs', 900, 3]])
    await histogramOfFl1(page)
    await gateReference(page)
    await page.getByRole('button', { name: 'Undo' }).click()
    for (const n of [/wt\.fcs/, /mutant\.fcs/, /near\.fcs/]) {
      await sample(page, n).click()
      await expect(page.getByRole('treeitem')).toHaveCount(1)
    }
  })

  test('LINK-8 a sample added later takes the gating the others already have', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2]])
    await histogramOfFl1(page)
    await gateReference(page)
    await addFile(page, 'late.fcs', fcs(700, 9))
    await sample(page, /late\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    expect(await pct(page)).toBeGreaterThan(70)
  })

  test('LINK-9 a custom group is its own family: other samples are left alone', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2], ['other.fcs', 900, 3]])
    await page.getByRole('button', { name: 'New group' }).click()
    await page.getByLabel('New group name').fill('Pair')
    await page.keyboard.press('Enter')
    for (const n of [/wt\.fcs/, /mutant\.fcs/]) {
      await group(page, /All Samples/).click()
      await sample(page, n).click()
      await page.getByRole('combobox', { name: 'Group' }).selectOption({ label: 'Pair' })
    }
    await group(page, /Pair/).click()
    await sample(page, /wt\.fcs/).click()
    await histogramOfFl1(page)
    await gateReference(page)
    await sample(page, /mutant\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await group(page, /All Samples/).click()
    await sample(page, /other\.fcs/).click()
    await expect(page.getByRole('treeitem')).toHaveCount(1) // not in the group: untouched
  })

  test('LINK-10 a sample moved into a group takes the gating that group has', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2], ['joiner.fcs', 800, 3]])
    await page.getByRole('button', { name: 'New group' }).click()
    await page.getByLabel('New group name').fill('Pair')
    await page.keyboard.press('Enter')
    for (const n of [/wt\.fcs/, /mutant\.fcs/]) {
      await group(page, /All Samples/).click()
      await sample(page, n).click()
      await page.getByRole('combobox', { name: 'Group' }).selectOption({ label: 'Pair' })
    }
    await group(page, /Pair/).click()
    await sample(page, /wt\.fcs/).click()
    await histogramOfFl1(page)
    await gateReference(page)
    await group(page, /All Samples/).click()
    await sample(page, /joiner\.fcs/).click()
    await expect(page.getByRole('treeitem')).toHaveCount(1)
    await page.getByRole('combobox', { name: 'Group' }).selectOption({ label: 'Pair' })
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })
})

test.describe('the link switch', () => {
  test('LINK-11 off: samples are independent. On again: it asks, and agrees with the sample you are on', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2]])
    await histogramOfFl1(page)
    await gateReference(page)
    const link = page.getByLabel('Link gates in group')
    await expect(link).toBeChecked()
    await link.uncheck()
    await sample(page, /mutant\.fcs/).click()
    await popRow(page, /Gate 1/).click()
    await page.getByRole('button', { name: /Delete population/ }).click()
    await expect(page.getByRole('treeitem')).toHaveCount(1)
    await sample(page, /wt\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible() // independent: the reference kept its gate

    let asked = ''
    page.once('dialog', (d) => { asked = d.message(); void d.dismiss() })
    await link.click() // the app refuses, so the box stays as it was (check() would complain that nothing changed)
    expect(asked).toMatch(/Make the gating of 1 other sample/)
    await expect(link).not.toBeChecked() // dismissing keeps it off

    page.once('dialog', (d) => void d.accept())
    await link.check()
    await expect(link).toBeChecked()
    await sample(page, /mutant\.fcs/).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible() // the reference's gating was copied over
  })

  test('LINK-12 switching it on asks nothing when the samples already agree', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2]])
    const link = page.getByLabel('Link gates in group')
    await link.uncheck()
    let asked = false
    page.once('dialog', (d) => { asked = true; void d.dismiss() })
    await link.check()
    expect(asked).toBe(false)
    await expect(link).toBeChecked()
  })

  test('LINK-13 the Gating menu shows and changes the setting', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2]])
    await page.getByRole('menuitem', { name: 'Gating', exact: true }).click()
    await expect(page.getByRole('menuitemcheckbox', { name: /Link gates in group/ })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('menuitemcheckbox', { name: /Link gates in group/ }).click()
    await expect(page.getByLabel('Link gates in group')).not.toBeChecked()
  })

  test('LINK-14 the setting is saved in the Workbench and comes back', async ({ page }) => {
    await load(page, [['wt.fcs', 600, 1], ['mutant.fcs', 20000, 2]])
    await page.getByLabel('Link gates in group').uncheck()
    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const wb = JSON.parse(readFileSync(await dl.path(), 'utf8'))
    expect(wb.linkGates).toBe(false)
    expect(wb.gateSpace).toBe('raw')
    expect(wb.version).toBe(3)
  })
})

test.describe('files made with an older version', () => {
  async function olderFile(page: Page, mutate: (wb: Record<string, unknown> & { gates: { geometry: Record<string, unknown> }[]; samples: { source: unknown }[] }) => void): Promise<void> {
    await page.goto('/')
    for (let i = 0; i < 2; i++) {
      await page.getByRole('menuitem', { name: 'File', exact: true }).click()
      await page.getByRole('menuitem', { name: /Load demo sample/ }).click()
    }
    await page.getByLabel('Link gates in group').uncheck()
    await sample(page, /Demo sample 1/).click()
    await page.getByRole('button', { name: /Rectangle gate/ }).click()
    const box = await plotBox(page)
    const [ax, ay] = px(box, 0.18, 0)
    const [bx, by] = px(box, 0.45, 0.2)
    await page.mouse.move(ax, ay); await page.mouse.down(); await page.mouse.move(bx, by); await page.mouse.up()
    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const wb = JSON.parse(readFileSync(await dl.path(), 'utf8'))
    wb.version = 2
    delete wb.gateSpace
    delete wb.linkGates
    wb.gates[0].geometry = { type: 'rectangle', x0: 0.18, y0: 0, x1: 0.45, y1: 0.2 } // as an older version wrote it: screen positions
    mutate(wb)
    page.on('dialog', (d) => void d.accept())
    const chooser = page.waitForEvent('filechooser')
    await menu(page, 'File', /Open Workbench/)
    await (await chooser).setFiles({ name: 'older.fcwb', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wb)) })
  }

  test('LINK-15 the gates are converted to real values, with a notice, and the same events stay inside', async ({ page }) => {
    await olderFile(page, () => undefined)
    await expect(page.getByRole('status').filter({ hasText: /older version/ })).toBeVisible()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    expect((await rowNumbers(popRow(page, /Gate 1/))).pct).toBeGreaterThan(50) // the main cluster is still inside
    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const wb = JSON.parse(readFileSync(await dl.path(), 'utf8'))
    expect(wb.gateSpace).toBe('raw')
    expect(wb.gates[0].geometry.x1).toBeGreaterThan(1000) // instrument units now
    expect(wb.linkGates).toBe(false) // an older file keeps its samples independent until the person switches it on
  })

  test('LINK-16 an older file whose sample cannot be read keeps working in the older mode and says so', async ({ page }) => {
    await olderFile(page, (wb) => { wb.samples[0].source = { kind: 'file', path: 'C:\\gone\\missing.fcs' } })
    await expect(page.getByRole('alert')).toContainText(/older version/)
    await expect(page.getByRole('alert')).toContainText(/could not be loaded/)
    await sample(page, /Demo sample 1/).click() // the sample that could not be opened still has its gates
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })
})
