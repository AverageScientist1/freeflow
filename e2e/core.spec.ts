import AxeBuilder from '@axe-core/playwright'
import { readFileSync } from 'node:fs'
import { test, expect, loadDemo, drawRect, drawPolygon, plotBox, px, popRow, rowNumbers, menu, addFile, fcsBuffer, MAIN_CLUSTER } from './helpers'

const FL = { x: 'FL1-A :: Marker A FITC', y: 'FL2-A :: Marker B PE' }

async function gateMainCluster(page: import('@playwright/test').Page): Promise<void> {
  await drawRect(page, ...MAIN_CLUSTER)
  await expect(popRow(page, /Gate 1/)).toBeVisible()
}

async function coloredPixels(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('.gl-canvas') as HTMLCanvasElement
    const t = document.createElement('canvas'); t.width = c.width; t.height = c.height
    const ctx = t.getContext('2d')!; ctx.drawImage(c, 0, 0)
    const d = ctx.getImageData(0, 0, t.width, t.height).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) n++
    return n
  })
}

test.describe('F01 analyse a sample', () => {
  test('F01-H1 load demo and see a plot', async ({ page }) => {
    await loadDemo(page)
    await expect(page.getByRole('option', { name: /Demo sample 1.*20,000/ })).toBeVisible()
    await expect(page.getByText('20,000 events').first()).toBeVisible()
    expect(await coloredPixels(page)).toBeGreaterThan(2000)
  })

  test('F01-H2 rectangle gate gives a population near 60%', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    const { count, pct } = await rowNumbers(popRow(page, /Gate 1/))
    expect(count).toBeGreaterThan(10000)
    expect(pct).toBeGreaterThan(55)
    expect(pct).toBeLessThan(65)
  })

  test('F01-E1 tiny rectangle is ignored', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, 0.3, 0.3, 0.305, 0.305)
    await expect(page.getByRole('treeitem')).toHaveCount(1)
  })

  test('F01-E2 polygon with two points is ignored', async ({ page }) => {
    await loadDemo(page)
    await drawPolygon(page, [[0.2, 0.2], [0.4, 0.4]])
    await expect(page.getByRole('treeitem')).toHaveCount(1)
  })

  test('F01-E3 Escape cancels a polygon', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('button', { name: /Polygon gate/ }).click()
    const box = await plotBox(page)
    for (const p of [[0.2, 0.2], [0.5, 0.2], [0.5, 0.5]] as [number, number][]) await page.mouse.click(...px(box, p[0], p[1]))
    await page.keyboard.press('Escape')
    await page.mouse.dblclick(...px(box, 0.2, 0.5))
    await expect(page.getByRole('treeitem')).toHaveCount(1)
  })

  test('F01-E4 a file that is not FCS shows an error and adds nothing', async ({ page }) => {
    await page.goto('/')
    await addFile(page, 'broken.fcs', Buffer.from('this is not an fcs file at all, just text '.repeat(5)))
    await expect(page.getByRole('alert').filter({ hasText: /broken\.fcs/ })).toBeVisible()
    await expect(page.getByText('No samples added.')).toBeVisible()
  })

  test('F01-E5 a file with zero events loads without crashing', async ({ page }) => {
    await page.goto('/')
    await addFile(page, 'empty.fcs', fcsBuffer(0))
    await expect(page.getByRole('option', { name: /empty\.fcs/ })).toBeVisible()
    await expect(page.getByText('0 events').first()).toBeVisible()
    await drawRect(page, 0.2, 0.2, 0.6, 0.6)
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })

  test('F01-E6 a very long file name is truncated, layout intact', async ({ page }) => {
    await page.goto('/')
    await addFile(page, `${'long-name-'.repeat(12)}.fcs`, fcsBuffer(50))
    const row = page.getByRole('option').first()
    await expect(row).toBeVisible()
    const rowBox = await row.boundingBox()
    const panel = await page.locator('.left-panel').boundingBox()
    expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(panel!.x + panel!.width + 1)
  })

  test('F01-E7 accents and emoji in a name are kept', async ({ page }) => {
    await page.goto('/')
    await addFile(page, 'muéstra 😀 ñ.fcs', fcsBuffer(50))
    await expect(page.getByRole('option', { name: /muéstra 😀 ñ\.fcs/ })).toBeVisible()
  })

  test('F01-E8 the same file twice gives two samples', async ({ page }) => {
    await page.goto('/')
    await addFile(page, 'same.fcs', fcsBuffer(50))
    await addFile(page, 'same.fcs', fcsBuffer(50))
    await expect(page.getByRole('option', { name: /same\.fcs/ })).toHaveCount(2)
  })

  test('F01-N1 a sample without the plotted parameter shows a message', async ({ page }) => {
    await loadDemo(page)
    await addFile(page, 'other.fcs', fcsBuffer(50, [{ name: 'CD3', range: 262144 }, { name: 'CD4', range: 262144 }]))
    await page.getByRole('option', { name: /other\.fcs/ }).click()
    await expect(page.getByRole('alert').filter({ hasText: /no parameter named/ })).toBeVisible()
    await page.getByRole('option', { name: /Demo sample 1/ }).click()
    await expect(page.getByRole('alert').filter({ hasText: /no parameter named/ })).toHaveCount(0)
  })

  test('F01-K1 every control can be reached with the keyboard', async ({ page }) => {
    await loadDemo(page)
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab')
      const label = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null
        return e ? (e.getAttribute('aria-label') ?? e.textContent ?? e.tagName).trim().slice(0, 40) : ''
      })
      seen.add(label)
    }
    for (const must of ['Select gates', 'Rectangle gate (drag)', 'Scale for the X axis']) expect([...seen].some((s) => s.startsWith(must)), `reached "${must}"`).toBe(true)
  })

  test('F01-A1 accessibility scan of the main screen', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    const r = await new AxeBuilder({ page }).analyze()
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(bad.map((v) => `${v.id}: ${v.nodes.length} nodes (${v.help})`)).toEqual([])
  })
})

