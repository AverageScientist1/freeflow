import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, plotBox, px, popRow, menu, addFile, MAIN_CLUSTER } from './helpers'
import { makeDemoFcs } from '../src/core/synth'

const X = (page: Page) => page.getByRole('combobox', { name: 'X', exact: true })
const Y = (page: Page) => page.getByRole('combobox', { name: 'Y', exact: true })
const quarters = (page: Page) => page.getByRole('treeitem', { name: /FL1-A. FL2-A./ })
const named = (page: Page, x: '+' | '−', y: '+' | '−') => page.getByRole('treeitem', { name: `FL1-A${x} FL2-A${y}` })

async function numbersOf(row: ReturnType<Page['getByRole']>): Promise<{ count: number; parent: number; total: number }> {
  const spans = row.locator('.num')
  const read = async (i: number): Promise<number> => parseFloat((await spans.nth(i).innerText()).replace(/\s/g, '').replace(',', '.'))
  return { count: Number((await spans.nth(0).innerText()).replace(/[^\d]/g, '')), parent: await read(1), total: await read(2) }
}

async function quadrantPlot(page: Page, at: [number, number] = [0.5, 0.5]): Promise<void> {
  await X(page).selectOption({ label: 'FL1-A :: Marker A FITC' })
  await Y(page).selectOption({ label: 'FL2-A :: Marker B PE' })
  await page.getByRole('button', { name: /Quadrant gate/ }).click()
  await page.mouse.click(...px(await plotBox(page), ...at))
}

async function drag(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  const box = await plotBox(page)
  const [ax, ay] = px(box, ...from)
  const [bx, by] = px(box, ...to)
  await page.mouse.move(ax, ay)
  await page.mouse.down()
  await page.mouse.move((ax + bx) / 2, (ay + by) / 2)
  await page.mouse.move(bx, by)
  await page.mouse.up()
}

