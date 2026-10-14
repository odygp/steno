import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { app } from 'electron'
import { getModelPath as getModelFilePath, ModelId } from './models'
import { diarize, labelSpeakers, Segment } from './diarize'

type ProgressCallback = (step: string, percent: number) => void
type TextCallback = (text: string) => void

// Resolve the bundled ffmpeg binary path.
function getFfmpegPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'ffmpeg', 'ffmpeg')
  }
  // In development, use ffmpeg-static from node_modules
  const devPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')
  if (fs.existsSync(devPath)) return devPath
  throw new Error('ffmpeg binary not found. Please reinstall the application.')
}

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
    'Whisper engine not found. Please reinstall the application.'
  )
}

// Silero voice-activity model, shipped next to the whisper binary.
const VAD_MODEL = 'ggml-silero-v6.2.0.bin'

// ── Convert any audio/video to 16 kHz mono WAV via ffmpeg ──

function convertToWav(inputPath: string): Promise<string> {
  const outputPath = path.join(
    os.tmpdir(),
    `steno-${Date.now()}.wav`
  )

  return new Promise((resolve, reject) => {
    console.log('[steno] ffmpeg converting:', inputPath, '→', outputPath)

    const ffmpegBin = getFfmpegPath()
    const ffmpeg = spawn(ffmpegBin, [
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-y',
      outputPath,
    ])

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
          `ffmpeg error: ${err.message}`
        )
      )
    })
  })
}

/**
 * Collapse runaway decoder loops — a phrase repeated verbatim three or more
 * times in a row is a hallucination, not speech. Keeps one occurrence.
 * Covers repeats within a line and the same line repeated across consecutive
 * lines (one per 30 s window over silence).
 */
function collapseRepeats(text: string): string {
  return text
    .replace(/(.{10,120}?)\1{2,}/g, '$1')
    .replace(/^(.+)(?:\n\1$){2,}/gm, '$1')
}

// ── Whisper stdout parsing ──

const SEGMENT_LINE = /^\[(\d+):(\d+):([\d.]+) --> (\d+):(\d+):([\d.]+)\]\s*(.*)$/

/** Turn `[00:00:05.940 --> 00:00:10.320]   text` lines into timed segments (seconds). */
function parseSegments(stdout: string): Segment[] {
  const segments: Segment[] = []
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(SEGMENT_LINE)
    if (!m || !m[7].trim()) continue
    segments.push({
      from: +m[1] * 3600 + +m[2] * 60 + +m[3],
      to: +m[4] * 3600 + +m[5] * 60 + +m[6],
      text: m[7].trim(),
    })
  }
  return segments
}

function stripTimestamps(chunk: string): string {
  return chunk
    .split('\n')
    .map((l) => l.replace(/^\[.*?]\s*/, '').trim())
    .filter((l) => l.length > 0)
    .join('\n')
}

// ── Active process tracking (for cancellation) ──

let activeProcess: ReturnType<typeof spawn> | null = null
let activeWavPath: string | null = null

export function cancelTranscription(): void {
  if (activeProcess) {
    activeProcess.kill('SIGTERM')
    activeProcess = null
  }
  if (activeWavPath) {
    fs.unlink(activeWavPath, () => {})
    activeWavPath = null
  }
}

// ── Main transcription pipeline ──

export async function transcribe(
  filePath: string,
  modelId: string,
  language: string,
  // null: no speaker labels; 'auto': detect how many; a number: exactly that many
  speakers: number | 'auto' | null,
  onProgress: ProgressCallback,
  onText: TextCallback
): Promise<string> {
  const whisperPath = getWhisperPath()
  const modelPath = getModelFilePath(modelId as ModelId)

  if (!fs.existsSync(modelPath)) {
    throw new Error(
      'Whisper model not found. Please download a model from the Models tab.'
    )
  }

  // Step 1 — Convert
  onProgress('Preparing audio…', 5)
  const wavPath = await convertToWav(filePath)
  activeWavPath = wavPath

  // Step 2 — Warm up
  onProgress('Warming up Neural Engine…', 15)

  return new Promise((resolve, reject) => {
    const args = [
      '-m', modelPath,
      '-l', language,
      '-f', wavPath,
      '--print-progress',
      // Don't carry text context between windows. Otherwise a single
      // hallucination (e.g. a subtitle credit line) becomes the prompt for the
      // next window and repeats to the end of the file, replacing real speech.
      '-mc', '0',
      '-sns', // suppress non-speech tokens, which trigger those hallucinations
      // Skip silence entirely. Over silent stretches whisper invents text
      // ("Υπότιτλοι AUTHORWAVE", "Subtitles by…") once per 30 s window.
      // Timestamps stay on the original timeline, so speaker labels still line up.
      '--vad', '-vm', path.join(path.dirname(whisperPath), VAD_MODEL),
      '-t', String(Math.max(1, os.cpus().length - 2)),
    ]

    const whisperDir = path.dirname(whisperPath)
    const whisper = spawn(whisperPath, args, {
      env: { ...process.env, DYLD_LIBRARY_PATH: whisperDir },
    })
    activeProcess = whisper
    let stdout = ''
    let stderr = ''

    // whisper.cpp flushes stdout after every segment, so each chunk is
    // (roughly) one freshly decoded segment — stream it to the UI.
    whisper.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stdout += chunk
      const text = stripTimestamps(chunk)
      if (text) onText(text)
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
        // Leave room on the bar for speaker identification when it runs next
        const share = speakers !== null ? 0.45 : 0.6
        onProgress('Transcribing offline…', 30 + Math.floor(pct * share))
      }
    })

    whisper.on('close', async (code, signal) => {
      activeProcess = null
      const cleanup = () => {
        fs.unlink(wavPath, () => {})
        activeWavPath = null
      }

      if (signal === 'SIGTERM') {
        cleanup()
        reject(new Error('Transcription cancelled'))
        return
      }

      if (code !== 0) {
        cleanup()
        reject(new Error(`Transcription failed:\n${stderr.slice(-500)}`))
        return
      }

      try {
        const segments = parseSegments(stdout)
        let text = segments.map((s) => s.text).join('\n')

        if (speakers !== null) {
          onProgress('Identifying speakers…', 75)
          const turns = await diarize(
            wavPath,
            speakers === 'auto' ? null : speakers,
            (proc) => { activeProcess = proc },
            (pct) => onProgress('Identifying speakers…', 75 + Math.floor(pct * 0.2))
          )
          text = labelSpeakers(segments, turns)
        }

        onProgress('Finalizing…', 95)
        const cleaned = collapseRepeats(text)

        setTimeout(() => {
          onProgress('Done', 100)
          resolve(cleaned)
        }, 300)
      } catch (err) {
        reject(err)
      } finally {
        cleanup()
      }
    })

    whisper.on('error', (err) => {
      activeProcess = null
      fs.unlink(wavPath, () => {})
      activeWavPath = null
      reject(new Error(`Failed to start whisper: ${err.message}`))
    })
  })
}