test.describe('F02 gating hierarchy', () => {
  async function nestedGates(page: import('@playwright/test').Page): Promise<void> {
    await loadDemo(page)
    await gateMainCluster(page)
    await popRow(page, /Gate 1/).click()
    await page.getByRole('combobox', { name: 'X', exact: true }).selectOption({ label: FL.x })
    await page.getByRole('combobox', { name: 'Y', exact: true }).selectOption({ label: FL.y })
    await drawRect(page, 0.55, 0.55, 1, 1)
    await expect(popRow(page, /Gate 2/)).toBeVisible()
  }

  test('F02-H1 a gate inside a gate is nested and smaller', async ({ page }) => {
    await nestedGates(page)
    const g1 = await rowNumbers(popRow(page, /Gate 1/))
    const g2 = await rowNumbers(popRow(page, /Gate 2/))
    expect(g2.count).toBeGreaterThan(0)
    expect(g2.count).toBeLessThan(g1.count)
    expect(await popRow(page, /Gate 2/).getAttribute('aria-level')).toBe('3')
  })

  test('F02-H2 rename a population', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    await popRow(page, /Gate 1/).dblclick()
    await page.getByLabel('Population name').fill('Lymphocytes')
    await page.keyboard.press('Enter')
    await expect(popRow(page, /Lymphocytes/)).toBeVisible()
  })

  test('F02-E1 renaming to empty keeps the old name', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    await popRow(page, /Gate 1/).dblclick()
    await page.getByLabel('Population name').fill('   ')
    await page.keyboard.press('Enter')
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })

  test('F02-E2 deleting a parent deletes its children', async ({ page }) => {
    await nestedGates(page)
    await popRow(page, /Gate 1/).click()
    await page.getByRole('button', { name: /Delete population/ }).click()
    await expect(page.getByRole('treeitem')).toHaveCount(1)
  })

  test('F02-E3 selecting a gate on the plot and pressing Delete removes it', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    await page.getByRole('button', { name: 'Select gates' }).click()
    const box = await plotBox(page)
    await page.mouse.click(...px(box, 0.3, 0.1))
    await page.keyboard.press('Delete')
    await expect(page.getByRole('treeitem')).toHaveCount(1)
  })

  test('F02-E4 names stay unique after deleting an earlier gate', async ({ page }) => {
    await loadDemo(page)
    await drawRect(page, 0.0, 0.0, 0.1, 0.1)
    await drawRect(page, 0.18, 0.0, 0.45, 0.2)
    await expect(popRow(page, /Gate 2/)).toBeVisible()
    await popRow(page, /Gate 1/).click()
    await page.getByRole('button', { name: /Delete population/ }).click()
    await drawRect(page, 0.5, 0.2, 0.7, 0.5)
    const names = await page.getByRole('treeitem').locator('.ellipsis').allInnerTexts()
    expect(new Set(names).size, `names: ${names.join(', ')}`).toBe(names.length)
  })

  test('F02-E5 the root cannot be renamed or deleted', async ({ page }) => {
    await loadDemo(page)
    await popRow(page, /All events/).dblclick()
    await expect(page.getByLabel('Population name')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Delete population/ })).toBeDisabled()
  })

  test('F02-E6 a gate is not drawn when the axes change but stays in the tree', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    await page.getByRole('combobox', { name: 'X', exact: true }).selectOption({ label: FL.x })
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })
})

