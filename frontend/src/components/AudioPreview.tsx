import { FileAudio, Mic, Pause, Play, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { formatBytes, formatDuration } from '../lib/format'
import type { AudioClip } from '../types'

interface Props {
  clip: AudioClip
  onRemove: () => void
}

/** Compact player for the clip being translated. Mount with `key={clip.id}`. */
export function AudioPreview({ clip, onRemove }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState<number | null>(clip.durationHint)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    let probing = false

    const syncDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration)
    }
    const onLoadedMetadata = () => {
      syncDuration()
      // Chrome's MediaRecorder output reports an infinite duration until the file has been
      // scanned once; seeking far past the end forces the browser to work it out.
      if (audio.duration === Infinity) {
        probing = true
        audio.currentTime = Number.MAX_SAFE_INTEGER
      }
    }
    const onTimeUpdate = () => {
      if (probing) {
        probing = false
        audio.currentTime = 0
        syncDuration()
        return
      }
      setPosition(audio.currentTime)
    }
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('durationchange', syncDuration)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onPause)
    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('durationchange', syncDuration)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onPause)
    }
  }, [])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => setPlaying(false))
    else audio.pause()
  }

  const SourceIcon = clip.origin === 'recording' ? Mic : FileAudio
  const max = duration ?? 0

  return (
    <div className="rounded-3xl bg-white/80 p-4 shadow-sm ring-1 ring-white">
      <audio ref={audioRef} src={clip.url} preload="metadata" />
      <div className="flex items-center gap-3.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause audio' : 'Play audio'}
          className="grid size-12 shrink-0 place-items-center rounded-full bg-linear-to-b from-brand-400 to-brand-600 text-white shadow-glow transition hover:brightness-105 focus-visible:ring-4 focus-visible:ring-brand-300 focus-visible:outline-none active:scale-95"
        >
          {playing ? <Pause className="size-5 fill-current" /> : <Play className="ml-0.5 size-5 fill-current" />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <SourceIcon className="size-4 shrink-0 text-brand-500" aria-hidden />
            <p className="truncate text-sm font-semibold text-ink-900" title={clip.file.name}>
              {clip.file.name}
            </p>
          </div>
          <input
            type="range"
            min={0}
            max={max || 1}
            step={0.01}
            value={Math.min(position, max || 1)}
            disabled={!max}
            aria-label="Seek"
            onChange={(event) => {
              const audio = audioRef.current
              if (audio) audio.currentTime = Number(event.target.value)
            }}
            className="mt-2 h-1.5 w-full cursor-pointer accent-brand-500 disabled:cursor-default"
          />
          <div className="mt-1 flex justify-between text-xs text-ink-500 tabular-nums">
            <span className="whitespace-nowrap">
              {formatDuration(position)} / {formatDuration(duration)}
            </span>
            <span className="ml-3 truncate">
              <span className="max-[420px]:hidden">{clip.origin === 'recording' ? 'Recorded' : 'Uploaded'} · </span>
              {formatBytes(clip.file.size)}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove audio"
          title="Remove audio"
          className="grid size-10 shrink-0 place-items-center rounded-full text-ink-400 transition hover:bg-red-50 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-red-200 focus-visible:outline-none"
        >
          <Trash2 className="size-[18px]" />
        </button>
      </div>
    </div>
  )
}
