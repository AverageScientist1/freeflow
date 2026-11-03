import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeDemoFcs } from '../src/core/synth'

// These tests drive the built desktop app. The native file dialogs cannot be clicked from a test, so the main
// process's dialog functions are replaced with ones that answer with a chosen path; everything else (the preload
// bridge, the IPC channels, reading and writing real files) is the real thing.

let app: ElectronApplication
let page: Page
const work = mkdtempSync(join(tmpdir(), 'freeflow-'))
const fcsPath = join(work, 'sample one.fcs')
const wbPath = join(work, 'my analysis.ffwb')

test.beforeAll(async () => {
  writeFileSync(fcsPath, Buffer.from(makeDemoFcs(5, 8000)))
  // FREEFLOW_EXE points at the packaged program (release\win-unpacked\Freeflow.exe); without it the build in out\ is used
  const exe = process.env['FREEFLOW_EXE']
  // its own profile folder: the program allows one window per profile, so a copy that is open on this computer must not stop the tests
  const profile = `--user-data-dir=${join(work, 'profile')}`
  app = await electron.launch(exe ? { executablePath: exe, args: [profile] } : { args: ['.', profile], cwd: join(__dirname, '..') })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // the app asks before discarding unsaved work; the tests always agree
  page.on('dialog', (d) => { d.accept().catch(() => undefined) })
})

test.afterAll(async () => { await app.close() })

const answerDialogs = (opts: { open?: string[]; save?: string }) =>
  app.evaluate(({ dialog }, o) => {
    dialog.showOpenDialog = (async () => ({ canceled: !o.open, filePaths: o.open ?? [] })) as typeof dialog.showOpenDialog
    dialog.showSaveDialog = (async () => ({ canceled: !o.save, filePath: o.save })) as typeof dialog.showSaveDialog
  }, opts)

