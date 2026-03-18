import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import https from 'node:https'
import http from 'node:http'

export type ModelId = 'small' | 'medium' | 'large'
export type ModelStatus = 'not-downloaded' | 'downloading' | 'downloaded'

export interface ModelInfo {
  id: ModelId
  name: string
  description: string
  size: string
  sizeBytes: number
  fileName: string
  url: string
}

const MODELS: Record<ModelId, ModelInfo> = {
  small: {
    id: 'small',
    name: 'Small',
    description: 'Optimized for speed',
    size: '141 MB',
    sizeBytes: 141_000_000,
    fileName: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  },
  medium: {
    id: 'medium',
    name: 'Medium',
    description: 'Balanced performance',
    size: '1.4 GB',
    sizeBytes: 1_400_000_000,
    fileName: 'ggml-medium.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
  },
  large: {
    id: 'large',
    name: 'Large',
    description: 'Maximum precision',
    size: '2.9 GB',
    sizeBytes: 2_900_000_000,
    fileName: 'ggml-large-v3.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
  },
}

export function getModelsDir(): string {
  const dir = path.join(app.getPath('userData'), 'models')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function getModelInfo(id: ModelId): ModelInfo {
  const info = MODELS[id]
  if (!info) throw new Error(`Unknown model: ${id}`)
  return info
}

export function getModelPath(id: ModelId): string {
  const info = getModelInfo(id)
  return path.join(getModelsDir(), info.fileName)
}

export function getModelStatus(id: ModelId): ModelStatus {
  const filePath = getModelPath(id)
  return fs.existsSync(filePath) ? 'downloaded' : 'not-downloaded'
}

export function getAllModelsStatus(): { id: ModelId; status: ModelStatus }[] {
  return (Object.keys(MODELS) as ModelId[]).map((id) => ({
    id,
    status: getModelStatus(id),
  }))
}

function followRedirects(
  url: string,
  callback: (res: http.IncomingMessage) => void,
  maxRedirects = 10
): void {
  const client = url.startsWith('https') ? https : http

  client.get(url, (res) => {
    if (
      res.statusCode &&
      res.statusCode >= 300 &&
      res.statusCode < 400 &&
      res.headers.location
    ) {
      if (maxRedirects <= 0) {
        callback(res)
        return
      }
      // Follow the redirect
      const redirectUrl = res.headers.location.startsWith('http')
        ? res.headers.location
        : new URL(res.headers.location, url).toString()
      res.resume() // consume response to free up memory
      followRedirects(redirectUrl, callback, maxRedirects - 1)
    } else {
      callback(res)
    }
  })
}

const activeDownloads = new Set<ModelId>()

export function downloadModel(
  id: ModelId,
  onProgress: (percent: number) => void
): Promise<void> {
  const info = getModelInfo(id)
  const destPath = getModelPath(id)
  const tmpPath = destPath + '.tmp'

  if (activeDownloads.has(id)) {
    return Promise.reject(new Error(`Model ${id} is already being downloaded`))
  }

  activeDownloads.add(id)

  return new Promise<void>((resolve, reject) => {
    // Ensure models dir exists
    getModelsDir()

    followRedirects(info.url, (res) => {
      if (!res.statusCode || res.statusCode >= 400) {
        activeDownloads.delete(id)
        reject(
          new Error(`Download failed with status ${res.statusCode}`)
        )
        return
      }

      const totalBytes =
        parseInt(res.headers['content-length'] || '0', 10) || info.sizeBytes
      let downloadedBytes = 0

      const fileStream = fs.createWriteStream(tmpPath)

      res.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length
        const percent = Math.min(
          99,
          Math.round((downloadedBytes / totalBytes) * 100)
        )
        onProgress(percent)
      })

      res.pipe(fileStream)

      fileStream.on('finish', () => {
        fileStream.close(() => {
          try {
            fs.renameSync(tmpPath, destPath)
            onProgress(100)
            activeDownloads.delete(id)
            resolve()
          } catch (err) {
            activeDownloads.delete(id)
            cleanup(tmpPath)
            reject(err)
          }
        })
      })

      fileStream.on('error', (err) => {
        activeDownloads.delete(id)
        cleanup(tmpPath)
        reject(err)
      })

      res.on('error', (err) => {
        activeDownloads.delete(id)
        fileStream.destroy()
        cleanup(tmpPath)
        reject(err)
      })
    })
  })
}

function cleanup(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch {
    // ignore cleanup errors
  }
}

export async function deleteModel(id: ModelId): Promise<void> {
  const filePath = getModelPath(id)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

export function isOnboardingComplete(): boolean {
  const flagPath = path.join(app.getPath('userData'), 'onboarding-complete')
  return fs.existsSync(flagPath)
}

export function setOnboardingComplete(): void {
  const flagPath = path.join(app.getPath('userData'), 'onboarding-complete')
  fs.writeFileSync(flagPath, 'true', 'utf-8')
}
