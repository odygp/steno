import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { app } from 'electron'

export type Segment = { from: number; to: number; text: string }
type Turn = { from: number; to: number; speaker: string }

// FluidAudio's CoreML pipeline needs macOS 14 (Darwin 23)
export function canIdentifySpeakers(): boolean {
  return parseInt(os.release(), 10) >= 23
}

function getDiarizeDir(): string {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'diarize')
    : path.join(process.cwd(), 'lib', 'diarize')
  if (!fs.existsSync(path.join(dir, 'steno-diarize'))) {
    throw new Error('Speaker identification engine not found. Please reinstall the application.')
  }
  return dir
}

/**
 * Run speaker diarization (native/diarize, FluidAudio's offline pyannote
 * Community-1 pipeline) on a 16 kHz mono WAV. `speakers` fixes the number of
 * speakers; omit it to detect automatically.
 * Resolves to speaker turns in seconds, e.g. { from: 0.3, to: 6.8, speaker: 'speaker_01' }.
 */
export function diarize(
  wavPath: string,
  speakers: number | null,
  onProcess: (proc: ChildProcess | null) => void,
  onProgress: (percent: number) => void
): Promise<Turn[]> {
  const dir = getDiarizeDir()
  const args = [path.join(dir, 'models'), wavPath]
  if (speakers) args.push(String(speakers))

  return new Promise((resolve, reject) => {
    // Runs after whisper rather than alongside it: both use the GPU via CoreML/Metal
    const proc = spawn(path.join(dir, 'steno-diarize'), args)
    onProcess(proc)
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })
    proc.stderr.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr += chunk
      const match = chunk.match(/progress (\d+)%/g)
      if (match) onProgress(parseInt(match[match.length - 1].replace(/\D/g, ''), 10))
    })

    proc.on('close', (code, signal) => {
      onProcess(null)
      if (signal === 'SIGTERM') return reject(new Error('Transcription cancelled'))
      if (code !== 0) return reject(new Error(`Speaker identification failed:\n${stderr.slice(-500)}`))

      const turns = [...stdout.matchAll(/^([\d.]+) -- ([\d.]+) (speaker_\d+)$/gm)].map((m) => ({
        from: parseFloat(m[1]),
        to: parseFloat(m[2]),
        speaker: m[3],
      }))
      resolve(turns)
    })

    proc.on('error', (err) => {
      onProcess(null)
      reject(new Error(`Failed to start speaker identification: ${err.message}`))
    })
  })
}

/**
 * Give each whisper segment the speaker it overlaps most, and join consecutive
 * segments of the same speaker into one paragraph:
 *
 *   Speaker 1: …
 *
 *   Speaker 2: …
 */
// Every cluster is kept, even small ones: a speaker who mostly says "ok" can
// be split across several clusters that are each tiny. Naming two speakers the
// same in the transcript window merges them.
export function labelSpeakers(segments: Segment[], turns: Turn[]): string {
  if (turns.length === 0) return segments.map((s) => s.text).join('\n')

  // Number speakers in order of first appearance — the engine's ids are arbitrary.
  const names = new Map<string, string>()
  for (const t of turns) if (!names.has(t.speaker)) names.set(t.speaker, `Speaker ${names.size + 1}`)

  const speakerOf = (seg: Segment): string => {
    const overlap = new Map<string, number>()
    for (const t of turns) {
      const o = Math.min(seg.to, t.to) - Math.max(seg.from, t.from)
      if (o > 0) overlap.set(t.speaker, (overlap.get(t.speaker) || 0) + o)
    }
    if (overlap.size) return [...overlap].sort((a, b) => b[1] - a[1])[0][0]

    const mid = (seg.from + seg.to) / 2
    const dist = (t: Turn) => Math.max(t.from - mid, mid - t.to, 0)
    return turns.reduce((a, b) => (dist(b) < dist(a) ? b : a)).speaker
  }

  const paragraphs: { speaker: string; text: string }[] = []
  for (const seg of segments) {
    const speaker = speakerOf(seg)
    const last = paragraphs[paragraphs.length - 1]
    if (last && last.speaker === speaker) last.text += ' ' + seg.text
    else paragraphs.push({ speaker, text: seg.text })
  }

  return paragraphs.map((p) => `${names.get(p.speaker)}: ${p.text}`).join('\n\n')
}
