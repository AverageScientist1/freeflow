import { contextBridge, ipcRenderer, webUtils } from 'electron'

// The renderer never touches the filesystem directly: it only calls these named channels.
contextBridge.exposeInMainWorld('api', {
  openFcs: () => ipcRenderer.invoke('fcs:open'),
  readFile: (path: string) => ipcRenderer.invoke('fcs:read', path),
  readText: (path: string) => ipcRenderer.invoke('file:readText', path),
  reveal: (path: string) => ipcRenderer.invoke('file:reveal', path),
  openWorkbench: () => ipcRenderer.invoke('workbench:open'),
  saveWorkbench: (json: string, path: string | null, saveAs: boolean) => ipcRenderer.invoke('workbench:save', json, path, saveAs),
  saveText: (text: string, suggested: string, filterName: string, ext: string) => ipcRenderer.invoke('file:saveText', text, suggested, filterName, ext),
  savePng: (dataUrl: string, suggested: string) => ipcRenderer.invoke('file:savePng', dataUrl, suggested),
  // the real path of a file dropped on the window (the page only sees its content)
  pathForFile: (file: File): string => {
    try { return webUtils.getPathForFile(file) } catch { return '' }
  },
  initialPaths: (): Promise<string[]> => ipcRenderer.invoke('app:initialPaths'),
  onOpenPaths: (cb: (paths: string[]) => void): (() => void) => {
    const listener = (_e: unknown, paths: string[]): void => cb(paths)
    ipcRenderer.on('open-paths', listener)
    return () => ipcRenderer.removeListener('open-paths', listener)
  },
})
