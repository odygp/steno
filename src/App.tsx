import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload,
  Trash2,
  ArrowDownRight,
  Download,
  ChevronDown,
} from 'lucide-react'
import { StenoLogo, HolyLogo } from './logos'

// ── Types ──

declare global {
  interface Window {
    steno: {
      transcribe: (filePath: string, modelId: string, language: string) => Promise<{
        success: boolean
        text?: string
        error?: string
      }>
      cancelTranscription: () => Promise<void>
      getPathForFile: (file: File) => string
      onProgress: (
        cb: (data: { step: string; percent: number }) => void
      ) => () => void
      showOpenDialog: () => Promise<string | null>
      openTranscriptionWindow: (text: string, fileName: string) => Promise<void>
      onTranscriptData: (
        cb: (data: { text: string; fileName: string }) => void
      ) => () => void
      closeWindow: () => Promise<void>
      saveTranscript: (text: string, fileName: string) => Promise<boolean>
      getModels: () => Promise<
        Array<{
          id: string
          name: string
          description: string
          size: string
          status: 'not-downloaded' | 'downloading' | 'downloaded'
        }>
      >
      downloadModel: (modelId: string) => Promise<{ success: boolean }>
      deleteModel: (modelId: string) => Promise<{ success: boolean }>
      isOnboardingComplete: () => Promise<boolean>
      setOnboardingComplete: () => Promise<void>
      onModelDownloadProgress: (
        cb: (data: { modelId: string; percent: number }) => void
      ) => () => void
    }
  }
}

type ModelInfo = {
  id: string
  name: string
  description: string
  size: string
  status: string
}

type Tab = 'actions' | 'models' | 'about'
type ActionState = 'idle' | 'dragover' | 'file-ready' | 'processing' | 'error'
type AppPhase = 'loading' | 'onboarding' | 'splash' | 'main'

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.3 },
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}b`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}kb`
  return `${(bytes / (1024 * 1024)).toFixed(1)}mb`
}

// ── Main App ──

