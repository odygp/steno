import { useState, useEffect } from 'react'
import { ArrowUpRight } from 'lucide-react'

// Floating always-on-top progress pill, shown while a transcription runs and
// the main window is in the background. Drag it anywhere; the arrow brings
// Steno back.
export default function Widget() {
  const [step, setStep] = useState('')
  const [percent, setPercent] = useState(0)
  const [fileName, setFileName] = useState('')

  useEffect(() => {
    // Progress events are sparse, so start from where the transcription is now
    window.steno.getWidgetState().then((s) => {
      setFileName(s.fileName)
      setStep(s.step)
      setPercent(s.percent)
    })
    return window.steno.onProgress(({ step, percent }) => {
      setStep(step)
      setPercent(percent)
    })
  }, [])

  return (
    <div className="h-screen w-screen p-2 select-none font-sans">
      <div
        className="w-full h-full rounded-2xl bg-zinc-950/95 border border-white/10 pl-4 pr-2 flex items-center gap-2"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[12px] text-white/80 truncate flex-1">{step || 'Starting…'}</span>
            <span className="text-[12px] text-white tabular-nums shrink-0">{percent}%</span>
          </div>
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="text-[11px] text-white/40 truncate">{fileName}</span>
        </div>
        <button
          onClick={() => window.steno.focusMain()}
          title="Open Steno"
          className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <ArrowUpRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
