import { app, BrowserWindow, ipcMain, dialog } from 'electron'
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

ipcMain.handle('transcribe', async (_event, filePath: string, modelId: string, language: string) => {
  console.log('[steno] transcribe:', filePath, 'model:', modelId, 'lang:', language)

  const onProgress = (step: string, percent: number) => {
    mainWindow?.webContents.send('transcription:progress', { step, percent })
  }

  try {
    const text = await transcribe(filePath, modelId, language, onProgress)
    return { success: true, text }
  } catch (error: any) {
    if (error.message === 'Transcription cancelled') {
      return { success: false, error: 'cancelled' }
    }
    return { success: false, error: error.message }
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
