import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react'
import { LoaderCircle, Mic, Square, Upload } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { isRecordingSupported, useRecorder } from '../hooks/useRecorder'
import { ACCEPT_ATTRIBUTE, validateAudioFile } from '../lib/audio'
import { formatBytes, formatDuration } from '../lib/format'
import { Alert } from './ui'

interface Props {
  /** Index of the selected tab (0 = record, 1 = upload). */
  mode: number
  onModeChange: (mode: number) => void
  maxUploadBytes: number
  maxRecordingSeconds: number
  onAudio: (file: File, origin: 'upload' | 'recording', durationSeconds: number | null) => void
  /**
   * The loaded clip (player, detection status). While one is shown, the record and
   * upload controls shrink to "replace" actions so both stay one tap away.
   */
  clip?: ReactNode
}

const MODES = [
  { label: 'Record', icon: Mic },
  { label: 'Upload', icon: Upload },
] as const

export function AudioInput({ mode, onModeChange, maxUploadBytes, maxRecordingSeconds, onAudio, clip }: Props) {
  const recorder = useRecorder({
    maxDurationMs: maxRecordingSeconds * 1000,
    onComplete: (file, seconds) => onAudio(file, 'recording', seconds),
  })
  const busy = recorder.status !== 'idle'
  const recording = recorder.status === 'recording'
  const hasClip = clip != null

  return (
    <TabGroup selectedIndex={mode} onChange={onModeChange}>
      <TabList className="grid grid-cols-2 gap-1 rounded-full bg-white/70 p-1 ring-1 ring-white">
        {MODES.map(({ label, icon: Icon }) => (
          <Tab
            key={label}
            disabled={busy}
            className="flex h-10 items-center justify-center gap-2 rounded-full text-sm font-semibold text-ink-500 transition outline-none hover:text-ink-900 data-disabled:cursor-not-allowed data-disabled:opacity-50 data-focus:ring-2 data-focus:ring-brand-300 data-selected:bg-white data-selected:text-ink-900 data-selected:shadow-sm"
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Tab>
        ))}
      </TabList>
      <TabPanels className="mt-3">
        <TabPanel className="outline-none">
          <RecorderPanel recorder={recorder} maxSeconds={maxRecordingSeconds} compact={hasClip && !recording} />
        </TabPanel>
        <TabPanel className="outline-none">
          <DropZone maxBytes={maxUploadBytes} compact={hasClip} onFile={(file) => onAudio(file, 'upload', null)} />
        </TabPanel>
      </TabPanels>
      {/* Hidden while recording so the new take has the user's full attention. */}
      {hasClip && !recording && <div className="mt-3 flex flex-col gap-3">{clip}</div>}
    </TabGroup>
  )
}

