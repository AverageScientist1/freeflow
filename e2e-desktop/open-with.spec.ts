import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeDemoFcs } from '../src/core/synth'

// Opening files the way Windows does: as a program argument ("Open with", double-click), and by launching the
// program a second time while it is already open. Also exporting to the real disk.

const exe = process.env['FREEFLOW_EXE']
const appRoot = join(__dirname, '..')
const work = mkdtempSync(join(tmpdir(), 'freeflow-open-'))
const fcsPath = join(work, 'from windows.fcs')
const otherFcs = join(work, 'second launch.fcs')
const userData = (name: string): string => join(work, `profile-${name}`)

test.beforeAll(() => {
  writeFileSync(fcsPath, Buffer.from(makeDemoFcs(3, 5000)))
  writeFileSync(otherFcs, Buffer.from(makeDemoFcs(4, 4000)))
})

const launch = (profile: string, args: string[] = []): Promise<ElectronApplication> =>
  electron.launch(exe
    ? { executablePath: exe, args: [`--user-data-dir=${userData(profile)}`, ...(process.env['CI'] ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []), ...args] }
    : { args: ['.', `--user-data-dir=${userData(profile)}`, ...(process.env['CI'] ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : []), ...args], cwd: appRoot })

// closing asks about unsaved work; the tests answer Leave so the real dialog never blocks them
const quit = async (a: ElectronApplication): Promise<void> => {
  await a.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (() => 0) as typeof dialog.showMessageBoxSync }).catch(() => undefined)
  await a.close()
}

const samples = (page: Page) => page.getByRole('listbox', { name: 'Samples' }).getByRole('option')

test('OPEN-1 a file given at start-up is opened without any dialog', async () => {
  const app = await launch('a', [fcsPath])
  const page = await app.firstWindow()
  await expect(samples(page).filter({ hasText: 'from windows.fcs' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/5[.,  ]?000 events/).first()).toBeVisible()
  await quit(app)
})

test('OPEN-2 a Workbench given at start-up opens, reading its sample from the disk', async () => {
  // make a workbench that points at the file
  const first = await launch('b', [fcsPath])
  const p1 = await first.firstWindow()
  await expect(samples(p1)).toHaveCount(1, { timeout: 15_000 })
  const wbPath = join(work, 'start up.ffwb')
  await first.evaluate(({ dialog }, f) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as typeof dialog.showSaveDialog }, wbPath)
  await p1.getByRole('menuitem', { name: 'File', exact: true }).click()
  await p1.getByRole('menuitem', { name: /Save Workbench As/ }).click()
  await expect(p1.getByText(/Saved /)).toBeVisible()
  await quit(first)

  const app = await launch('c', [wbPath])
  const page = await app.firstWindow()
  await expect(samples(page).filter({ hasText: 'from windows.fcs' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.wb-name')).toContainText('start up')
  await quit(app)
})

test('OPEN-3 launching the program again hands the file to the window that is already open', async () => {
  const app = await launch('d')
  const page = await app.firstWindow()
  await expect(page.getByRole('heading', { name: 'No samples yet' })).toBeVisible()

  const bin = exe ?? (await import('electron')).default
  const args = exe ? [`--user-data-dir=${userData('d')}`, otherFcs] : ['.', `--user-data-dir=${userData('d')}`, otherFcs]
  const second = new Promise<number | null>((resolve) => { execFile(bin as string, args, { cwd: appRoot }, (err) => resolve(err ? 1 : 0)) })

  await expect(samples(page).filter({ hasText: 'second launch.fcs' })).toBeVisible({ timeout: 20_000 })
  await second // the second process exits by itself: there is only ever one window
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
  await quit(app)
})

test('OPEN-4 a file that is not FCS given at start-up gives a message, not a crash', async () => {
  const bad = join(work, 'not really.fcs')
  writeFileSync(bad, 'definitely not an FCS file '.repeat(20))
  const app = await launch('e', [bad])
  const page = await app.firstWindow()
  await expect(page.getByRole('alert')).toContainText('not really.fcs', { timeout: 15_000 })
  await quit(app)
})

test('OPEN-5 statistics and the plot image are written to the chosen files', async () => {
  const app = await launch('f', [fcsPath])
  const page = await app.firstWindow()
  await expect(samples(page)).toHaveCount(1, { timeout: 15_000 })
  const csv = join(work, 'results.csv')
  const png = join(work, 'plot.png')
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p.csv })) as typeof dialog.showSaveDialog; void p }, { csv, png })
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: /Export statistics/ }).click()
  await expect(page.getByText(/Saved /)).toBeVisible()
  const text = readFileSync(csv, 'utf8')
  expect(text.charCodeAt(0)).toBe(0xfeff)
  expect(text).toContain('Sample')
  expect(text).toContain('from windows.fcs')

  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog }, png)
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: /Export plot or chart image/ }).click()
  await expect.poll(() => existsSync(png)).toBe(true)
  const bytes = readFileSync(png)
  expect([...bytes.subarray(0, 4)]).toEqual([137, 80, 78, 71])
  expect(bytes.length).toBeGreaterThan(8000)
  await quit(app)
})

test('OPEN-6 saving into a folder that does not exist explains it instead of failing silently', async () => {
  const app = await launch('g', [fcsPath])
  const page = await app.firstWindow()
  await expect(samples(page)).toHaveCount(1, { timeout: 15_000 })
  const nowhere = join(work, 'no such folder', 'results.csv')
  await app.evaluate(({ dialog }, p) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog }, nowhere)
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: /Export statistics/ }).click()
  await expect(page.getByRole('alert')).toContainText(/folder does not exist/i)
  await quit(app)
})

