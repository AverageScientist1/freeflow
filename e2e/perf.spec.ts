import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, drawRect, popRow, rowNumbers, addFile } from './helpers'
import { writeFcs, mulberry32, DEMO_PARAMS } from '../src/core/synth'

// Large file: the plot must appear, and gating must answer, in a time a person would not call stuck.
const EVENTS = 1_500_000

test('PERF-1 a 1.5 million event file loads, plots and gates in reasonable time', async ({ page }) => {
  test.skip(!!process.env['CI'], 'the limits are for a normal computer, not for a shared CI machine')
  test.setTimeout(120_000)
  const rand = mulberry32(4)
  const cols = DEMO_PARAMS.map(() => new Float32Array(EVENTS))
  for (let i = 0; i < EVENTS; i++) {
    const r = rand()
    cols[0][i] = r < 0.6 ? 80000 + (rand() - 0.5) * 50000 : 130000 + (rand() - 0.5) * 60000
    cols[1][i] = r < 0.6 ? 25000 + (rand() - 0.5) * 25000 : 80000 + (rand() - 0.5) * 50000
    for (let p = 2; p < cols.length; p++) cols[p][i] = rand() * 100000
  }
  const buffer = Buffer.from(writeFcs(DEMO_PARAMS, cols))

  await page.goto('/')
  const t0 = Date.now()
  await addFile(page, 'big.fcs', buffer)
  await expect(page.getByText(/1[.,  ]?500[.,  ]?000 events/).first()).toBeVisible({ timeout: 60_000 })
  const loadMs = Date.now() - t0

  const t1 = Date.now()
  await drawRect(page, 0.18, 0.0, 0.45, 0.2)
  const row = popRow(page, /Gate 1/)
  await expect(row).toBeVisible({ timeout: 30_000 })
  const gate = await rowNumbers(row)
  const gateMs = Date.now() - t1

  const t2 = Date.now()
  await page.getByRole('combobox', { name: 'Plot type' }).selectOption('histogram')
  await expect(page.getByRole('group', { name: /Histogram of/ })).toBeVisible()
  const histMs = Date.now() - t2

  writeFileSync(join(tmpdir(), 'freeflow-perf-ui.txt'), `events ${EVENTS}\nload and first plot ${loadMs} ms\nfirst gate ${gateMs} ms (${gate.count} events)\nswitch to histogram ${histMs} ms`)
  expect(gate.count).toBeGreaterThan(0)
  expect(loadMs).toBeLessThan(30_000)
  expect(gateMs).toBeLessThan(15_000)
})
