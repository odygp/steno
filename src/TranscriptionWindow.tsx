import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

// Speaker identification labels paragraphs as "Speaker 1: …"
const SPEAKER_LABEL = /^Speaker (\d+): /

export default function TranscriptionWindow() {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [copied, setCopied] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})

  const paragraphs = useMemo(
    () =>
      text.split('\n\n').map((p) => {
        const m = p.match(SPEAKER_LABEL)
        return m ? { speaker: m[1], body: p.slice(m[0].length) } : { speaker: null, body: p }
      }),
    [text]
  )

  // Each speaker once, in order of appearance, with their first words as a hint
  const speakers = useMemo(() => {
    const seen = new Map<string, string>()
    for (const p of paragraphs) if (p.speaker && !seen.has(p.speaker)) seen.set(p.speaker, p.body)
    return [...seen].map(([id, firstWords]) => ({ id, firstWords }))
  }, [paragraphs])

  const nameOf = (id: string) => names[id]?.trim() || `Speaker ${id}`

  // Paragraphs with the chosen names. One person is sometimes split across
  // several speakers; giving them the same name joins their paragraphs.
  const named: { name: string | null; body: string }[] = []
  for (const p of paragraphs) {
    const name = p.speaker ? nameOf(p.speaker) : null
    const last = named[named.length - 1]
    if (name && last?.name === name) last.body += ' ' + p.body
    else named.push({ name, body: p.body })
  }

  // What gets copied and exported
  const exportText = named.map((p) => (p.name ? `${p.name}: ${p.body}` : p.body)).join('\n\n')

  useEffect(() => {
    return window.steno.onTranscriptData(({ text, fileName }) => {
      setText(text)
      setFileName(fileName)
    })
  }, [])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(exportText)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [exportText])

  const handleDownload = useCallback(async () => {
    await window.steno.saveTranscript(exportText, fileName)
  }, [exportText, fileName])

  const handleClose = useCallback(() => {
    window.steno.closeWindow()
  }, [])

  return (
    <div className="h-screen w-screen bg-white text-black flex flex-col overflow-hidden select-none font-sans">
      {/* ── Header (68px) ── */}
      <div
        className="h-[68px] flex items-center justify-between px-4 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <p className="text-[14px] font-medium text-black truncate pl-[60px] flex-1">
          {fileName}
        </p>
        <button
          onClick={handleClose}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-black hover:bg-zinc-100 transition-all shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 flex flex-col items-center px-6 pb-6 overflow-hidden">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="w-full max-w-[640px] flex flex-col gap-5 flex-1 min-h-0"
        >
          {/* Speaker names */}
          {speakers.length > 0 && (
            <div className="border border-zinc-200 rounded-xl p-4 flex flex-col gap-2 shrink-0">
              <p className="text-[11px] text-zinc-500">Speakers</p>
              {speakers.map((sp) => (
                <div key={sp.id} className="flex items-center gap-3">
                  <input
                    value={names[sp.id] ?? ''}
                    onChange={(e) => setNames((prev) => ({ ...prev, [sp.id]: e.target.value }))}
                    placeholder={`Speaker ${sp.id}`}
                    className="w-[180px] h-8 shrink-0 border border-zinc-300 rounded-lg px-3 text-[13px] text-black placeholder-zinc-400 outline-none focus:border-black transition-colors"
                  />
                  <p className="text-[12px] text-zinc-400 truncate">“{sp.firstWords}”</p>
                </div>
              ))}
            </div>
          )}

          {/* Text area */}
          <div className="flex-1 border border-zinc-200 rounded-xl p-6 overflow-y-auto min-h-0">
            <div className="text-[14px] leading-[1.8] text-zinc-800 whitespace-pre-wrap select-text cursor-text">
              {named.map((p, i) => (
                <p key={i} className={i > 0 ? 'mt-[1.8em]' : ''}>
                  {p.name && <span className="font-semibold text-black">{p.name}: </span>}
                  {p.body}
                </p>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div
            className="flex gap-3 shrink-0"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              onClick={handleDownload}
              className="flex-1 h-10 border border-zinc-300 rounded-lg text-[13px] font-medium text-black hover:bg-zinc-50 transition-colors"
            >
              Download .txt
            </button>
            <button
              onClick={handleCopy}
              className="flex-1 h-10 bg-black text-white rounded-lg text-[13px] font-medium hover:bg-zinc-800 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy Text'}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
