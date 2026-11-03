import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { test, expect, loadDemo, drawRect, popRow, rowNumbers, menu, MAIN_CLUSTER } from './helpers'
import { makeDemoFcs } from '../src/core/synth'

async function download(page: Page, item: RegExp): Promise<string> {
  const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', item)])
  return dl.path()
}

// Simulates dropping files on the window (the browser cannot drag from the disk in a test).
async function drop(page: Page, files: { name: string; bytes: Buffer }[]): Promise<void> {
  const payload = files.map((f) => ({ name: f.name, b64: f.bytes.toString('base64') }))
  const dt = await page.evaluateHandle((list) => {
    const d = new DataTransfer()
    for (const f of list) d.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name))
    return d
  }, payload)
  await page.dispatchEvent('.app', 'dragenter', { dataTransfer: dt })
  await page.dispatchEvent('.app', 'dragover', { dataTransfer: dt })
  await page.dispatchEvent('.app', 'drop', { dataTransfer: dt })
}

test.describe('export', () => {
  test('EXP-1 statistics CSV has a row per population with the same numbers as the tree', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const tree = await rowNumbers(popRow(page, /Gate 1/))
    const text = readFileSync(await download(page, /Export statistics/), 'utf8').replace(/^﻿/, '')
    const lines = text.trim().split(/\r\n/)
    expect(lines[0]).toMatch(/^Sample[,;]Group[,;]Population[,;]Path[,;]Events[,;]% of parent[,;]% of total$/)
    expect(lines).toHaveLength(3) // header, All events, Gate 1
    const cells = lines[2].split(/[,;]/)
    expect(cells[2]).toBe('Gate 1')
    expect(Number(cells[4])).toBe(tree.count)
    expect(parseFloat(cells[5].replace(',', '.'))).toBeCloseTo(tree.pct, 1)
  })

  test('EXP-2 the plot image is a real PNG at the size of the plot and not blank', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const bytes = readFileSync(await download(page, /Export plot or chart image/))
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    const width = bytes.readUInt32BE(16)
    const height = bytes.readUInt32BE(20)
    const box = (await page.locator('.plot-box').boundingBox())!
    expect(width).toBeGreaterThanOrEqual(Math.floor(box.width))
    expect(height).toBeGreaterThanOrEqual(Math.floor(box.height))
    expect(bytes.length).toBeGreaterThan(8000) // a blank image compresses to almost nothing
  })

  test('EXP-3 nothing to export says so', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('menuitem', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: /Export statistics/ }).click()
    await expect(page.getByRole('alert')).toContainText(/nothing to export/i)
  })

  test('EXP-4 the plot image needs the Graphs mode', async ({ page }) => {
    await loadDemo(page)
    await page.keyboard.press('Alt+3')
    await page.getByRole('menuitem', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: /Export plot or chart image/ }).click()
    await expect(page.getByRole('alert')).toContainText(/Graphs mode/)
  })

  test('EXP-5 a histogram can be exported too', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('combobox', { name: 'Plot type' }).selectOption('histogram')
    const bytes = readFileSync(await download(page, /Export plot or chart image/))
    expect([...bytes.subarray(0, 4)]).toEqual([137, 80, 78, 71])
  })
})

test.describe('drag and drop', () => {
  const fcs = (seed: number, n = 3000): Buffer => Buffer.from(makeDemoFcs(seed, n))
  const samples = (page: Page) => page.getByRole('listbox', { name: 'Samples' }).getByRole('option')

  test('DND-1 dropping FCS files adds them all', async ({ page }) => {
    await page.goto('/')
    await drop(page, [{ name: 'one.fcs', bytes: fcs(1) }, { name: 'two.fcs', bytes: fcs(2) }])
    await expect(samples(page)).toHaveCount(2)
    await expect(page.getByText('Added 2 file(s)')).toBeVisible()
  })

  test('DND-2 the drop message shows while dragging and goes away after', async ({ page }) => {
    await page.goto('/')
    const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['x'], 'x.fcs')); return d })
    await page.dispatchEvent('.app', 'dragenter', { dataTransfer: dt })
    await expect(page.getByText('Drop FCS files or a Freeflow Workbench to open')).toBeVisible()
    await page.dispatchEvent('.app', 'drop', { dataTransfer: dt })
    await expect(page.getByText('Drop FCS files or a Freeflow Workbench to open')).toHaveCount(0)
  })

  test('DND-3 dropping something else says what can be dropped, and adds nothing', async ({ page }) => {
    await page.goto('/')
    await drop(page, [{ name: 'notes.txt', bytes: Buffer.from('hello') }, { name: 'sheet.xlsx', bytes: Buffer.from('x') }])
    await expect(page.getByRole('alert')).toContainText('notes.txt')
    await expect(page.getByRole('alert')).toContainText(/only FCS files and Freeflow Workbenches/)
    await expect(samples(page)).toHaveCount(0)
  })

  test('DND-4 a mixed drop adds the good files and names the rest', async ({ page }) => {
    await page.goto('/')
    await drop(page, [{ name: 'good.fcs', bytes: fcs(1) }, { name: 'bad.fcs', bytes: Buffer.from('this is not an fcs file '.repeat(10)) }, { name: 'x.pdf', bytes: Buffer.from('%PDF') }])
    await expect(samples(page)).toHaveCount(1)
    await expect(page.getByRole('alert')).toContainText('bad.fcs')
    await expect(page.getByRole('alert')).toContainText('x.pdf')
  })

  test('DND-5 dropping a Workbench opens it (and asks first when there is unsaved work)', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, ...MAIN_CLUSTER)
    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const saved = readFileSync(await dl.path())
    await page.getByRole('menuitem', { name: 'File', exact: true }).click()
    await page.getByRole('menuitem', { name: /Load demo sample/ }).click() // unsaved again
    let asked = ''
    page.once('dialog', (d) => { asked = d.message(); void d.accept() })
    await drop(page, [{ name: 'analysis.ffwb', bytes: saved }])
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    expect(asked).toMatch(/unsaved changes/)
    await expect(samples(page)).toHaveCount(1) // the second demo sample was discarded with the old work
  })

  for (const scheme of ['light', 'dark'] as const) {
    test(`DND-7 accessibility scan with a problem notice showing (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme })
      await page.goto('/')
      await drop(page, [{ name: 'good.fcs', bytes: fcs(1) }, { name: 'notes.txt', bytes: Buffer.from('hi') }])
      await expect(page.getByRole('alert')).toBeVisible()
      const r = await new AxeBuilder({ page }).analyze()
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      expect(bad.map((v) => `${v.id}: ${v.nodes.length} nodes (${v.help})`)).toEqual([])
    })
  }

  test('DND-6 a plain click on the window does not show the drop message', async ({ page }) => {
    await page.goto('/')
    await page.locator('.app').click()
    await expect(page.getByText('Drop FCS files or a Freeflow Workbench to open')).toHaveCount(0)
  })
})
