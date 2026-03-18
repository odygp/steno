import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('steno', {
  // ── Main window APIs ──
  transcribe: (filePath: string, modelId: string) =>
    ipcRenderer.invoke('transcribe', filePath, modelId),

  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  onProgress: (
    callback: (data: { step: string; percent: number }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { step: string; percent: number }
    ) => callback(data)
    ipcRenderer.on('transcription:progress', handler)
    return () => {
      ipcRenderer.removeListener('transcription:progress', handler)
    }
  },

  showOpenDialog: () => ipcRenderer.invoke('show-open-dialog'),

  openTranscriptionWindow: (text: string, fileName: string) =>
    ipcRenderer.invoke('open-transcription-window', text, fileName),

  // ── Transcription window APIs ──
  onTranscriptData: (
    callback: (data: { text: string; fileName: string }) => void
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { text: string; fileName: string }
    ) => callback(data)
    ipcRenderer.on('transcript-data', handler)
    return () => {
      ipcRenderer.removeListener('transcript-data', handler)
    }
  },

  closeWindow: () => ipcRenderer.invoke('close-window'),

  saveTranscript: (text: string, fileName: string) =>
    ipcRenderer.invoke('save-transcript', text, fileName),

  // ── Model management APIs ──
  getModels: () => ipcRenderer.invoke('get-models'),

  downloadModel: (modelId: string) =>
    ipcRenderer.invoke('download-model', modelId),

  deleteModel: (modelId: string) =>
    ipcRenderer.invoke('delete-model', modelId),

  isOnboardingComplete: () => ipcRenderer.invoke('is-onboarding-complete'),

  setOnboardingComplete: () => ipcRenderer.invoke('set-onboarding-complete'),

  onModelDownloadProgress: (
    callback: (data: { modelId: string; percent: number }) => void
  ) => {
    const handler = (_event: any, data: any) => callback(data)
    ipcRenderer.on('model:download-progress', handler)
    return () => {
      ipcRenderer.removeListener('model:download-progress', handler)
    }
  },
})
