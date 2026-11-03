import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

// The program's own picture for the window and the taskbar. The .exe itself is left exactly as Electron ships it (see package.json:
// disableAsarIntegrity and signAndEditExecutable), so that Windows Smart App Control recognises it; that is why the icon is set here.
const iconPath = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')

function createWindow(): void {
  const win = new BrowserWindow({
    icon: iconPath,
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'Freeflow',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // the page runs in the operating system's sandbox, with no access to the computer except the bridge in the preload
    },
  })
  // The program never opens another window or goes to another page: a link or a script that tries is refused, so the window can only
  // ever show this program's own page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    const dev = process.env['ELECTRON_RENDERER_URL']
    if (!(dev && url.startsWith(dev)) && !url.startsWith('file://')) event.preventDefault()
  })
  // No permission (camera, microphone, location, notifications...) is ever granted to the page.
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))

  // The page asks to stay open when there are unsaved changes; Electron needs this handler to show the question.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['Leave', 'Stay'], defaultId: 1, cancelId: 1,
      title: 'Unsaved changes', message: 'You have unsaved changes. Leave without saving?',
    })
    if (choice === 0) event.preventDefault() // ignore the page's request and close
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

function toArrayBuffer(b: Buffer): ArrayBuffer {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

// A plain explanation of why a file could not be read. Files kept in OneDrive or on a network drive can be
// "online only" or locked by another program, which Windows reports with unhelpful codes.
function describeReadError(e: unknown): string {
  const err = e as NodeJS.ErrnoException
  switch (err.code) {
    case 'ENOENT': return 'The file was not found. It may have been moved, renamed or deleted.'
    case 'EBUSY':
    case 'EPERM':
    case 'EACCES': return 'The file could not be opened. Another program may be using it, or you may not have permission.'
    case 'UNKNOWN':
    case 'EIO':
    case 'ETIMEDOUT': return 'The file could not be read. If it is in OneDrive or on a network drive, make sure it is downloaded ("Always keep on this device") and try again.'
    default: return err.message || 'The file could not be read.'
  }
}

// Every file is read on its own: one that cannot be read is reported by name and does not stop the others.
ipcMain.handle('fcs:open', async () => {
  const r = await dialog.showOpenDialog({ title: 'Add FCS files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'FCS files', extensions: ['fcs'] }, { name: 'All files', extensions: ['*'] }] })
  if (r.canceled) return null
  return Promise.all(r.filePaths.map(async (p) => {
    try {
      return { path: p, name: basename(p), data: toArrayBuffer(await readFile(p)) }
    } catch (e) {
      return { path: p, name: basename(p), error: describeReadError(e) }
    }
  }))
})

// Shows a file in its folder (Explorer on Windows, Finder on a Mac).
ipcMain.handle('file:reveal', (_e, path: unknown) => {
  if (typeof path === 'string' && path) shell.showItemInFolder(path)
})

ipcMain.handle('fcs:read', async (_e, path: string) => {
  try {
    return toArrayBuffer(await readFile(path))
  } catch (e) {
    throw new Error(describeReadError(e))
  }
})

ipcMain.handle('workbench:open', async () => {
  const r = await dialog.showOpenDialog({ title: 'Open Workbench', properties: ['openFile'], filters: [{ name: 'Freeflow Workbench', extensions: ['ffwb', 'fcwb'] }] })
  if (r.canceled || !r.filePaths[0]) return null
  return { path: r.filePaths[0], json: await readFile(r.filePaths[0], 'utf8') }
})

ipcMain.handle('workbench:save', async (_e, json: string, path: string | null, saveAs: boolean) => {
  let target = path
  if (!target || saveAs) {
    const r = await dialog.showSaveDialog({ title: 'Save Workbench', defaultPath: target ?? 'Untitled.ffwb', filters: [{ name: 'Freeflow Workbench', extensions: ['ffwb'] }] })
    if (r.canceled || !r.filePath) return null
    target = r.filePath
  }
  await writeFile(target, json, 'utf8')
  return target
})

function describeWriteError(e: unknown): string {
  const err = e as NodeJS.ErrnoException
  if (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES') return 'The file could not be written. If it is open in another program (for example Excel), close it and try again.'
  if (err.code === 'ENOENT') return 'The folder does not exist any more.'
  return err.message || 'The file could not be written.'
}

// A file chosen in the Windows "Open with" menu, or dropped on the program icon, arrives as a command-line argument.
const OPENABLE = /\.(fcs|ffwb|fcwb)$/i
const pathsFromArgv = (argv: string[]): string[] => argv.slice(1).filter((a) => !a.startsWith('-') && OPENABLE.test(a))
let pendingPaths = pathsFromArgv(process.argv)

// On a Mac, files opened from Finder arrive as an event, not as an argument (before and after the window exists).
app.on('open-file', (event, path) => {
  event.preventDefault()
  const win = BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('open-paths', [path])
  else pendingPaths.push(path)
})

ipcMain.handle('app:initialPaths', () => {
  const p = pendingPaths
  pendingPaths = []
  return p
})

ipcMain.handle('file:readText', async (_e, path: string) => {
  try {
    return await readFile(path, 'utf8')
  } catch (e) {
    throw new Error(describeReadError(e))
  }
})

// Exports: the text (CSV) or image the page made is written where the person chooses.
ipcMain.handle('file:saveText', async (_e, text: string, suggested: string, filterName: string, ext: string) => {
  const r = await dialog.showSaveDialog({ title: 'Save', defaultPath: suggested, filters: [{ name: filterName, extensions: [ext] }] })
  if (r.canceled || !r.filePath) return null
  try {
    await writeFile(r.filePath, text, 'utf8')
  } catch (e) {
    throw new Error(describeWriteError(e))
  }
  return r.filePath
})

ipcMain.handle('file:savePng', async (_e, dataUrl: string, suggested: string) => {
  const r = await dialog.showSaveDialog({ title: 'Save image', defaultPath: suggested, filters: [{ name: 'PNG image', extensions: ['png'] }] })
  if (r.canceled || !r.filePath) return null
  try {
    await writeFile(r.filePath, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'))
  } catch (e) {
    throw new Error(describeWriteError(e))
  }
  return r.filePath
})

// One window only: opening another file while the program is running hands it to the open window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    const paths = pathsFromArgv(argv)
    if (paths.length) win.webContents.send('open-paths', paths)
  })
  void app.whenReady().then(() => {
    app.setAppUserModelId('app.freeflow.desktop')
    // The program draws its own menus in the page. Electron's ready-made menu would add Reload and Developer Tools (and, on Windows, appear
    // when Alt is pressed), so it is replaced. A Mac needs its own application menu (About, Hide, Quit...) and the clipboard keys; Undo and
    // Redo are left out on purpose because Cmd+Z belongs to the program's own history, not to the page.
    if (process.platform === 'darwin') {
      Menu.setApplicationMenu(Menu.buildFromTemplate([
        { role: 'appMenu' },
        { label: 'Edit', submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
        { role: 'windowMenu' },
      ]))
    } else {
      Menu.setApplicationMenu(null)
    }    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
