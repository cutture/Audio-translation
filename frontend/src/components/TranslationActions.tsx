import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { Check, Copy, Download, FileText, Link2, LoaderCircle, Pause, Play, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createShare, errorMessage } from '../api'
import { entryAudioKey } from '../hooks/useHistory'
import { copyText } from '../lib/clipboard'
import { saveBlob, saveText, translationAsText, translationFileName } from '../lib/download'
import { formatDuration } from '../lib/format'
import { player, usePlayback } from '../lib/player'
import { getSpeech, getSpeechUrl } from '../lib/speech'
import type { HistoryEntry } from '../types'
import { Alert } from './ui'

export interface TranslationActionsProps {
  /** Identifies this translation's audio in the shared player. */
  audioKey: string
  getAudioUrl: () => Promise<string>
  downloadAudio: () => Promise<void>
  downloadText: () => void
  /** Resolves the public link, creating it on first use. */
  getShareUrl: () => Promise<string>
  translation: string
}

const PILL =
  'inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none disabled:cursor-wait disabled:opacity-70'
const SECONDARY_PILL = `${PILL} bg-white/85 text-ink-700 ring-1 ring-brand-100 hover:bg-white hover:text-ink-900`

export function shareUrlFor(shareId: string): string {
  return new URL(`/s/${shareId}`, window.location.origin).href
}

/** Actions for a translation kept in this browser's history. */
export function entryActions(entry: HistoryEntry, onShared: (shareId: string) => void): TranslationActionsProps {
  return {
    audioKey: entryAudioKey(entry.id),
    getAudioUrl: () => getSpeechUrl(entry),
    downloadAudio: async () => saveBlob(await getSpeech(entry), translationFileName(entry.target, 'mp3', entry.createdAt)),
    downloadText: () => saveText(translationAsText(entry), translationFileName(entry.target, 'txt', entry.createdAt)),
    getShareUrl: async () => {
      if (entry.shareId) return shareUrlFor(entry.shareId)
      const { id } = await createShare({
        transcript: entry.transcript,
        translation: entry.translation,
        sourceLanguage: entry.source?.code ?? null,
        targetLanguage: entry.target.code,
      })
      onShared(id)
      return shareUrlFor(id)
    },
    translation: entry.translation,
  }
}

export function TranslationActions(props: TranslationActionsProps) {
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-3">
      <TranslationPlayer
        audioKey={props.audioKey}
        getAudioUrl={props.getAudioUrl}
        downloadAudio={props.downloadAudio}
        onError={setError}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={props.downloadText} className={SECONDARY_PILL}>
          <FileText className="size-4" aria-hidden />
          Download text
        </button>
        <ShareButton getShareUrl={props.getShareUrl} onError={setError} />
        <CopyPill text={props.translation} />
      </div>
      {error && <Alert action={<DismissButton onClick={() => setError(null)} />}>{error}</Alert>}
    </div>
  )
}