const menuItem = async (title: string, item: RegExp): Promise<void> => {
  await page.getByRole('menuitem', { name: title, exact: true }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

test('DESK-1 the window opens with the preload bridge', async () => {
  expect(await page.title()).toBe('Freeflow')
  expect(await page.evaluate(() => typeof (window as unknown as { api?: { openFcs: unknown } }).api?.openFcs)).toBe('function')
  expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined') // no Node in the page
  await expect(page.getByRole('heading', { name: 'No samples yet' })).toBeVisible()
})

test('DESK-2 adding an FCS file reads it from disk through the main process', async () => {
  await answerDialogs({ open: [fcsPath] })
  await menuItem('File', /Add FCS files/)
  await expect(page.getByRole('listbox', { name: 'Samples' }).getByRole('option', { name: /sample one\.fcs/ })).toBeVisible()
  await expect(page.getByText(/8[.,\u00a0 ]?000 events/).first()).toBeVisible()
})

test('DESK-3 cancelling the open dialog changes nothing', async () => {
  await answerDialogs({})
  await menuItem('File', /Add FCS files/)
  await expect(page.getByRole('listbox', { name: 'Samples' }).getByRole('option')).toHaveCount(1)
})

test('DESK-4 a gate, then Save As writes a real file with the sample path in it', async () => {
  await page.getByRole('button', { name: /Rectangle gate/ }).click()
  const box = (await page.locator('.plot-box').boundingBox())!
  const x = (f: number): number => box.x + 64 + f * (box.width - 80)
  const y = (f: number): number => box.y + 12 + (1 - f) * (box.height - 56)
  await page.mouse.move(x(0.18), y(0)); await page.mouse.down(); await page.mouse.move(x(0.45), y(0.2)); await page.mouse.up()
  await expect(page.getByRole('treeitem', { name: /Gate 1/ })).toBeVisible()
  await answerDialogs({ save: wbPath })
  await menuItem('File', /Save Workbench As/)
  await expect(page.getByText(new RegExp('Saved '))).toBeVisible()
  expect(existsSync(wbPath)).toBe(true)
  const wb = JSON.parse(readFileSync(wbPath, 'utf8'))
  expect(wb.samples[0].source).toEqual({ kind: 'file', path: fcsPath })
  expect(wb.gates).toHaveLength(1)
  await expect(page.locator('.wb-name')).toContainText('my analysis') // named after the file
  await expect(page.locator('.wb-name')).not.toContainText('•') // nothing unsaved
})

test('DESK-5 Save writes to the same file without asking again', async () => {
  await answerDialogs({}) // a dialog now would be cancelled, so a second prompt would show up as "no save"
  await page.getByRole('treeitem', { name: /Gate 1/ }).dblclick()
  await page.getByLabel('Population name').fill('Lymphs')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+s')
  await expect(page.locator('.wb-name')).not.toContainText('•')
  expect(JSON.parse(readFileSync(wbPath, 'utf8')).populations.some((p: { name: string }) => p.name === 'Lymphs')).toBe(true)
})

test('DESK-6 New, then Open reloads the sample from its path on disk, with its gate', async () => {
  await menuItem('File', /New Workbench/)
  await expect(page.getByRole('heading', { name: 'No samples yet' })).toBeVisible()
  await answerDialogs({ open: [wbPath] })
  await menuItem('File', /Open Workbench/)
  await expect(page.getByRole('listbox', { name: 'Samples' }).getByRole('option', { name: /sample one\.fcs/ })).toBeVisible()
  await expect(page.getByRole('treeitem', { name: /Lymphs/ })).toBeVisible()
  await expect(page.getByText(/8[.,\u00a0 ]?000 events/).first()).toBeVisible()
})

test('DESK-7 a Workbench whose FCS file was moved still opens, marks the sample, and keeps the gates', async () => {
  const wb = JSON.parse(readFileSync(wbPath, 'utf8'))
  wb.samples[0].source.path = join(work, 'moved-away.fcs')
  const broken = join(work, 'broken link.ffwb')
  writeFileSync(broken, JSON.stringify(wb))
  await answerDialogs({ open: [broken] })
  await menuItem('File', /Open Workbench/)
  await expect(page.getByRole('alert').filter({ hasText: /could not be loaded/ })).toBeVisible()
  await expect(page.getByText(/file could not be loaded/i)).toBeVisible()
  await expect(page.getByRole('treeitem', { name: /Lymphs/ })).toBeVisible()
})

test('DESK-8 an unreadable FCS file gives a message, not a crash', async () => {
  const bad = join(work, 'bad.fcs')
  writeFileSync(bad, 'not an fcs file '.repeat(20))
  await answerDialogs({ open: [bad] })
  await menuItem('File', /Add FCS files/)
  await expect(page.getByRole('alert').filter({ hasText: /bad\.fcs/ })).toBeVisible()
})

test('DESK-8b one file that cannot be read does not stop the others, and the problem stays on screen', async () => {
  const ghost = join(work, 'does not exist.fcs')
  await answerDialogs({ open: [fcsPath, ghost] })
  await menuItem('File', /Add FCS files/)
  const banner = page.getByRole('alert')
  await expect(banner).toContainText('Added 1 of 2 file(s)')
  await expect(banner).toContainText('does not exist.fcs')
  await expect(banner).toContainText(/was not found/)
  await page.waitForTimeout(1500)
  await expect(banner).toBeVisible() // it does not fade away on its own
  await banner.getByRole('button', { name: 'Dismiss' }).click()
  await expect(banner).toHaveCount(0)
})

test('DESK-10 tables, charts and the report preview work under the security policy', async () => {
  await menuItem('File', /New Workbench/) // the earlier tests leave a Workbench with a missing file
  await menuItem('File', /Load demo sample/)
  const rail = page.getByRole('navigation', { name: 'Modes' })
  await rail.getByRole('button', { name: 'Tables' }).click()
  await page.getByRole('combobox', { name: 'Statistic' }).selectOption({ label: 'Count' })
  await page.getByRole('button', { name: 'Add column' }).click()
  await rail.getByRole('button', { name: 'Reports' }).click()
  await page.getByRole('button', { name: 'Add heading' }).click()
  await page.getByRole('button', { name: 'Add chart' }).click()
  const frame = page.frameLocator('iframe[title="Report preview"]')
  await expect(frame.getByRole('heading', { name: 'Heading' })).toBeVisible()
  await expect(frame.getByRole('img', { name: /Bar chart/ })).toBeVisible()
  await rail.getByRole('button', { name: 'Charts' }).click()
  await expect(page.getByRole('img', { name: /Bar chart of All events/ })).toBeVisible()
})

test('DESK-11 the Cluster Explorer runs its worker under the security policy', async () => {
  const rail = page.getByRole('navigation', { name: 'Modes' })
  await rail.getByRole('button', { name: 'Cluster Explorer' }).click()
  await page.getByRole('spinbutton', { name: 'Events per sample' }).fill('300')
  await page.getByRole('button', { name: 'Run' }).click()
  await expect(page.getByRole('img', { name: /UMAP map of 300 events/ })).toBeVisible({ timeout: 60000 })
  await expect(page.getByRole('table', { name: 'Clusters and their markers' })).toBeVisible()
})
test('DESK-9 closing with unsaved changes asks first; Stay keeps the window, Leave closes it', async () => {
  await menuItem('File', /New Workbench/)
  await answerDialogs({ open: [fcsPath] })
  await menuItem('File', /Add FCS files/)
  await expect(page.locator('.wb-name')).toContainText('•') // adding a sample is an unsaved change

  await app.evaluate(({ dialog, BrowserWindow }) => {
    ;(globalThis as { __asked?: number }).__asked = 0
    dialog.showMessageBoxSync = (() => { (globalThis as { __asked?: number }).__asked!++; return 1 }) as typeof dialog.showMessageBoxSync // Stay
    BrowserWindow.getAllWindows()[0].close()
  })
  await page.waitForTimeout(500)
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  expect(await app.evaluate(() => (globalThis as { __asked?: number }).__asked)).toBeGreaterThan(0)

  const closed = new Promise<void>((resolve) => app.once('close', () => resolve()))
  await app.evaluate(({ dialog, BrowserWindow }) => {
    dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync // Leave
    BrowserWindow.getAllWindows()[0].close()
  })
  await closed
})
