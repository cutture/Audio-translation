import { ArrowRight, AudioLines, Clock, Globe, History, Languages, LoaderCircle, Mic, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { errorMessage, fetchConfig, isAbortError, transcribeAudio, translateText } from './api'
import { AppHeader } from './components/AppHeader'
import { AudioInput } from './components/AudioInput'
import { AudioPreview } from './components/AudioPreview'
import { HistoryDrawer } from './components/HistoryDrawer'
import { LanguagePicker } from './components/LanguagePicker'
import { ResultCard } from './components/ResultCard'
import { StatTiles } from './components/StatTiles'
import { TranslationActions, entryActions } from './components/TranslationActions'
import { UserMenu } from './components/UserMenu'
import { Alert, Card, CardHeader, LogoMark, RetryButton } from './components/ui'
import { formatDuration, greeting } from './lib/format'
import { createInitialState, reducer, type Async } from './state'
import { useHistory } from './hooks/useHistory'
import type { AppConfig, AudioClip, HistoryEntry, Transcription, User } from './types'

const TARGET_STORAGE_KEY = 'audio-translator:target-language'

function newId(): string {
  // randomUUID needs a secure context; plain-HTTP network hosts fall back.
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function readStoredTarget(): string | null {
  try {
    return localStorage.getItem(TARGET_STORAGE_KEY)
  } catch {
    return null
  }
}

export default function App({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [configAttempt, setConfigAttempt] = useState(0)
  const [inputMode, setInputMode] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const history = useHistory()
  const [state, dispatch] = useReducer(reducer, null, () => createInitialState(readStoredTarget()))
  const nextClipId = useRef(1)
  const detectRequest = useRef<AbortController | null>(null)
  const translateRequest = useRef<AbortController | null>(null)
  const resultRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    setConfigError(null)
    fetchConfig(controller.signal)
      .then(setConfig)
      .catch((err) => {
        if (!isAbortError(err)) setConfigError(errorMessage(err))
      })
    return () => controller.abort()
  }, [configAttempt])

  // Forget a remembered target language the server no longer offers.
  useEffect(() => {
    if (config && state.target && !config.languages.some((lang) => lang.code === state.target)) {
      dispatch({ type: 'targetChanged', code: null })
    }
  }, [config, state.target])

  useEffect(() => {
    if (!state.target) return
    try {
      localStorage.setItem(TARGET_STORAGE_KEY, state.target)
    } catch {
      // Storage can be unavailable (private mode); remembering the choice is optional.
    }
  }, [state.target])

  // Release the previous clip's object URL once it is replaced or removed.
  const clipUrl = state.clip?.url
  useEffect(() => () => {
    if (clipUrl) URL.revokeObjectURL(clipUrl)
  }, [clipUrl])

  const detect = useCallback((clip: AudioClip) => {
    detectRequest.current?.abort()
    translateRequest.current?.abort()
    const controller = new AbortController()
    detectRequest.current = controller
    dispatch({ type: 'detectionStarted', clipId: clip.id })
    transcribeAudio(clip.file, controller.signal)
      .then((data) => dispatch({ type: 'detectionSucceeded', clipId: clip.id, data }))
      .catch((err) => {
        if (!isAbortError(err)) dispatch({ type: 'detectionFailed', clipId: clip.id, error: errorMessage(err) })
      })
  }, [])

  const addAudio = useCallback(
    (file: File, origin: AudioClip['origin'], durationHint: number | null) => {
      const clip: AudioClip = { id: nextClipId.current++, file, url: URL.createObjectURL(file), origin, durationHint }
      dispatch({ type: 'clipAdded', clip })
      detect(clip)
    },
    [detect],
  )

  const removeAudio = () => {
    detectRequest.current?.abort()
    translateRequest.current?.abort()
    dispatch({ type: 'clipRemoved' })
  }

  // On narrow screens the result sits below the fold; bring it into view when it arrives.
  const revealResult = () => {
    requestAnimationFrame(() => {
      const card = resultRef.current
      if (!card || card.getBoundingClientRect().top < window.innerHeight * 0.6) return
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    })
  }

  const translate = () => {
    const { clip, detection, target } = state
    if (!clip || detection.status !== 'success' || !target) return
    translateRequest.current?.abort()
    const controller = new AbortController()
    translateRequest.current = controller
    dispatch({ type: 'translationStarted', clipId: clip.id })
    // Re-translating reuses the transcript, so changing language never re-uploads the audio.
    translateText(
      {
        text: detection.data.transcript,
        sourceLanguage: detection.data.detected_language?.code ?? null,
        targetLanguage: target,
      },
      controller.signal,
    )
      .then((data) => {
        const entry: HistoryEntry = {
          id: newId(),
          createdAt: Date.now(),
          audioName: clip.file.name,
          origin: clip.origin,
          duration: detection.data.duration ?? clip.durationHint,
          source: detection.data.detected_language,
          target: data.target_language,
          transcript: detection.data.transcript,
          translation: data.translation,
          model: data.model,
          truncated: data.truncated,
        }
        history.add(entry)
        dispatch({ type: 'translationSucceeded', clipId: clip.id, data: entry })
        revealResult()
      })
      .catch((err) => {
        if (!isAbortError(err)) dispatch({ type: 'translationFailed', clipId: clip.id, error: errorMessage(err) })
      })
  }

  // Keyed so per-translation state (e.g. a created share link) never carries over to the next one.
  const actionsFor = (entry: HistoryEntry) => (
    <TranslationActions key={entry.id} {...entryActions(entry, (shareId) => history.update(entry.id, { shareId }))} />
  )

  const { clip, detection, translation, target, notice } = state
  // History holds the live copy (e.g. once it has been shared).
  const currentEntry =
    translation.status === 'success'
      ? (history.entries.find((entry) => entry.id === translation.data.id) ?? translation.data)
      : null
  const detected = detection.status === 'success' ? detection.data.detected_language : null
  const targetLanguage = config?.languages.find((lang) => lang.code === target) ?? null
  const translating = translation.status === 'loading'
  const canTranslate = detection.status === 'success' && targetLanguage !== null && !translating

  let hint: string
  if (!config) hint = 'Loading languages…'
  else if (!clip) hint = 'Record or upload audio to get started.'
  else if (detection.status === 'loading') hint = 'Detecting the spoken language…'
  else if (detection.status === 'error') hint = 'Fix the audio problem above to continue.'
  else if (!targetLanguage) hint = 'Choose a language to translate into.'
  else hint = `Translate from ${detected?.name ?? 'the detected language'} into ${targetLanguage.name}.`

  let announcement = ''
  if (detection.status === 'loading') announcement = 'Detecting language.'
  else if (translation.status === 'success') announcement = `Translation into ${translation.data.target.name} is ready.`
  else if (detected) announcement = `Detected ${detected.name}.`

  const duration = detection.status === 'success' ? detection.data.duration : (clip?.durationHint ?? null)

  return (
    <div className="min-h-dvh">
      <AppHeader>
        {config && (
          <span className="hidden items-center gap-2 rounded-full bg-white/70 px-3.5 py-2 text-xs font-semibold text-ink-500 shadow-sm ring-1 ring-white md:inline-flex">
            <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
            {config.models.transcription} · {config.models.translation}
          </span>
        )}
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          aria-label={`History, ${history.entries.length} saved`}
          className="inline-flex h-10 items-center gap-2 rounded-full bg-white/80 px-3 text-sm font-semibold text-ink-700 shadow-sm ring-1 ring-white transition hover:bg-white hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none sm:px-3.5"
        >
          <History className="size-[18px]" aria-hidden />
          <span className="hidden sm:inline">History</span>
          {history.entries.length > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand-500 px-1.5 text-[11px] font-bold text-white">
              {history.entries.length}
            </span>
          )}
        </button>
        <UserMenu user={user} onSignOut={onSignOut} />
      </AppHeader>

      <main className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
        <section className="flex flex-col items-center pt-1 pb-7 text-center sm:pt-2 sm:pb-10">
          <div className="relative">
            <div className="absolute inset-0 scale-125 rounded-full bg-brand-300/45 blur-2xl" aria-hidden />
            <div className="relative grid size-20 place-items-center rounded-full bg-linear-to-b from-white to-brand-50 shadow-card ring-1 ring-white sm:size-24">
              <LogoMark className="size-10 sm:size-12" />
            </div>
          </div>
          <p className="mt-5 rounded-full sm:mt-6 bg-white/70 px-3.5 py-1 text-sm font-semibold text-ink-500 ring-1 ring-white">
            {greeting()}, {user.username} 👋
          </p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-balance text-ink-900 sm:text-[2.6rem]">
            Translate any voice, instantly
          </h1>
          <p className="mt-3 max-w-xl text-pretty text-ink-500">
            Record yourself or upload a clip. We’ll detect the spoken language and translate it into any of{' '}
            {config ? config.languages.length : '60+'} languages.
          </p>
        </section>

        {configError && (
          <Alert className="mb-5" action={<RetryButton onClick={() => setConfigAttempt((n) => n + 1)} />}>
            Couldn’t load the app settings. {configError}
          </Alert>
        )}

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-6">
          <Card className="flex flex-col gap-5 bg-linear-to-br from-brand-100/70 via-white/70 to-white/60 p-5 sm:p-7">
            <CardHeader icon={<Mic />} title="Add your audio" subtitle="Record your voice or upload an audio file" />

            <AudioInput
              mode={inputMode}
              onModeChange={setInputMode}
              maxUploadBytes={config?.limits.max_upload_bytes ?? 25 * 1024 * 1024}
              maxRecordingSeconds={config?.limits.max_recording_seconds ?? 600}
              onAudio={addAudio}
              clip={
                clip && (
                  <>
                    <AudioPreview key={clip.id} clip={clip} onRemove={removeAudio} />
                    <DetectionStatus detection={detection} onRetry={() => detect(clip)} />
                  </>
                )
              }
            />

            <div>
              <div
                className={`flex flex-col gap-1.5 rounded-[26px] bg-white p-1.5 shadow-sm ring-1 transition sm:flex-row sm:items-center sm:rounded-full ${
                  notice ? 'ring-amber-300' : 'ring-white'
                }`}
              >
                <LanguagePicker
                  languages={config?.languages ?? []}
                  value={target}
                  onChange={(code) => dispatch({ type: 'targetChanged', code })}
                  audioLanguage={detected?.code ?? null}
                  disabled={!config}
                />
                <button
                  type="button"
                  onClick={translate}
                  disabled={!canTranslate}
                  className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-linear-to-b from-brand-400 to-brand-600 px-6 font-semibold text-white shadow-glow transition hover:brightness-105 focus-visible:ring-4 focus-visible:ring-brand-300 focus-visible:outline-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none disabled:hover:brightness-100"
                >
                  {translating ? (
                    <>
                      <LoaderCircle className="size-5 animate-spin" aria-hidden />
                      Translating…
                    </>
                  ) : (
                    <>
                      Translate
                      <ArrowRight className="size-[18px]" aria-hidden />
                    </>
                  )}
                </button>
              </div>
              {notice ? (
                <Alert tone="warning" className="mt-3">
                  {notice}
                </Alert>
              ) : (
                <p className="mt-2.5 px-3 text-sm text-ink-500">{hint}</p>
              )}
            </div>
          </Card>

          <ResultCard
            ref={resultRef}
            detection={detection}
            translation={translation}
            actions={currentEntry && actionsFor(currentEntry)}
            languageCount={config?.languages.length ?? 0}
            onRetryTranslation={translate}
          />
        </div>

        <StatTiles
          className="mt-5 lg:mt-6"
          tiles={[
            { icon: <Globe />, label: 'Detected language', value: detected?.name ?? '—' },
            { icon: <Clock />, label: 'Audio length', value: clip ? formatDuration(duration) : '—' },
            { icon: <Languages />, label: 'Translating to', value: targetLanguage?.name ?? '—' },
            { icon: <Sparkles />, label: 'Languages', value: config ? String(config.languages.length) : '—' },
          ]}
        />
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-center text-xs text-ink-400 sm:px-6">
        Audio is sent to OpenAI for transcription, translation and speech. Your history stays in this browser; only
        translations you share are stored on the server.
      </footer>

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        entries={history.entries}
        actionsFor={actionsFor}
        onDelete={history.remove}
        onClear={history.clear}
      />

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}

function DetectionStatus({ detection, onRetry }: { detection: Async<Transcription>; onRetry: () => void }) {
  if (detection.status === 'loading') {
    return (
      <div className="flex items-center gap-2.5 rounded-2xl bg-white/60 px-4 py-3 text-sm text-ink-700 ring-1 ring-white">
        <LoaderCircle className="size-4 animate-spin text-brand-500" aria-hidden />
        Transcribing and detecting the language…
      </div>
    )
  }
  if (detection.status === 'error') {
    return <Alert action={<RetryButton onClick={onRetry} />}>{detection.error}</Alert>
  }
  if (detection.status !== 'success') return null

  const language = detection.data.detected_language
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/60 px-4 py-3 ring-1 ring-white">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
        <AudioLines className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 text-sm">
        <p className="text-ink-500">Detected language</p>
        <p className="truncate font-semibold text-ink-900">
          {language?.name ?? 'Unknown'}
          {language && language.native_name !== language.name && (
            <bdi lang={language.code ?? undefined} className="ml-1.5 font-medium text-ink-500">
              {language.native_name}
            </bdi>
          )}
        </p>
      </div>
    </div>
  )
}
