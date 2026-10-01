import { useCallback, useEffect, useRef, useState } from 'react'

export type RecorderStatus = 'idle' | 'requesting' | 'recording'

// Chrome/Edge/Firefox record WebM/Opus, Safari records MP4/AAC; Whisper accepts both.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

function pickMimeType(): string | undefined {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

function describeMicrophoneError(err: unknown): string {
  switch (err instanceof DOMException ? err.name : '') {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Allow it in your browser’s site settings, then try again.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Connect one and try again.'
    case 'NotReadableError':
      return 'Your microphone is in use by another app.'
    default:
      return 'Could not start recording. Please try again.'
  }
}

interface Options {
  maxDurationMs: number
  onComplete: (file: File, durationSeconds: number) => void
}

export function useRecorder({ maxDurationMs, onComplete }: Options) {
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const busyRef = useRef(false)
  const discardRef = useRef(false)
  const unmountedRef = useRef(false)
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onCompleteRef.current = onComplete
  })

  const releaseDevices = useCallback(() => {
    window.clearInterval(timerRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    audioContextRef.current?.close().catch(() => {})
    audioContextRef.current = null
    setAnalyser(null)
  }, [])

  const start = useCallback(async () => {
    if (busyRef.current) return
    if (!isRecordingSupported()) {
      setError(
        window.isSecureContext
          ? 'Recording is not supported in this browser. Try uploading a file instead.'
          : 'Recording needs a secure connection (HTTPS or localhost).',
      )
      return
    }

    busyRef.current = true
    setError(null)
    setStatus('requesting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (err) {
      busyRef.current = false
      if (!unmountedRef.current) {
        setStatus('idle')
        setError(describeMicrophoneError(err))
      }
      return
    }
    if (unmountedRef.current) {
      // The component went away while the permission prompt was open.
      stream.getTracks().forEach((track) => track.stop())
      busyRef.current = false
      return
    }

    streamRef.current = stream
    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    const startedAt = performance.now()

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onerror = () => {
      discardRef.current = true
      setError('Recording failed. Please try again.')
    }
    recorder.onstop = () => {
      const durationSeconds = (performance.now() - startedAt) / 1000
      releaseDevices()
      recorderRef.current = null
      busyRef.current = false
      if (unmountedRef.current) return
      setStatus('idle')
      setElapsedMs(0)
      if (discardRef.current) return

      const type = recorder.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunks, { type })
      if (blob.size === 0) {
        setError('No audio was captured. Check your microphone and try again.')
        return
      }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      onCompleteRef.current(new File([blob], `recording-${stamp}.${extensionFor(type)}`, { type }), durationSeconds)
    }

    // A live input level for the UI; recording works without it.
    try {
      const context = new AudioContext()
      const node = context.createAnalyser()
      node.fftSize = 1024
      context.createMediaStreamSource(stream).connect(node)
      void context.resume()
      audioContextRef.current = context
      setAnalyser(node)
    } catch {
      // Ignore: the level meter is decorative.
    }

    discardRef.current = false
    recorderRef.current = recorder
    recorder.start(250)
    setElapsedMs(0)
    setStatus('recording')
    timerRef.current = window.setInterval(() => {
      const elapsed = performance.now() - startedAt
      setElapsedMs(elapsed)
      if (elapsed >= maxDurationMs && recorder.state === 'recording') recorder.stop()
    }, 200)
  }, [maxDurationMs, releaseDevices])

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }, [])

  const cancel = useCallback(() => {
    discardRef.current = true
    stop()
  }, [stop])

  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      discardRef.current = true
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      else releaseDevices()
    }
  }, [releaseDevices])

  return { status, elapsedMs, error, analyser, start, stop, cancel }
}