export default function App() {
  const [phase, setPhase] = useState<AppPhase>('loading')
  const [tab, setTab] = useState<Tab>('actions')
  const [actionState, setActionState] = useState<ActionState>('idle')
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState('')
  const [fileExt, setFileExt] = useState('')
  const [filePath, setFilePath] = useState('')
  const [step, setStep] = useState('')
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState('')
  const [selectedModel, setSelectedModel] = useState<string>('small')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [selectedLanguage, setSelectedLanguage] = useState<string>('auto')
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({})

  const refreshModels = useCallback(async () => {
    const m = await window.steno.getModels()
    setModels(m)
  }, [])

  // Check onboarding on mount
  useEffect(() => {
    ;(async () => {
      const complete = await window.steno.isOnboardingComplete()
      if (complete) {
        setPhase('splash')
        setTimeout(() => setPhase('main'), 2500)
      } else {
        setPhase('onboarding')
      }
    })()
  }, [])

  // Load models on mount
  useEffect(() => {
    refreshModels()
  }, [refreshModels])

  // Listen for download progress
  useEffect(() => {
    return window.steno.onModelDownloadProgress(({ modelId, percent }) => {
      setDownloadProgress((prev) => ({ ...prev, [modelId]: percent }))
    })
  }, [])

  useEffect(() => {
    return window.steno.onProgress(({ step, percent }) => {
      setStep(step)
      setPercent(percent)
    })
  }, [])

  const handleDownloadModel = useCallback(
    async (modelId: string) => {
      setDownloadProgress((prev) => ({ ...prev, [modelId]: 0 }))
      await window.steno.downloadModel(modelId)
      setDownloadProgress((prev) => {
        const next = { ...prev }
        delete next[modelId]
        return next
      })
      refreshModels()
    },
    [refreshModels]
  )

  const handleDeleteModel = useCallback(
    async (modelId: string) => {
      await window.steno.deleteModel(modelId)
      refreshModels()
    },
    [refreshModels]
  )

  const handleOnboardingComplete = useCallback(async () => {
    await window.steno.setOnboardingComplete()
    setPhase('main')
  }, [])

  const acceptFile = useCallback((file: File) => {
    const path = window.steno.getPathForFile(file)
    setFilePath(path)
    setFileName(file.name)
    setFileSize(formatSize(file.size))
    setFileExt(file.name.split('.').pop()?.toLowerCase() || '')
    setActionState('file-ready')
  }, [])

  const acceptFileFromDialog = useCallback(
    async (dialogPath: string) => {
      const name = dialogPath.split('/').pop() || ''
      setFilePath(dialogPath)
      setFileName(name)
      setFileSize('')
      setFileExt(name.split('.').pop()?.toLowerCase() || '')
      setActionState('file-ready')
    },
    []
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) acceptFile(file)
    },
    [acceptFile]
  )

  const handleClick = useCallback(async () => {
    const path = await window.steno.showOpenDialog()
    if (path) acceptFileFromDialog(path)
  }, [acceptFileFromDialog])

  const handleRemoveFile = useCallback(() => {
    setActionState('idle')
    setFilePath('')
    setFileName('')
    setFileSize('')
    setFileExt('')
  }, [])

  const handleTranscribe = useCallback(async () => {
    // If selected model is not downloaded, switch to models tab
    const model = models.find((m) => m.id === selectedModel)
    if (!model || model.status !== 'downloaded') {
      setTab('models')
      return
    }

    setActionState('processing')
    setStep('Preparing audio…')
    setPercent(0)
    setError('')

    const result = await window.steno.transcribe(filePath, selectedModel, selectedLanguage)

    if (result.success) {
      await window.steno.openTranscriptionWindow(result.text!, fileName)
      setActionState('idle')
      setFilePath('')
      setFileName('')
      setFileSize('')
      setFileExt('')
    } else if (result.error === 'cancelled') {
      setActionState('file-ready')
    } else {
      setError(result.error || 'Unknown error')
      setActionState('error')
    }
  }, [filePath, fileName, selectedModel, selectedLanguage, models])

  const handleCancelTranscription = useCallback(async () => {
    await window.steno.cancelTranscription()
  }, [])

  const handleUploadOther = useCallback(() => {
    setActionState('idle')
    setError('')
    setFilePath('')
    setFileName('')
  }, [])

  // ── Render ──

  return (
    <div className="h-screen w-screen bg-zinc-950 text-white flex flex-col overflow-hidden select-none font-sans rounded-[24px]">
      <AnimatePresence mode="wait">
        {phase === 'loading' ? (
          <motion.div key="loading" {...fade} className="flex-1" />
        ) : phase === 'onboarding' ? (
          <WelcomeScreen
            key="onboarding"
            models={models}
            downloadProgress={downloadProgress}
            onDownload={handleDownloadModel}
            onComplete={handleOnboardingComplete}
          />
        ) : phase === 'splash' ? (
          <SplashScreen key="splash" />
        ) : actionState === 'processing' ? (
          <ProcessingScreen
            key="processing"
            step={step}
            percent={percent}
            fileName={fileName}
            onCancel={handleCancelTranscription}
          />
        ) : (
          <motion.div key="main" {...fade} className="flex flex-col h-full">
            {/* ── Tab bar ── */}
            <div
              className="pt-4 pr-4 shrink-0"
              style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            >
              <div
                className="flex items-center gap-0 pl-[78px]"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              >
                <button
                  onClick={() => setTab('actions')}
                  className={`px-3 py-1 text-[13px] rounded-md transition-colors ${
                    tab === 'actions'
                      ? 'border border-zinc-700 text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Actions
                </button>
                <button
                  onClick={() => setTab('models')}
                  className={`px-3 py-1 text-[13px] rounded-md transition-colors ${
                    tab === 'models'
                      ? 'border border-zinc-700 text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  Models
                </button>
                <button
                  onClick={() => setTab('about')}
                  className={`px-3 py-1 text-[13px] rounded-md transition-colors ${
                    tab === 'about'
                      ? 'border border-zinc-700 text-white'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  About
                </button>
              </div>
            </div>

            {/* ── Content ── */}
            <div className="flex-1 flex flex-col p-4 pt-3">
              <AnimatePresence mode="wait">
                {tab === 'actions' ? (
                  <motion.div key="actions" {...fade} className="flex flex-col flex-1">
                    {actionState === 'idle' || actionState === 'dragover' ? (
                      <DropZone
                        isDragOver={actionState === 'dragover'}
                        onDragOver={() => setActionState('dragover')}
                        onDragLeave={() => setActionState('idle')}
                        onDrop={handleDrop}
                        onClick={handleClick}
                      />
                    ) : actionState === 'file-ready' ? (
                      <FileReadyView
                        fileName={fileName}
                        fileSize={fileSize}
                        fileExt={fileExt}
                        onRemove={handleRemoveFile}
                        onTranscribe={handleTranscribe}
                        models={models}
                        selectedModel={selectedModel}
                        onSelectModel={setSelectedModel}
                        onSwitchToModels={() => setTab('models')}
                        selectedLanguage={selectedLanguage}
                        onSelectLanguage={setSelectedLanguage}
                      />
                    ) : actionState === 'error' ? (
                      <ErrorView
                        fileName={fileName}
                        fileSize={fileSize}
                        fileExt={fileExt}
                        error={error}
                        onUploadOther={handleUploadOther}
                      />
                    ) : null}
                  </motion.div>
                ) : tab === 'models' ? (
                  <motion.div key="models" {...fade} className="flex-1">
                    <ModelsTab
                      models={models}
                      downloadProgress={downloadProgress}
                      onDownload={handleDownloadModel}
                      onDelete={handleDeleteModel}
                    />
                  </motion.div>
                ) : (
                  <motion.div key="about" {...fade} className="flex-1">
                    <AboutTab />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Welcome Screen (Onboarding) ──

function WelcomeScreen({
  models,
  downloadProgress,
  onDownload,
  onComplete,
}: {
  models: ModelInfo[]
  downloadProgress: Record<string, number>
  onDownload: (modelId: string) => void
  onComplete: () => void
}) {
  const hasDownloaded = models.some((m) => m.status === 'downloaded')

  return (
    <motion.div {...fade} className="flex flex-col h-full relative">
      <div
        className="absolute top-0 left-0 right-0 h-12 z-10"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="flex-1 overflow-y-auto px-6 pt-16 pb-24">
        <div className="flex flex-col items-center">
          <h1 className="text-[16px] text-white font-medium">Welcome to steno.</h1>
          <p className="text-[14px] text-white/50 mt-2">Download the models you need:</p>

          <div className="flex flex-col gap-3 mt-6 w-full">
            {models.map((model) => {
              const isDownloading = model.id in downloadProgress
              return (
                <div
                  key={model.id}
                  className="border border-white/10 rounded-lg p-5 w-full"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-[18px] text-white font-bold">{model.name}</p>
                      <p className="text-[14px] text-white/80 mt-1">{model.description}</p>
                    </div>
                    <p className="text-[14px] text-white/60 shrink-0 ml-4">{model.size}</p>
                  </div>
                  <div className="mt-4">
                    {isDownloading ? (
                      <div className="h-5 rounded-full bg-white/15 overflow-hidden">
                        <motion.div
                          className="h-full bg-white rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${downloadProgress[model.id]}%` }}
                          transition={{ duration: 0.3, ease: 'easeOut' }}
                        />
                      </div>
                    ) : model.status === 'downloaded' ? (
                      <div className="h-10 rounded-full bg-white/5 flex items-center justify-center opacity-50">
                        <span className="text-base text-white">Downloaded</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => onDownload(model.id)}
                        className="w-full h-10 rounded-full bg-white/15 text-white text-base hover:bg-white/25 transition-colors"
                      >
                        Download
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Bottom gradient overlay with Continue button */}
      <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 pt-12 bg-gradient-to-t from-zinc-950 via-zinc-950/90 to-transparent backdrop-blur-sm">
        <button
          onClick={onComplete}
          disabled={!hasDownloaded}
          className={`w-full h-8 rounded-lg text-[13px] font-semibold transition-colors ${
            hasDownloaded
              ? 'bg-white text-black hover:bg-zinc-200'
              : 'bg-white/20 text-white/40 cursor-not-allowed'
          }`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          Continue
        </button>
      </div>
    </motion.div>
  )
}

// ── Splash Screen ──

function SplashScreen() {
  return (
    <motion.div {...fade} className="flex flex-col h-full">
      <div
        className="absolute top-0 left-0 right-0 h-12"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="flex-1 flex flex-col items-center justify-center">
        <StenoLogo className="w-[88px] text-white" />
        <span className="text-[13px] text-zinc-600 mt-2">v1.0.0</span>
      </div>
      <div className="h-12 flex items-center justify-center shrink-0">
        <HolyLogo className="w-[70px] text-zinc-500" />
      </div>
    </motion.div>
  )
}

// ── Drop Zone ──

function DropZone({
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
}: {
  isDragOver: boolean
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onClick: () => void
}) {
  const formats = ['mp3', 'wav', 'm4a', 'mp4', 'mov']

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onClick}
      className={`
        flex-1 rounded-xl border-[1.5px] border-dashed cursor-pointer
        flex flex-col items-center justify-center gap-4
        transition-all duration-200
        ${
          isDragOver
            ? 'border-zinc-500 bg-white/[0.03]'
            : 'border-zinc-800 hover:border-zinc-700'
        }
      `}
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <AnimatePresence mode="wait">
        {isDragOver ? (
          <motion.p
            key="dragover"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="text-[14px] text-zinc-300"
          >
            Yeah! That's the right spot
          </motion.p>
        ) : (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center">
              <Upload className="w-[18px] h-[18px] text-zinc-400" />
            </div>
            <p className="text-[14px] text-zinc-300">Drag & Drop a file</p>
            <div className="flex items-center gap-1.5">
              {formats.map((f) => (
                <span
                  key={f}
                  className="px-2 py-0.5 text-[11px] text-zinc-500 border border-zinc-800 rounded"
                >
                  {f}
                </span>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── File Ready View ──

// ── Whisper supported languages ──

const WHISPER_LANGUAGES: { code: string; name: string }[] = [
  { code: 'auto', name: 'Auto' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hy', name: 'Armenian' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'be', name: 'Belarusian' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'bg', name: 'Bulgarian' },
  { code: 'ca', name: 'Catalan' },
  { code: 'zh', name: 'Chinese' },
  { code: 'hr', name: 'Croatian' },
  { code: 'cs', name: 'Czech' },
  { code: 'da', name: 'Danish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'en', name: 'English' },
  { code: 'et', name: 'Estonian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'fr', name: 'French' },
  { code: 'gl', name: 'Galician' },
  { code: 'de', name: 'German' },
  { code: 'el', name: 'Greek' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'is', name: 'Icelandic' },
  { code: 'id', name: 'Indonesian' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'kn', name: 'Kannada' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'ko', name: 'Korean' },
  { code: 'lv', name: 'Latvian' },
  { code: 'lt', name: 'Lithuanian' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'ms', name: 'Malay' },
  { code: 'mr', name: 'Marathi' },
  { code: 'mi', name: 'Maori' },
  { code: 'ne', name: 'Nepali' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fa', name: 'Persian' },
  { code: 'pl', name: 'Polish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ro', name: 'Romanian' },
  { code: 'ru', name: 'Russian' },
  { code: 'sr', name: 'Serbian' },
  { code: 'sk', name: 'Slovak' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'es', name: 'Spanish' },
  { code: 'sw', name: 'Swahili' },
  { code: 'sv', name: 'Swedish' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'ta', name: 'Tamil' },
  { code: 'th', name: 'Thai' },
  { code: 'tr', name: 'Turkish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ur', name: 'Urdu' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'cy', name: 'Welsh' },
]

function FileReadyView({
  fileName,
  fileSize,
  fileExt,
  onRemove,
  onTranscribe,
  models,
  selectedModel,
  onSelectModel,
  onSwitchToModels,
  selectedLanguage,
  onSelectLanguage,
}: {
  fileName: string
  fileSize: string
  fileExt: string
  onRemove: () => void
  onTranscribe: () => void
  models: ModelInfo[]
  selectedModel: string
  onSelectModel: (id: string) => void
  onSwitchToModels: () => void
  selectedLanguage: string
  onSelectLanguage: (lang: string) => void
}) {
  const [langDropdownOpen, setLangDropdownOpen] = useState(false)
  const [langSearch, setLangSearch] = useState('')
  const selectedLangName = WHISPER_LANGUAGES.find((l) => l.code === selectedLanguage)?.name || 'Auto'
  const filteredLanguages = langSearch
    ? WHISPER_LANGUAGES.filter((l) => l.name.toLowerCase().startsWith(langSearch.toLowerCase()))
    : WHISPER_LANGUAGES

  return (
    <div className="flex flex-col flex-1 relative">
      <FileCard
        fileName={fileName}
        fileSize={fileSize}
        fileExt={fileExt}
        onRemove={onRemove}
      />

      <div className="flex flex-col gap-3 mt-6">
        {/* Model Selector Container */}
        <div className="bg-[#161616] border border-zinc-700 rounded-lg p-3">
          <p className="text-[11px] text-zinc-500 mb-3">Select Model</p>
          <div className="flex gap-2">
            {models.map((model) => {
              const isSelected = model.id === selectedModel
              const isDownloaded = model.status === 'downloaded'
              return (
                <button
                  key={model.id}
                  onClick={() => {
                    if (!isDownloaded) {
                      onSwitchToModels()
                    } else {
                      onSelectModel(model.id)
                    }
                  }}
                  className={`flex-1 h-[33px] rounded-lg text-sm text-center flex items-center justify-center gap-1.5 transition-colors ${
                    isSelected && isDownloaded
                      ? 'bg-[#1e1e1e] border border-white text-white'
                      : 'bg-[#161616] border border-zinc-700 text-zinc-500'
                  }`}
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                  {!isDownloaded && <Download className="w-4 h-4 opacity-50" />}
                  {model.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* Language Selector Container */}
        <div className="bg-[#161616] border border-zinc-700 rounded-lg p-3">
          <p className="text-[11px] text-zinc-500 mb-2">Select Language</p>
          <div className="relative">
            <button
              onClick={() => setLangDropdownOpen(!langDropdownOpen)}
              className="w-full h-[33px] bg-[#1e1e1e] border border-zinc-700 rounded-lg px-3 flex items-center justify-between text-[12px] text-white transition-colors hover:border-zinc-500"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              {selectedLangName}
              <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
            </button>
            {langDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => { setLangDropdownOpen(false); setLangSearch('') }}
                />
                <div className="absolute top-[37px] left-0 right-0 z-20 bg-[#1e1e1e] border border-zinc-700 rounded-lg shadow-lg overflow-hidden">
                  <div className="p-2 border-b border-zinc-700">
                    <input
                      autoFocus
                      type="text"
                      value={langSearch}
                      onChange={(e) => setLangSearch(e.target.value)}
                      placeholder="Search language..."
                      className="w-full bg-transparent text-[12px] text-white placeholder-zinc-500 outline-none"
                    />
                  </div>
                  <div className="max-h-[170px] overflow-y-auto">
                    {filteredLanguages.map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          onSelectLanguage(lang.code)
                          setLangDropdownOpen(false)
                          setLangSearch('')
                        }}
                        className={`w-full px-3 py-2 text-left text-[12px] hover:bg-white/10 transition-colors ${
                          lang.code === selectedLanguage ? 'text-white' : 'text-zinc-400'
                        }`}
                      >
                        {lang.name}
                      </button>
                    ))}
                    {filteredLanguages.length === 0 && (
                      <p className="px-3 py-2 text-[12px] text-zinc-500">No results</p>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1" />
      <button
        onClick={onTranscribe}
        className="w-full h-8 bg-white text-black text-[13px] font-semibold rounded-lg hover:bg-zinc-200 transition-colors"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        Transcribe
      </button>
    </div>
  )
}

// ── Error View ──

function ErrorView({
  fileName,
  fileSize,
  fileExt,
  error,
  onUploadOther,
}: {
  fileName: string
  fileSize: string
  fileExt: string
  error: string
  onUploadOther: () => void
}) {
  return (
    <div className="flex flex-col flex-1">
      <FileCard fileName={fileName} fileSize={fileSize} fileExt={fileExt} />
      <p className="text-[13px] text-red-400 mt-3 leading-relaxed">{error}</p>
      <div className="flex-1" />
      <button
        onClick={onUploadOther}
        className="w-full h-8 bg-white text-black text-[13px] font-medium rounded-md hover:bg-zinc-200 transition-colors"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        Upload other file
      </button>
    </div>
  )
}

// ── File Card ──

function FileCard({
  fileName,
  fileSize,
  fileExt,
  onRemove,
}: {
  fileName: string
  fileSize: string
  fileExt: string
  onRemove?: () => void
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border border-zinc-800 bg-zinc-900/50">
      {/* Extension badge */}
      <div className="w-11 h-11 rounded-lg bg-zinc-800 flex items-center justify-center shrink-0">
        <span className="text-[11px] text-zinc-300 font-medium">{fileExt}</span>
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-white font-medium truncate">{fileName}</p>
        {fileSize && (
          <p className="text-[12px] text-zinc-500 mt-0.5">Size: {fileSize}</p>
        )}
      </div>
      {/* Delete */}
      {onRemove && (
        <button
          onClick={onRemove}
          className="p-2 text-zinc-600 hover:text-zinc-300 transition-colors shrink-0"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

// ── Processing Screen ──

function ProcessingScreen({
  step,
  percent,
  fileName,
  onCancel,
}: {
  step: string
  percent: number
  fileName: string
  onCancel: () => void
}) {
  return (
    <motion.div {...fade} className="flex flex-col h-full items-center justify-center px-10 relative">
      {/* Drag region */}
      <div
        className="absolute top-0 left-0 right-0 h-12"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />

      {/* Center content */}
      <div className="flex flex-col items-center gap-8">
        {/* Pulsing dot + step label */}
        <div className="flex flex-col items-center gap-[25px]">
          <motion.div
            className="w-3 h-3 rounded-full bg-white"
            animate={{
              opacity: [0.15, 1, 0.15],
              scale: [0.8, 1, 0.8],
            }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          />
          <AnimatePresence mode="wait">
            <motion.p
              key={step}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="text-[16px] text-white text-center"
            >
              {step}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Progress bar */}
        <div className="w-full h-4 bg-white/15 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-white rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* File name + percentage */}
      <div className="flex flex-col items-center gap-1 mt-8">
        <p className="text-[12px] text-white/50 text-center truncate max-w-[280px]">
          {fileName}
        </p>
        <p className="text-[12px] text-white/50 text-center">
          {percent}%
        </p>
      </div>

      {/* Cancel button — pinned to bottom */}
      <div
        className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-zinc-950/40 to-transparent backdrop-blur-[2px]"
      >
        <button
          onClick={onCancel}
          className="w-full h-8 rounded-lg border border-white/10 text-[13px] font-semibold text-white/50 hover:text-white/80 hover:border-white/20 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          Cancel Transcription
        </button>
      </div>
    </motion.div>
  )
}

// ── Models Tab ──

function ModelsTab({
  models,
  downloadProgress,
  onDownload,
  onDelete,
}: {
  models: ModelInfo[]
  downloadProgress: Record<string, number>
  onDownload: (modelId: string) => void
  onDelete: (modelId: string) => void
}) {
  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto">
      {models.map((model) => {
        const isDownloading = model.id in downloadProgress
        return (
          <div
            key={model.id}
            className="border border-white/10 rounded-lg p-5 w-full"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[18px] text-white font-bold">{model.name}</p>
                <p className="text-[14px] text-white/80 mt-1">{model.description}</p>
              </div>
              <p className="text-[14px] text-white/60 shrink-0 ml-4">{model.size}</p>
            </div>
            <div className="mt-4">
              {isDownloading ? (
                <div className="h-5 rounded-full bg-white/15 overflow-hidden">
                  <motion.div
                    className="h-full bg-white rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${downloadProgress[model.id]}%` }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                  />
                </div>
              ) : model.status === 'downloaded' ? (
                <div className="flex gap-2">
                  <div className="flex-1 h-10 rounded-full bg-white/5 flex items-center justify-center opacity-50">
                    <span className="text-base text-white">Downloaded</span>
                  </div>
                  <button
                    onClick={() => onDelete(model.id)}
                    className="flex-1 h-10 rounded-full bg-white/15 text-base text-white hover:bg-white/25 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => onDownload(model.id)}
                  className="w-full h-10 rounded-full bg-white/15 text-white text-base hover:bg-white/25 transition-colors"
                >
                  Download
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── About Tab ──

function AboutTab() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {/* About */}
        <div className="border-b border-zinc-800 pb-3 mb-3">
          <h3 className="text-[13px] font-semibold text-white">About</h3>
          <p className="text-[12px] text-zinc-400 leading-relaxed mt-1.5">
            <strong className="text-zinc-300">Steno</strong> processes audio and video files locally
            to generate highly accurate text transcriptions. It auto-detects the spoken language or lets
            you pick one manually. Built on the Whisper AI model and optimized for Apple Silicon, it runs
            entirely offline to ensure complete privacy, zero API costs, and instant extraction without
            upload delays.
          </p>
        </div>

        {/* Quick Tips */}
        <div className="border-b border-zinc-800 pb-3 mb-3">
          <h3 className="text-[13px] font-semibold text-white">Quick Tips</h3>
          <ul className="mt-1.5 space-y-2 text-[12px] text-zinc-400 leading-relaxed list-disc pl-4">
            <li>
              <strong className="text-zinc-300">File Types:</strong> Simply drag and drop .mp3, .wav,
              .m4a, .mp4, or .mov files directly into the window.
            </li>
            <li>
              <strong className="text-zinc-300">Video Handling:</strong> There is no need to export
              audio first; Steno automatically extracts the audio track from video files before
              transcribing.
            </li>
            <li>
              <strong className="text-zinc-300">Privacy:</strong> All processing happens locally on
              your Mac's Neural Engine. Your files are never uploaded to the cloud.
            </li>
            <li>
              <strong className="text-zinc-300">Exporting:</strong> Once transcription is complete,
              use the action buttons to instantly copy the text to your clipboard or download it as a
              raw .txt file.
            </li>
          </ul>
        </div>

        {/* Version */}
        <div className="border-b border-zinc-800 pb-3 mb-3">
          <h3 className="text-[13px] font-semibold text-white">Version</h3>
          <p className="text-[12px] text-zinc-400 mt-1.5">Steno v1.0.0</p>
          <a
            href="mailto:odysseas@holy.gd"
            className="text-[12px] text-zinc-400 underline underline-offset-2 hover:text-white transition-colors"
          >
            Report a bug or Suggest a Feature
          </a>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 shrink-0">
        <HolyLogo className="w-[70px] text-zinc-500" />
        <a
          href="https://holy.gd"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-white transition-colors border border-zinc-800 rounded-full px-2.5 py-1"
        >
          <ArrowDownRight className="w-3 h-3" />
          visit holy.gd
        </a>
      </div>
    </div>
  )
}
