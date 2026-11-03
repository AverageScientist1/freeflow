import { test as base, expect, type Page, type Locator } from '@playwright/test'
import { writeFcs, mulberry32 } from '../src/core/synth'

// Every test fails on console errors and on 5xx responses.
export const test = base.extend<{ problems: string[] }>({
  problems: [
    async ({ page }, use) => {
      const problems: string[] = []
      page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
      page.on('response', (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`) })
      await use(problems)
      expect(problems, 'console errors or 5xx responses').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

export async function loadDemo(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: 'Load demo sample' }).click()
  await expect(page.getByRole('option', { name: /Demo sample 1/ })).toBeVisible()
}

const M = { l: 64, r: 16, t: 12, b: 44 }

export interface PlotBox { x: number; y: number; pw: number; ph: number }

export async function plotBox(page: Page): Promise<PlotBox> {
  const b = await page.locator('.plot-box').boundingBox()
  if (!b) throw new Error('plot not visible')
  return { x: b.x + M.l, y: b.y + M.t, pw: b.width - M.l - M.r, ph: b.height - M.t - M.b }
}

// Convert display coordinates (0..1, y up) to page pixels.
export function px(box: PlotBox, dx: number, dy: number): [number, number] {
  return [box.x + dx * box.pw, box.y + (1 - dy) * box.ph]
}

export async function drawRect(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.getByRole('button', { name: /Rectangle gate/ }).click()
  const box = await plotBox(page)
  const [ax, ay] = px(box, x0, y0)
  const [bx, by] = px(box, x1, y1)
  await page.mouse.move(ax, ay)
  await page.mouse.down()
  await page.mouse.move((ax + bx) / 2, (ay + by) / 2)
  await page.mouse.move(bx, by)
  await page.mouse.up()
}

export async function drawPolygon(page: Page, pts: [number, number][]): Promise<void> {
  await page.getByRole('button', { name: /Polygon gate/ }).click()
  const box = await plotBox(page)
  for (let i = 0; i < pts.length - 1; i++) {
    const [x, y] = px(box, pts[i][0], pts[i][1])
    await page.mouse.click(x, y)
  }
  const [lx, ly] = px(box, pts[pts.length - 1][0], pts[pts.length - 1][1])
  await page.mouse.dblclick(lx, ly)
}

// Main lymphocyte-like cluster in FSC-A / SSC-A of the demo sample.
export const MAIN_CLUSTER: [number, number, number, number] = [0.18, 0.0, 0.45, 0.2]

export function popRow(page: Page, name: RegExp | string): Locator {
  return page.getByRole('treeitem', { name })
}

export async function rowNumbers(row: Locator): Promise<{ count: number; pct: number }> {
  const spans = row.locator('.num')
  const count = Number((await spans.nth(0).innerText()).replace(/[^\d]/g, ''))
  const pct = parseFloat((await spans.nth(1).innerText()).replace(',', '.'))
  return { count, pct }
}

export async function menu(page: Page, title: 'File' | 'Edit' | 'Gating' | 'View' | 'Help', item: RegExp): Promise<void> {
  await page.getByRole('menuitem', { name: title, exact: true }).click()
  await page.getByRole('menuitem', { name: item }).click()
}

export function fcsBuffer(events: number, params = [{ name: 'FSC-A', range: 262144 }, { name: 'SSC-A', range: 262144 }]): Buffer {
  const cols = params.map(() => Float32Array.from({ length: events }, (_, i) => (i * 997) % 200000))
  return Buffer.from(writeFcs(params, cols))
}

// A file with a known spillover: FL1 spills 20% into FL2, FL2 spills 5% into FL1.
// 40% of events are truly FL1-positive and 50% truly FL2-positive, independently.
export function spilledFcs(events = 4000): Buffer {
  const rand = mulberry32(21)
  const t1 = Float32Array.from({ length: events }, () => (rand() < 0.4 ? 20000 * (0.8 + rand() * 0.4) : (rand() - 0.5) * 120))
  const t2 = Float32Array.from({ length: events }, () => (rand() < 0.5 ? 8000 * (0.8 + rand() * 0.4) : (rand() - 0.5) * 80))
  const fl1 = t1.map((v, i) => v + 0.05 * t2[i])
  const fl2 = t2.map((v, i) => v + 0.2 * t1[i])
  const fsc = Float32Array.from({ length: events }, () => 60000 + rand() * 100000)
  const ssc = Float32Array.from({ length: events }, () => 10000 + rand() * 60000)
  const params = [
    { name: 'FSC-A', range: 262144 }, { name: 'SSC-A', range: 262144 },
    { name: 'FL1-A', stain: 'Marker A FITC', range: 262144 }, { name: 'FL2-A', stain: 'Marker B PE', range: 262144 },
  ]
  return Buffer.from(writeFcs(params, [fsc, ssc, fl1, fl2], { extraKeywords: { $SPILLOVER: '2,FL1-A,FL2-A,1,0.2,0.05,1' } }))
}

export async function addFile(page: Page, name: string, buffer: Buffer): Promise<void> {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'File', exact: true }).click()
  await page.getByRole('menuitem', { name: /Add FCS files/ }).click()
  ;(await chooser).setFiles({ name, mimeType: 'application/octet-stream', buffer })
}