test.describe('F05 rescale an axis', () => {
  async function openScale(page: import('@playwright/test').Page, axis: 'X' | 'Y' = 'X'): Promise<void> {
    await loadDemo(page)
    if (axis === 'X') await page.getByRole('combobox', { name: 'X', exact: true }).selectOption({ label: FL.x })
    await page.getByRole('button', { name: `Scale for the ${axis} axis` }).click()
    await expect(page.getByText(/Axis scale:/)).toBeVisible()
  }

  test('F05-H1 changing biexponential parameters changes the plot', async ({ page }) => {
    await openScale(page)
    const before = await page.locator('.gl-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL())
    await page.getByLabel('Extra negative decades value').fill('1')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    const after = await page.locator('.gl-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL())
    expect(after).not.toBe(before)
  })

  test('F05-H2 Reset returns to the default scale', async ({ page }) => {
    await openScale(page)
    const first = await page.locator('.gl-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL())
    await page.getByLabel('Extra negative decades value').fill('1')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await page.getByRole('button', { name: 'Reset' }).click()
    expect(await page.locator('.gl-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL())).toBe(first)
  })

  test('F05-E1 log scale with minimum 0 is refused', async ({ page }) => {
    await openScale(page)
    await page.getByLabel('Log').check()
    await page.getByLabel('Minimum').fill('0')
    await expect(page.getByRole('alert')).toContainText(/above zero/)
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
  })

  test('F05-E2 width above half the positive decades is refused', async ({ page }) => {
    await openScale(page)
    await page.getByLabel('Width (decades) value').fill('5')
    await expect(page.getByRole('alert')).toContainText(/Width must be between/)
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
  })

  test('F05-E3 an empty field is refused', async ({ page }) => {
    await openScale(page)
    await page.getByLabel('Maximum').fill('')
    await expect(page.getByRole('alert')).toContainText(/needs a number/)
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled()
  })

  test('F05-E4 a scale change keeps the gate where it was drawn on screen', async ({ page }) => {
    await loadDemo(page)
    await page.getByRole('combobox', { name: 'X', exact: true }).selectOption({ label: FL.x })
    await page.getByRole('combobox', { name: 'Y', exact: true }).selectOption({ label: FL.y })
    await drawRect(page, 0.6, 0.6, 0.95, 0.95)
    const geometry = async (): Promise<unknown> => {
      const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
      return JSON.parse(readFileSync(await dl.path(), 'utf8')).gates[0].geometry
    }
    const before = await geometry()
    await page.getByRole('button', { name: 'Scale for the X axis' }).click()
    await page.getByLabel('Extra negative decades value').fill('1')
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    expect((await rowNumbers(popRow(page, /Gate 1/))).count).toBeGreaterThan(0)
    expect(await geometry()).toEqual(before) // the gate keeps its place on screen (its events may differ, by design)
  })
})

test.describe('Save and reopen a Workbench', () => {
  async function saveAs(page: import('@playwright/test').Page): Promise<string> {
    const [dl] = await Promise.all([page.waitForEvent('download'), menu(page, 'File', /Save Workbench As/)])
    const path = await dl.path()
    return readFileSync(path, 'utf8')
  }
  async function openJson(page: import('@playwright/test').Page, content: string): Promise<void> {
    const chooser = page.waitForEvent('filechooser')
    await menu(page, 'File', /Open Workbench/)
    await (await chooser).setFiles({ name: 'x.fcwb', mimeType: 'application/json', buffer: Buffer.from(content) })
  }

  test('WB-H1 gates survive save and reopen', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    await popRow(page, /Gate 1/).dblclick()
    await page.getByLabel('Population name').fill('Lymphs')
    await page.keyboard.press('Enter')
    const before = await rowNumbers(popRow(page, /Lymphs/))
    const json = await saveAs(page)
    page.once('dialog', (d) => void d.accept())
    await menu(page, 'File', /New Workbench/)
    await expect(page.getByRole('treeitem')).toHaveCount(1)
    await openJson(page, json)
    await expect(popRow(page, /Lymphs/)).toBeVisible()
    expect(await rowNumbers(popRow(page, /Lymphs/))).toEqual(before)
  })

  test('WB-E1 a JSON file that is not a Workbench is refused, work kept', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    page.on('dialog', (d) => void d.accept())
    await openJson(page, '{"hello": 1}')
    await expect(page.getByRole('alert').filter({ hasText: /Could not open Workbench/ })).toBeVisible()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })

  test('WB-E2 invalid JSON is refused, work kept', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    page.on('dialog', (d) => void d.accept())
    await openJson(page, 'not json')
    await expect(page.getByRole('alert').filter({ hasText: /Could not open Workbench/ })).toBeVisible()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
  })

  test('WB-E3 New with unsaved changes asks first', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    let asked = false
    page.once('dialog', (d) => { asked = true; void d.dismiss() })
    await menu(page, 'File', /New Workbench/)
    expect(asked, 'a confirmation dialog appeared').toBe(true)
    await expect(popRow(page, /Gate 1/)).toBeVisible() // dismissing keeps the work
  })

  test('WB-E4 Open with unsaved changes asks first', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    let asked = false
    page.once('dialog', (d) => { asked = true; void d.dismiss() })
    const chooser = page.waitForEvent('filechooser', { timeout: 2000 }).catch(() => null)
    await menu(page, 'File', /Open Workbench/)
    await chooser
    expect(asked, 'a confirmation dialog appeared').toBe(true)
  })

  test('WB-E5 a Workbench whose sample file is gone keeps its gates', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    const wb = JSON.parse(await saveAs(page))
    wb.samples = [{ id: 's1', name: 'gone.fcs', source: { kind: 'file', path: 'C:\\nowhere\\gone.fcs' } }]
    for (const p of wb.populations) if (p.id !== 'root') p.sampleId = 's1' // the gating belongs to the sample that is now gone
    wb.compensation.assignments = {}
    wb.groupOf = {}
    page.on('dialog', (d) => void d.accept())
    await openJson(page, JSON.stringify(wb))
    await expect(page.getByRole('alert').filter({ hasText: /could not be loaded/ })).toBeVisible()
    await expect(popRow(page, /Gate 1/)).toBeVisible()
    await expect(page.getByText(/file could not be loaded/i)).toBeVisible()
  })

  test('WB-E6 a Workbench with a damaged gate does not crash the app', async ({ page }) => {
    await loadDemo(page)
    await gateMainCluster(page)
    const wb = JSON.parse(await saveAs(page))
    delete wb.gates[0].geometry
    page.on('dialog', (d) => void d.accept())
    await openJson(page, JSON.stringify(wb))
    // either an error message, or the app keeps working; the page must not go blank
    await expect(page.getByRole('menuitem', { name: 'File', exact: true })).toBeVisible()
    await expect(page.locator('.app')).toBeVisible()
  })
})