/** Preview the spoken translation (play, pause, seek) with its MP3 download right beside it. */
function TranslationPlayer({
  audioKey,
  getAudioUrl,
  downloadAudio,
  onError,
}: {
  audioKey: string
  getAudioUrl: () => Promise<string>
  downloadAudio: () => Promise<void>
  onError: (message: string | null) => void
}) {
  const { status, position, duration } = usePlayback(audioKey)
  const [preparingDownload, setPreparingDownload] = useState(false)
  const loaded = status === 'playing' || status === 'paused'

  useEffect(() => player.retain(audioKey), [audioKey])

  const toggle = () => {
    onError(null)
    player.toggle(audioKey, getAudioUrl).catch((err) => onError(`Couldn’t play the translation. ${errorMessage(err)}`))
  }

  const download = async () => {
    onError(null)
    setPreparingDownload(true)
    try {
      await downloadAudio()
    } catch (err) {
      onError(`Couldn’t prepare the audio file. ${errorMessage(err)}`)
    } finally {
      setPreparingDownload(false)
    }
  }

  let timeLabel = `${formatDuration(position)} / ${formatDuration(duration)}`
  if (status === 'loading') timeLabel = 'Preparing audio…'
  else if (status === 'idle' && duration === null) timeLabel = 'Play to preview'

  return (
    <div className="flex items-center gap-3 rounded-2xl bg-white/85 p-2.5 pr-3 ring-1 ring-brand-100">
      <button
        type="button"
        onClick={toggle}
        aria-label={status === 'playing' ? 'Pause translation audio' : status === 'loading' ? 'Cancel' : 'Play translation audio'}
        className="grid size-11 shrink-0 place-items-center rounded-full bg-linear-to-b from-brand-400 to-brand-600 text-white shadow-glow transition hover:brightness-105 focus-visible:ring-4 focus-visible:ring-brand-300 focus-visible:outline-none active:scale-95"
      >
        {status === 'loading' ? (
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
        ) : status === 'playing' ? (
          <Pause className="size-5 fill-current" aria-hidden />
        ) : (
          <Play className="ml-0.5 size-5 fill-current" aria-hidden />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={duration ?? 1}
          step={0.01}
          value={loaded ? Math.min(position, duration ?? position) : 0}
          disabled={!loaded || !duration}
          aria-label="Seek translation audio"
          onChange={(event) => player.seek(audioKey, Number(event.target.value))}
          className="h-1.5 w-full cursor-pointer accent-brand-500 disabled:cursor-default"
        />
        <p className="mt-1 truncate text-xs text-ink-500 tabular-nums">{timeLabel}</p>
      </div>

      <button
        type="button"
        onClick={download}
        disabled={preparingDownload}
        aria-label="Download audio (MP3)"
        title="Download audio (MP3)"
        className={`${SECONDARY_PILL} shrink-0 px-3`}
      >
        {preparingDownload ? (
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
        ) : (
          <Download className="size-4" aria-hidden />
        )}
        {/* Icon-only on very narrow screens so the seek bar keeps room; the label stays for screen readers. */}
        <span className="max-[420px]:sr-only">MP3</span>
      </button>
    </div>
  )
}

function ShareButton({
  getShareUrl,
  onError,
}: {
  getShareUrl: () => Promise<string>
  onError: (message: string | null) => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const ensureLink = async () => {
    if (url || creating) return
    onError(null)
    setCreating(true)
    try {
      setUrl(await getShareUrl())
    } catch (err) {
      onError(`Couldn’t create a share link. ${errorMessage(err)}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <Popover>
      <PopoverButton onClick={ensureLink} className={SECONDARY_PILL}>
        {creating ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
        Share
      </PopoverButton>
      <PopoverPanel
        anchor="bottom"
        transition
        className="z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-white bg-white/95 p-4 shadow-xl shadow-brand-900/10 backdrop-blur-xl transition duration-150 ease-out [--anchor-gap:8px] data-closed:-translate-y-1 data-closed:opacity-0"
      >
        {url ? (
          <ShareLink url={url} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink-500">
            {creating && <LoaderCircle className="size-4 animate-spin text-brand-500" aria-hidden />}
            {creating ? 'Creating a link…' : 'No link yet.'}
          </p>
        )}
      </PopoverPanel>
    </Popover>
  )
}

function ShareLink({ url }: { url: string }) {
  const host = new URL(url).hostname
  const localOnly = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
  const canShareNatively = typeof navigator.share === 'function'

  return (
    <div>
      <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
        <Link2 className="size-4 text-brand-500" aria-hidden />
        Share this translation
      </p>
      <p className="mt-1 text-xs text-ink-500">Anyone with the link can read it, listen to it and download it.</p>
      <div className="mt-3 flex items-center gap-2">
        <input
          readOnly
          value={url}
          aria-label="Share link"
          onFocus={(event) => event.target.select()}
          className="h-9 min-w-0 flex-1 rounded-full bg-brand-50 px-3 text-xs text-ink-700 ring-1 ring-brand-100 focus:ring-brand-300 focus:outline-none"
        />
        <CopyPill text={url} label="Copy link" />
      </div>
      {canShareNatively && (
        <button
          type="button"
          onClick={() => navigator.share({ title: 'Translation', url }).catch(() => {})}
          className={`${SECONDARY_PILL} mt-2 w-full justify-center`}
        >
          <Share2 className="size-4" aria-hidden />
          Share via…
        </button>
      )}
      {localOnly && (
        <Alert tone="warning" className="mt-3 text-xs">
          This link points to <strong>{host}</strong>, so it only opens on this computer. Host the app on a public
          server (or your local network) so others can open it.
        </Alert>
      )}
    </div>
  )
}

function CopyPill({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timeout)
  }, [copied])

  return (
    <button
      type="button"
      onClick={() => copyText(text).then(() => setCopied(true), () => {})}
      className={`${SECONDARY_PILL} shrink-0`}
    >
      {copied ? <Check className="size-4 text-emerald-600" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? 'Copied' : label}
    </button>
  )
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 text-xs font-semibold underline underline-offset-2">
      Dismiss
    </button>
  )
}
