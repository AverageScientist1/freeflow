import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version

// Content Security Policy is added only to production builds, because the dev server injects inline scripts.
const csp = {
  name: 'csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) =>
    html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src about:" />`),
}

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('src/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve('src/preload/index.ts') } } },
  renderer: {
    root: 'src/renderer',
    plugins: [react(), csp],
    define: { __APP_VERSION__: JSON.stringify(version) },
    resolve: { alias: { '@core': resolve('src/core') } },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})