test.describe('quadrant gates', () => {
  test('QUAD-1 one click makes four populations that add up to the parent', async ({ page }) => {
    await loadDemo(page)
    await quadrantPlot(page)
    await expect(quarters(page)).toHaveCount(4)
    let sum = 0
    for (const [x, y] of [['−', '+'], ['+', '+'], ['+', '−'], ['−', '−']] as const) sum += (await numbersOf(named(page, x, y))).count
    expect(sum).toBe(20000)
    const ne = await numbersOf(named(page, '+', '+'))
    expect(ne.parent).toBeGreaterThan(14) // 35% of events are FL1+ and 50% FL2+: about 17.5%
    expect(ne.parent).toBeLessThan(21)
    const se = await numbersOf(named(page, '+', '−'))
    expect(se.parent).toBeGreaterThan(14)
    expect(se.parent).toBeLessThan(21)
  })

  test('QUAD-2 dragging the centre moves the crosshair and all four counts follow; undo is one step', async ({ page }) => {
    await loadDemo(page)
    await quadrantPlot(page)
    const before = await numbersOf(named(page, '+', '+'))
    await drag(page, [0.5, 0.5], [0.95, 0.5])
    await expect.poll(async () => (await numbersOf(named(page, '+', '+'))).count).toBeLessThan(before.count / 2)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await numbersOf(named(page, '+', '+'))).count).toBe(before.count)
  })

  test('QUAD-3 the end of a line moves only that line', async ({ page }) => {
    await loadDemo(page)
    await quadrantPlot(page)
    const read = async (): Promise<{ geometry: { cx: number; cy: number } }[]> => {
      const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
      return JSON.parse(readFileSync(await dl.path(), 'utf8')).gates
    }
    const before = (await read())[0].geometry
    await drag(page, [0.5, 0.97], [0.9, 0.97]) // the top end of the vertical line
    await expect(quarters(page)).toHaveCount(4)
    const gates = await read()
    expect(gates).toHaveLength(4)
    for (const g of gates) {
      expect(g.geometry.cx).toBeGreaterThan(before.cx * 1.5) // the vertical line moved to the right (in real values)
      expect(g.geometry.cy).toBeCloseTo(before.cy, 0) // the horizontal line stayed
    }
  })

  test('QUAD-4 deleting one quarter deletes the whole gate', async ({ page }) => {
    await loadDemo(page)
    await quadrantPlot(page)
    await named(page, '+', '+').click()
    await page.getByRole('button', { name: /Delete population/ }).click()
    await expect(page.getByRole('treeitem')).toHaveCount(1)
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(quarters(page)).toHaveCount(4)
  })

  test('QUAD-5 the quarters can be gated further and keep their place in the tree', async ({ page }) => {
    await loadDemo(page)
    await quadrantPlot(page)
    await named(page, '+', '+').click()
    await page.getByRole('combobox', { name: 'X', exact: true }).selectOption({ label: 'FSC-A' })
    await page.getByRole('combobox', { name: 'Y', exact: true }).selectOption({ label: 'SSC-A' })
    await drawRect(page, 0, 0, 1, 1)
    await expect(page.getByRole('treeitem', { name: /Gate 1/ })).toBeVisible()
    expect(await page.getByRole('treeitem', { name: /Gate 1/ }).getAttribute('aria-level')).toBe('3')
  })

  test('QUAD-6 the % total column is the share of all events, the % parent column the share of the parent', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const gate = await numbersOf(popRow(page, /Gate 1/))
    expect(gate.total).toBeCloseTo((gate.count / 20000) * 100, 1)
    expect(gate.total).toBeCloseTo(gate.parent, 1) // directly under the root, so both are the same
    await popRow(page, /Gate 1/).click()
    await X(page).selectOption({ label: 'FL1-A :: Marker A FITC' })
    await Y(page).selectOption({ label: 'FL2-A :: Marker B PE' })
    await page.getByRole('button', { name: /Quadrant gate/ }).click()
    await page.mouse.click(...px(await plotBox(page), 0.5, 0.5))
    const ne = await numbersOf(named(page, '+', '+'))
    expect(ne.total).toBeLessThan(ne.parent) // a share of Gate 1 is a smaller share of everything
    expect(ne.total).toBeCloseTo((ne.count / 20000) * 100, 1)
  })

  test('QUAD-7 apply to group copies all four quarters; the copies have their own crosshair', async ({ page }) => {
    await page.goto('/')
    await addFile(page, 'a.fcs', Buffer.from(makeDemoFcs(1, 6000)))
    await addFile(page, 'b.fcs', Buffer.from(makeDemoFcs(2, 6000)))
    await page.getByLabel('Link gates in group').uncheck() // this test is about copies that are independent
    await page.getByRole('listbox', { name: 'Samples' }).getByRole('option', { name: /a\.fcs/ }).click()
    await quadrantPlot(page)
    const aBefore = await numbersOf(named(page, '+', '+'))
    await page.getByRole('button', { name: 'Apply to group', exact: true }).click()
    await page.getByRole('listbox', { name: 'Samples' }).getByRole('option', { name: /b\.fcs/ }).click()
    await expect(quarters(page)).toHaveCount(4)
    // moving b's crosshair leaves a's alone
    await named(page, '+', '+').click()
    await drag(page, [0.5, 0.5], [0.95, 0.5])
    await page.getByRole('listbox', { name: 'Samples' }).getByRole('option', { name: /a\.fcs/ }).click()
    expect((await numbersOf(named(page, '+', '+'))).count).toBe(aBefore.count)
  })

  test('QUAD-8 quadrants survive save and reopen', async ({ page }) => {
    await loadDemo(page)
    await quadrantPlot(page, [0.45, 0.55])
    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const wb = JSON.parse(readFileSync(await dl.path(), 'utf8'))
    expect(wb.gates.map((g: { geometry: { type: string } }) => g.geometry.type)).toEqual(['quadrant', 'quadrant', 'quadrant', 'quadrant'])
    expect(new Set(wb.gates.map((g: { geometry: { link: string } }) => g.geometry.link)).size).toBe(1)
    page.on('dialog', (d) => void d.accept())
    await menu(page, 'File', /New Workbench/)
    const chooser = page.waitForEvent('filechooser')
    await menu(page, 'File', /Open Workbench/)
    await (await chooser).setFiles({ name: 'q.fcwb', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wb)) })
    await expect(quarters(page)).toHaveCount(4)
  })

  test('QUAD-9 a damaged quadrant in a file is refused, not drawn', async ({ page }) => {
    await loadDemo(page)
    await quadrantPlot(page)
    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const wb = JSON.parse(readFileSync(await dl.path(), 'utf8'))
    delete wb.gates[0].geometry.link
    page.on('dialog', (d) => void d.accept())
    const chooser = page.waitForEvent('filechooser')
    await menu(page, 'File', /Open Workbench/)
    await (await chooser).setFiles({ name: 'bad.fcwb', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(wb)) })
    await expect(page.getByRole('alert').filter({ hasText: /damaged/ })).toBeVisible()
  })
})