function RecorderPanel({
  recorder,
  maxSeconds,
  compact,
}: {
  recorder: ReturnType<typeof useRecorder>
  maxSeconds: number
  compact: boolean
}) {
  const { status, elapsedMs, error, analyser, start, stop, cancel } = recorder
  const recording = status === 'recording'
  const supported = isRecordingSupported()

  if (compact) {
    return (
      <div>
        <button
          type="button"
          onClick={start}
          disabled={status === 'requesting' || !supported}
          className={`${COMPACT_ROW} border-transparent bg-white/50 hover:bg-white/80`}
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-linear-to-b from-brand-400 to-brand-600 text-white shadow-glow">
            {status === 'requesting' ? (
              <LoaderCircle className="size-5 animate-spin" aria-hidden />
            ) : (
              <Mic className="size-5" aria-hidden />
            )}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold text-ink-900">
              {status === 'requesting' ? 'Waiting for microphone permission…' : 'Record a new clip'}
            </span>
            <span className="block text-sm text-ink-500">
              {supported ? 'Replaces the current audio' : 'Recording isn’t available in this browser'}
            </span>
          </span>
        </button>
        {error && <Alert className="mt-3">{error}</Alert>}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl bg-white/50 px-4 py-7 ring-1 ring-white">
      <div className="relative grid size-28 place-items-center">
        {recording && (
          <>
            <LevelHalo analyser={analyser} />
            <span className="absolute inset-2 rounded-full bg-brand-400/25 motion-safe:animate-pulse-ring" aria-hidden />
          </>
        )}
        <button
          type="button"
          onClick={recording ? stop : start}
          disabled={status === 'requesting'}
          aria-label={recording ? 'Stop recording' : 'Start recording'}
          className="relative grid size-20 place-items-center rounded-full bg-linear-to-b from-brand-400 to-brand-600 text-white shadow-glow transition hover:brightness-105 focus-visible:ring-4 focus-visible:ring-brand-300 focus-visible:outline-none active:scale-95 disabled:cursor-wait disabled:opacity-70"
        >
          {status === 'requesting' ? (
            <LoaderCircle className="size-8 animate-spin" aria-hidden />
          ) : recording ? (
            <Square className="size-7 fill-current" aria-hidden />
          ) : (
            <Mic className="size-8" aria-hidden />
          )}
        </button>
      </div>

      {recording ? (
        <div className="text-center">
          <p role="timer" className="text-2xl font-bold text-ink-900 tabular-nums">
            {formatDuration(elapsedMs / 1000)}
            <span className="text-base font-semibold text-ink-400"> / {formatDuration(maxSeconds)}</span>
          </p>
          <p className="mt-1 flex items-center justify-center gap-1.5 text-sm text-ink-500">
            <span className="size-2 rounded-full bg-red-500 motion-safe:animate-pulse" aria-hidden />
            Recording · tap the button to finish
          </p>
          <button
            type="button"
            onClick={cancel}
            className="mt-3 rounded-full px-3 py-1 text-sm font-semibold text-ink-500 transition hover:bg-white hover:text-ink-900"
          >
            Discard recording
          </button>
        </div>
      ) : (
        <div className="text-center">
          <p className="font-semibold text-ink-900">
            {status === 'requesting' ? 'Waiting for microphone permission…' : 'Tap to start speaking'}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {supported
              ? `Speak in any language · up to ${Math.round(maxSeconds / 60)} minutes`
              : 'Recording isn’t available in this browser. Upload a file instead.'}
          </p>
        </div>
      )}

      {error && <Alert className="w-full">{error}</Alert>}
    </div>
  )
}

/** A soft ring that grows with the microphone input level. */
function LevelHalo({ analyser }: { analyser: AnalyserNode | null }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!analyser) return
    const samples = new Uint8Array(analyser.fftSize)
    let frame = 0
    const tick = () => {
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) {
        const value = (sample - 128) / 128
        sum += value * value
      }
      const level = Math.min(1, Math.sqrt(sum / samples.length) * 5)
      ref.current?.style.setProperty('--level', level.toFixed(3))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [analyser])

  return (
    <span
      ref={ref}
      aria-hidden
      className="absolute inset-1 rounded-full bg-brand-300/40 transition-transform duration-100"
      style={{ transform: 'scale(calc(1 + var(--level, 0) * 0.45))' }}
    />
  )
}

const COMPACT_ROW =
  'flex w-full items-center gap-3.5 rounded-3xl border-2 p-3 pr-4 text-left ring-1 ring-white transition focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-70'

function DropZone({ maxBytes, compact, onFile }: { maxBytes: number; compact: boolean; onFile: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Stop the browser from opening files dropped just outside the zone.
  useEffect(() => {
    const prevent = (event: DragEvent) => event.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  const accept = (file: File | undefined) => {
    if (!file) return
    const problem = validateAudioFile(file, maxBytes)
    setError(problem)
    if (!problem) onFile(file)
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          accept(event.dataTransfer.files[0])
        }}
        className={`[&_*]:pointer-events-none ${
          compact
            ? `${COMPACT_ROW} border-dashed`
            : 'flex w-full flex-col items-center gap-3 rounded-3xl border-2 border-dashed px-6 py-8 text-center transition focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none'
        } ${dragging ? 'border-brand-400 bg-brand-50' : 'border-brand-200 bg-white/50 hover:border-brand-300 hover:bg-white/80'}`}
      >
        {compact ? (
          <>
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-brand-500 shadow-sm">
              <Upload className="size-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink-900">Upload a different file</span>
              <span className="block text-sm text-ink-500">Drop it here or browse · up to {formatBytes(maxBytes)}</span>
            </span>
          </>
        ) : (
          <>
            <span className="grid size-14 place-items-center rounded-2xl bg-white text-brand-500 shadow-sm">
              <Upload className="size-6" aria-hidden />
            </span>
            <span className="font-semibold text-ink-900">
              Drop an audio file or{' '}
              <span className="text-brand-600 underline decoration-brand-300 underline-offset-4">browse</span>
            </span>
            <span className="text-sm text-ink-500">MP3, WAV, M4A, WEBM, OGG or FLAC · up to {formatBytes(maxBytes)}</span>
          </>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        aria-label="Audio file"
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          accept(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {error && <Alert className="mt-3">{error}</Alert>}
    </div>
  )
}
