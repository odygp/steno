import { app, BrowserWindow, Menu, MenuItem, ipcMain, dialog, screen } from 'electron'
import { autoUpdater } from 'electron-updater'
import path from 'path'
import fs from 'fs'
import { transcribe, cancelTranscription } from './whisper'
import {
  getAllModelsStatus,
  getModelInfo,
  getModelStatus,
  downloadModel,
  deleteModel,
  isOnboardingComplete,
  setOnboardingComplete,
  ModelId,
} from './models'

let mainWindow: BrowserWindow | null = null
let widgetWindow: BrowserWindow | null = null
let widgetPosition: { x: number; y: number } | null = null // where the user last dragged it
let transcribingFile: string | null = null
let lastProgress = { step: '', percent: 0 }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 640,
    resizable: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 18 },
    backgroundColor: '#09090b',
    icon: path.join(__dirname, '../build/app-icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // While transcribing, a floating progress widget stands in for the main
  // window whenever the user is elsewhere.
  mainWindow.on('blur', () => {
    if (transcribingFile) showWidget()
  })
  mainWindow.on('focus', () => widgetWindow?.hide())
}

function showWidget() {
  if (!widgetWindow) {
    const { workArea } = screen.getPrimaryDisplay()
    const width = 300
    const height = 88
    widgetWindow = new BrowserWindow({
      width,
      height,
      x: widgetPosition?.x ?? workArea.x + workArea.width - width - 16,
      y: widgetPosition?.y ?? workArea.y + 16,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      acceptFirstMouse: true, // first click on the inactive widget should count
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
      },
    })
    widgetWindow.setAlwaysOnTop(true, 'floating')
    widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    widgetWindow.on('closed', () => {
      widgetWindow = null
    })
    // Keep it fully on screen after a drag, and remember where it was put
    widgetWindow.on('moved', () => {
      if (!widgetWindow) return
      const b = widgetWindow.getBounds()
      const { workArea: a } = screen.getDisplayMatching(b)
      const x = Math.min(Math.max(b.x, a.x), a.x + a.width - b.width)
      const y = Math.min(Math.max(b.y, a.y), a.y + a.height - b.height)
      if (x !== b.x || y !== b.y) widgetWindow.setPosition(x, y)
      widgetPosition = { x, y }
    })

    if (process.env.VITE_DEV_SERVER_URL) {
      widgetWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#widget`)
    } else {
      widgetWindow.loadFile(path.join(__dirname, '../dist/index.html'), { hash: 'widget' })
    }
    widgetWindow.once('ready-to-show', () => widgetWindow?.showInactive())
  } else {
    widgetWindow.showInactive()
  }
}

function closeWidget() {
  widgetWindow?.close()
  widgetWindow = null
}

function createTranscriptionWindow(text: string, fileName: string) {
  const win = new BrowserWindow({
    width: 1130,
    height: 752,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 24 },
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#transcription`)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'), {
      hash: 'transcription',
    })
  }

  win.webContents.on('did-finish-load', () => {
    win.webContents.send('transcript-data', { text, fileName })
  })
}

app.setName('Steno')

// Build a native context menu on right-click. Passing `frame` to popup() lets
// macOS inject Writing Tools, Services, Autofill, and spellcheck suggestions.
app.on('web-contents-created', (_event, contents) => {
  contents.on('context-menu', (_e, params) => {
    const menu = new Menu()
    const { editFlags, isEditable, selectionText } = params

    if (isEditable) {
      if (editFlags.canCut) menu.append(new MenuItem({ role: 'cut' }))
      if (editFlags.canCopy) menu.append(new MenuItem({ role: 'copy' }))
      if (editFlags.canPaste) menu.append(new MenuItem({ role: 'paste' }))
      if (editFlags.canSelectAll) menu.append(new MenuItem({ role: 'selectAll' }))
    } else if (selectionText && selectionText.trim().length > 0) {
      if (editFlags.canCopy) menu.append(new MenuItem({ role: 'copy' }))
      if (editFlags.canSelectAll) menu.append(new MenuItem({ role: 'selectAll' }))
    }

    menu.popup({ frame: params.frame ?? undefined })
  })
})

