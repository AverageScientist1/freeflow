// One interface for file access. In Electron it goes through the preload bridge; in a plain browser
// (used for quick checks) it falls back to file pickers and downloads.

export interface FileData {
  name: string
  path: string | null
  data?: ArrayBuffer
  error?: string // set when the file could not be read; the others of the same selection still load
}

export interface Bridge {
  openFcs(): Promise<FileData[] | null>
  readFile(path: string): Promise<ArrayBuffer>
  readText(path: string): Promise<string>
  reveal(path: string): Promise<void>
  openWorkbench(): Promise<{ path: string | null; json: string } | null>
  saveWorkbench(json: string, path: string | null, saveAs: boolean, suggestedName: string): Promise<string | null>
  saveText(text: string, suggestedName: string, filterName: string, ext: string): Promise<string | null>
  savePng(dataUrl: string, suggestedName: string): Promise<string | null>
  pathForFile(file: File): string | null
  initialPaths(): Promise<string[]>
  onOpenPaths(cb: (paths: string[]) => void): () => void
}

interface ElectronApi {
  openFcs(): Promise<{ path: string; name: string; data?: ArrayBuffer; error?: string }[] | null>
  readFile(path: string): Promise<ArrayBuffer>
  readText(path: string): Promise<string>
  reveal(path: string): Promise<void>
  openWorkbench(): Promise<{ path: string; json: string } | null>
  saveWorkbench(json: string, path: string | null, saveAs: boolean): Promise<string | null>
  saveText(text: string, suggested: string, filterName: string, ext: string): Promise<string | null>
  savePng(dataUrl: string, suggested: string): Promise<string | null>
  pathForFile(file: File): string
  initialPaths(): Promise<string[]>
  onOpenPaths(cb: (paths: string[]) => void): () => void
}

function pickFiles(accept: string, multiple: boolean): Promise<File[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve(input.files && input.files.length ? Array.from(input.files) : null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const webBridge: Bridge = {
  async openFcs() {
    const files = await pickFiles('.fcs', true)
    if (!files) return null
    return Promise.all(files.map(async (f) => ({ name: f.name, path: null, data: await f.arrayBuffer() })))
  },
  async readFile() {
    throw new Error('Reading a file by path needs the desktop app')
  },
  async readText() {
    throw new Error('Reading a file by path needs the desktop app')
  },
  async reveal() { /* the page cannot open a folder */ },
  async openWorkbench() {
    const files = await pickFiles('.ffwb,.fcwb,application/json', false)
    if (!files) return null
    return { path: null, json: await files[0].text() }
  },
  async saveWorkbench(json, _path, _saveAs, suggestedName) {
    download(new Blob([json], { type: 'application/json' }), suggestedName)
    return suggestedName
  },
  async saveText(text, suggestedName) {
    download(new Blob([text], { type: 'text/csv;charset=utf-8' }), suggestedName)
    return suggestedName
  },
  async savePng(dataUrl, suggestedName) {
    const bytes = Uint8Array.from(atob(dataUrl.replace(/^data:image\/png;base64,/, '')), (c) => c.charCodeAt(0))
    download(new Blob([bytes], { type: 'image/png' }), suggestedName)
    return suggestedName
  },
  pathForFile: () => null,
  initialPaths: async () => [],
  onOpenPaths: () => () => undefined,
}

export function getBridge(): Bridge {
  const api = (window as unknown as { api?: ElectronApi }).api
  if (!api) return webBridge
  return {
    openFcs: api.openFcs,
    readFile: api.readFile,
    readText: api.readText,
    reveal: api.reveal,
    openWorkbench: api.openWorkbench,
    saveWorkbench: (json, path, saveAs) => api.saveWorkbench(json, path, saveAs),
    saveText: api.saveText,
    savePng: api.savePng,
    pathForFile: (f) => api.pathForFile(f) || null,
    initialPaths: api.initialPaths,
    onOpenPaths: api.onOpenPaths,
  }
}
