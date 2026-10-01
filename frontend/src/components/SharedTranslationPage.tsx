import { ArrowRight, Link2, LoaderCircle, SearchX } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, errorMessage, fetchShare, isAbortError } from '../api'
import { saveText, translationAsText, translationFileName, triggerDownload } from '../lib/download'
import { formatDateTime } from '../lib/format'
import type { Async } from '../state'
import type { SharedTranslation } from '../types'
import { AppHeader } from './AppHeader'
import { TranslationActions } from './TranslationActions'
import { ArrowDivider, OriginalPanel, TranslatedPanel } from './TranslationView'
import { Alert, Card, CardHeader, IconTile, RetryButton } from './ui'

/** Read-only page for a translation opened from a share link (/s/<id>). */
export function SharedTranslationPage({ shareId }: { shareId: string }) {
  const [share, setShare] = useState<Async<SharedTranslation>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setShare({ status: 'loading' })
    fetchShare(shareId, controller.signal)
      .then((data) => {
        setShare({ status: 'success', data })
        document.title = `${data.target_language.name} translation · Audio Translator`
      })
      .catch((err) => {
        if (isAbortError(err)) return
        setShare({ status: 'error', error: err instanceof ApiError && err.status === 404 ? 'not_found' : errorMessage(err) })
      })
    return () => controller.abort()
  }, [shareId, attempt])

  return (
    <div className="min-h-dvh">
      <AppHeader>
        <a
          href="/"
          className="inline-flex h-10 items-center gap-2 rounded-full bg-white/80 px-4 text-sm font-semibold text-ink-700 shadow-sm ring-1 ring-white transition hover:bg-white hover:text-ink-900"
        >
          Translate your audio
          <ArrowRight className="size-4" aria-hidden />
        </a>
      </AppHeader>

      <main className="mx-auto max-w-3xl px-4 pt-2 pb-12 sm:px-6">
        {share.status === 'loading' && (
          <Card className="flex items-center justify-center gap-2.5 p-10 text-sm text-ink-500">
            <LoaderCircle className="size-5 animate-spin text-brand-500" aria-hidden />
            Loading the shared translation…
          </Card>
        )}

        {share.status === 'error' &&
          (share.error === 'not_found' ? (
            <Card className="flex flex-col items-center p-10 text-center">
              <IconTile className="size-14">
                <SearchX />
              </IconTile>
              <h1 className="mt-4 text-xl font-bold text-ink-900">This link doesn’t work</h1>
              <p className="mt-1 max-w-sm text-sm text-ink-500">
                The shared translation doesn’t exist on this server. Check that the link was copied completely.
              </p>
            </Card>
          ) : (
            <Alert action={<RetryButton onClick={() => setAttempt((n) => n + 1)} />}>{share.error}</Alert>
          ))}

        {share.status === 'success' && <SharedTranslationCard share={share.data} />}
      </main>
    </div>
  )
}

function SharedTranslationCard({ share }: { share: SharedTranslation }) {
  const createdAt = Date.parse(share.created_at)
  const record = {
    transcript: share.transcript,
    translation: share.translation,
    source: share.source_language,
    target: share.target_language,
    createdAt,
  }

  return (
    <Card className="flex flex-col gap-5 p-5 sm:p-7">
      <CardHeader
        icon={<Link2 />}
        title="Shared translation"
        subtitle={`${share.source_language?.name ?? 'Audio'} → ${share.target_language.name} · ${formatDateTime(createdAt)}`}
      />
      <div className="flex flex-col gap-3">
        <OriginalPanel language={share.source_language} text={share.transcript} />
        <ArrowDivider />
        <TranslatedPanel
          target={share.target_language}
          text={share.translation}
          actions={
            <TranslationActions
              audioKey={`share:${share.id}`}
              // The server generates the audio on first play and caches it for everyone.
              getAudioUrl={async () => share.audio_url}
              downloadAudio={async () => triggerDownload(`${share.audio_url}?download=1`)}
              downloadText={() => saveText(translationAsText(record), translationFileName(share.target_language, 'txt', createdAt))}
              getShareUrl={async () => window.location.href}
              translation={share.translation}
            />
          }
        />
      </div>
    </Card>
  )
}
