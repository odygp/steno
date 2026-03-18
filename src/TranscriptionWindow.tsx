import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

export default function TranscriptionWindow() {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    return window.steno.onTranscriptData(({ text, fileName }) => {
      setText(text)
      setFileName(fileName)
    })
  }, [])

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  const handleDownload = useCallback(async () => {
    await window.steno.saveTranscript(text, fileName)
  }, [text, fileName])

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
          {/* Text area */}
          <div className="flex-1 border border-zinc-200 rounded-xl p-6 overflow-y-auto min-h-0">
            <p className="text-[14px] leading-[1.8] text-zinc-800 whitespace-pre-wrap">
              {text}
            </p>
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
