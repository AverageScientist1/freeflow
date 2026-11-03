import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version

// Browser-only build of the renderer, used for quick checks without Electron.
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: { alias: { '@core': resolve('src/core') } },
  server: { port: 5173, strictPort: true },
})
