import { spawn, execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { app } from 'electron'
import { getModelPath as getModelFilePath, ModelId } from './models'

type ProgressCallback = (step: string, percent: number) => void

// Electron doesn't inherit the user's shell PATH on macOS.
// Resolve Homebrew paths so we can find ffmpeg and set DYLD paths.
const BREW_PREFIX = fs.existsSync('/opt/homebrew/bin')
  ? '/opt/homebrew'
  : '/usr/local'

const SHELL_PATH = [
  `${BREW_PREFIX}/bin`,
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
  process.env.PATH,
].join(':')

const shellEnv = { ...process.env, PATH: SHELL_PATH }

/**
 * Resolve the whisper binary — newer versions use `whisper-cli`,
 * older versions use `main`.
 */
function getWhisperPath(): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'whisper')
    : path.join(process.cwd(), 'lib', 'whisper.cpp', 'build', 'bin')

  const cli = path.join(base, 'whisper-cli')
  if (fs.existsSync(cli)) return cli

  const main = path.join(base, 'main')
  if (fs.existsSync(main)) return main

  // Fallback for older Makefile builds (binary in repo root)
  const fallback = path.join(process.cwd(), 'lib', 'whisper.cpp', 'main')
  if (fs.existsSync(fallback)) return fallback

  throw new Error(
    'whisper.cpp binary not found.\nRun: npm run setup:whisper'
  )
}

// ── Convert any audio/video to 16 kHz mono WAV via ffmpeg ──

function convertToWav(inputPath: string): Promise<string> {
  const outputPath = path.join(
    os.tmpdir(),
    `steno-${Date.now()}.wav`
  )

  return new Promise((resolve, reject) => {
    console.log('[steno] ffmpeg converting:', inputPath, '→', outputPath)

    const ffmpeg = spawn('ffmpeg', [
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-y',
      outputPath,
    ], { env: shellEnv })

    let stderrLog = ''
    ffmpeg.stderr.on('data', (data: Buffer) => {
      stderrLog += data.toString()
    })

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outputPath)
      else {
        console.error('[steno] ffmpeg stderr:', stderrLog)
        reject(new Error(`ffmpeg exited with code ${code}\n${stderrLog.slice(-300)}`))
      }
    })

    ffmpeg.on('error', (err) => {
      reject(
        new Error(
          `ffmpeg not found (${err.message}). Install it with:\n  brew install ffmpeg`
        )
      )
    })
  })
}

// ── Main transcription pipeline ──

export async function transcribe(
  filePath: string,
  modelId: string,
  onProgress: ProgressCallback
): Promise<string> {
  const whisperPath = getWhisperPath()
  const modelPath = getModelFilePath(modelId as ModelId)

  if (!fs.existsSync(modelPath)) {
    throw new Error(
      'Whisper model not found.\nRun: npm run setup:whisper'
    )
  }

  // Step 1 — Convert
  onProgress('Preparing audio…', 5)
  const wavPath = await convertToWav(filePath)

  // Step 2 — Warm up
  onProgress('Warming up Neural Engine…', 15)

  return new Promise((resolve, reject) => {
    const args = [
      '-m', modelPath,
      '-l', 'el',
      '-f', wavPath,
      '--no-timestamps',
      '--print-progress',
      '-t', String(Math.max(1, os.cpus().length - 2)),
    ]

    const whisper = spawn(whisperPath, args, { env: shellEnv })
    let stdout = ''
    let stderr = ''

    whisper.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    whisper.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr += chunk

      // Detect model loaded
      if (chunk.includes('system_info')) {
        onProgress('Transcribing offline…', 30)
      }

      // Track real progress from whisper.cpp
      const match = chunk.match(/progress\s*=\s*(\d+)%/)
      if (match) {
        const pct = parseInt(match[1], 10)
        onProgress('Transcribing offline…', 30 + Math.floor(pct * 0.6))
      }
    })

    whisper.on('close', (code) => {
      // Clean up temp file
      fs.unlink(wavPath, () => {})

      if (code === 0) {
        onProgress('Finalizing…', 95)

        const cleaned = stdout
          .split('\n')
          .map((l) => l.replace(/^\[.*?]\s*/, '').trim())
          .filter((l) => l.length > 0)
          .join('\n')

        setTimeout(() => {
          onProgress('Done', 100)
          resolve(cleaned)
        }, 300)
      } else {
        reject(new Error(`Transcription failed:\n${stderr.slice(-500)}`))
      }
    })

    whisper.on('error', (err) => {
      fs.unlink(wavPath, () => {})
      reject(new Error(`Failed to start whisper: ${err.message}`))
    })
  })
}
