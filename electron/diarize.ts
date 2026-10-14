import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import fs from 'fs'
import { app } from 'electron'

export type Segment = { from: number; to: number; text: string }
type Turn = { from: number; to: number; speaker: string }

// Tuned on a real Greek Meet interview: 0.5 (the sherpa-onnx default) merged
// both voices into one speaker, 0.7 too; 0.6 separated them cleanly.
const CLUSTER_THRESHOLD = 0.6

function getSherpaDir(): string {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'sherpa-onnx')
    : path.join(process.cwd(), 'lib', 'sherpa-onnx')
  if (!fs.existsSync(path.join(dir, 'sherpa-onnx-offline-speaker-diarization'))) {
    throw new Error('Speaker identification engine not found. Please reinstall the application.')
  }
  return dir
}

/**
 * Run sherpa-onnx speaker diarization on a 16 kHz mono WAV.
 * Resolves to speaker turns in seconds, e.g. { from: 0.3, to: 6.8, speaker: 'speaker_00' }.
 */
export function diarize(
  wavPath: string,
  onProcess: (proc: ChildProcess | null) => void,
  onProgress: (percent: number) => void
): Promise<Turn[]> {
  const dir = getSherpaDir()
  const args = [
    `--segmentation.pyannote-model=${path.join(dir, 'segmentation.onnx')}`,
    `--embedding.model=${path.join(dir, 'embedding.onnx')}`,
    // CoreML is ~3x faster than CPU. It must not run alongside whisper's
    // Metal work though — both stall waiting on the GPU — so we run after it.
    '--segmentation.provider=coreml',
    '--embedding.provider=coreml',
    `--clustering.cluster-threshold=${CLUSTER_THRESHOLD}`,
    wavPath,
  ]

  return new Promise((resolve, reject) => {
    const proc = spawn(path.join(dir, 'sherpa-onnx-offline-speaker-diarization'), args)
    onProcess(proc)
    let output = ''

    const onData = (data: Buffer) => {
      const chunk = data.toString()
      output += chunk
      const match = chunk.match(/progress\s+([\d.]+)%/g)
      if (match) onProgress(parseFloat(match[match.length - 1].replace(/[^\d.]/g, '')))
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', onData)

    proc.on('close', (code, signal) => {
      onProcess(null)
      if (signal === 'SIGTERM') return reject(new Error('Transcription cancelled'))
      if (code !== 0) return reject(new Error(`Speaker identification failed:\n${output.slice(-500)}`))

      const turns = [...output.matchAll(/^([\d.]+) -- ([\d.]+) (speaker_\d+)$/gm)].map((m) => ({
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

  // Number speakers in order of first appearance — sherpa's ids are arbitrary.
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
