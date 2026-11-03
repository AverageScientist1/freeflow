import { defineConfig } from '@playwright/test'

// Tests of the real desktop app (Electron). Build first: npm run test:desktop
export default defineConfig({
  testDir: 'e2e-desktop',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
})