app.whenReady().then(() => {
  createWindow()

  // Check for updates (skip in dev)
  if (!process.env.VITE_DEV_SERVER_URL) {
    autoUpdater.checkForUpdatesAndNotify()
  }
})

autoUpdater.on('update-downloaded', () => {
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update Ready',
      message: 'A new version of Steno has been downloaded. Restart to apply the update?',
      buttons: ['Restart', 'Later'],
    })
    .then((result) => {
      if (result.response === 0) {
        setImmediate(() => autoUpdater.quitAndInstall(false, true))
      }
    })
})

app.on('window-all-closed', () => {
  app.quit()
})

// ── IPC Handlers ──

ipcMain.handle('show-open-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      {
        name: 'Audio & Video',
        extensions: ['mp3', 'wav', 'm4a', 'mp4', 'mov'],
      },
    ],
  })
  return result.filePaths[0] || null
})

ipcMain.handle('transcribe', async (_event, filePath: string, modelId: string, language: string, identifySpeakers: boolean) => {
  console.log('[steno] transcribe:', filePath, 'model:', modelId, 'lang:', language, 'speakers:', identifySpeakers)

  const onProgress = (step: string, percent: number) => {
    lastProgress = { step, percent }
    mainWindow?.webContents.send('transcription:progress', { step, percent })
    widgetWindow?.webContents.send('transcription:progress', { step, percent })
  }

  const onText = (text: string) => {
    mainWindow?.webContents.send('transcription:text', text)
  }

  transcribingFile = path.basename(filePath)
  lastProgress = { step: '', percent: 0 }
  if (!mainWindow?.isFocused()) showWidget()
  try {
    const text = await transcribe(filePath, modelId, language, identifySpeakers, onProgress, onText)
    return { success: true, text }
  } catch (error: any) {
    if (error.message === 'Transcription cancelled') {
      return { success: false, error: 'cancelled' }
    }
    return { success: false, error: error.message }
  } finally {
    transcribingFile = null
    closeWidget()
  }
})

ipcMain.handle('cancel-transcription', () => {
  cancelTranscription()
})

ipcMain.handle(
  'open-transcription-window',
  async (_event, text: string, fileName: string) => {
    createTranscriptionWindow(text, fileName)
  }
)

ipcMain.handle('get-widget-state', () => ({ fileName: transcribingFile ?? '', ...lastProgress }))

ipcMain.handle('focus-main', () => {
  app.focus({ steal: true })
  mainWindow?.show()
  mainWindow?.focus()
})

ipcMain.handle('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  win?.close()
})

// ── Model management IPC handlers ──

ipcMain.handle('get-models', async () => {
  const statuses = getAllModelsStatus()
  return statuses.map(({ id, status }) => {
    const info = getModelInfo(id)
    return {
      id: info.id,
      name: info.name,
      description: info.description,
      size: info.size,
      status,
    }
  })
})

ipcMain.handle('download-model', async (_event, modelId: string) => {
  try {
    await downloadModel(modelId as ModelId, (percent) => {
      mainWindow?.webContents.send('model:download-progress', {
        modelId,
        percent,
      })
    })
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('delete-model', async (_event, modelId: string) => {
  try {
    await deleteModel(modelId as ModelId)
    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('is-onboarding-complete', async () => {
  return isOnboardingComplete()
})

ipcMain.handle('set-onboarding-complete', async () => {
  setOnboardingComplete()
})

ipcMain.handle(
  'save-transcript',
  async (_event, text: string, fileName: string) => {
    const defaultName = fileName.replace(/\.[^.]+$/, '') + '-transcript.txt'
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'Text Files', extensions: ['txt'] }],
    })
    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, text, 'utf-8')
      return true
    }
    return false
  }
)
