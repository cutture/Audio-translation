import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { ArrowLeft, ArrowRight, FileAudio, History, Link2, Mic, Search, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { formatDateTime, formatDuration, formatRelativeTime } from '../lib/format'
import type { HistoryEntry } from '../types'
import { ArrowDivider, OriginalPanel, TranslatedPanel } from './TranslationView'

interface Props {
  open: boolean
  onClose: () => void
  entries: HistoryEntry[]
  actionsFor: (entry: HistoryEntry) => ReactNode
  onDelete: (id: string) => void
  onClear: () => void
}

export function HistoryDrawer({ open, onClose, entries, actionsFor, onDelete, onClear }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const selected = entries.find((entry) => entry.id === selectedId) ?? null

  const close = () => {
    onClose()
    setSelectedId(null)
    setQuery('')
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return entries
    return entries.filter((entry) =>
      [entry.transcript, entry.translation, entry.target.name, entry.source?.name ?? '', entry.audioName].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    )
  }, [entries, query])

  return (
    <Dialog open={open} onClose={close} className="relative z-40">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-900/25 backdrop-blur-[2px] transition duration-200 ease-out data-closed:opacity-0"
      />
      <div className="fixed inset-0 flex justify-end">
        <DialogPanel
          transition
          className="flex h-full w-full max-w-md flex-col bg-canvas shadow-2xl shadow-brand-900/20 transition duration-300 ease-out data-closed:translate-x-full"
        >
          <div className="flex items-start gap-3 border-b border-white/80 bg-white/60 px-5 py-4 backdrop-blur-xl">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-100/80 text-brand-600 ring-1 ring-white">
              <History className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-lg font-bold tracking-tight text-ink-900">History</DialogTitle>
              <p className="text-sm text-ink-500">
                {entries.length === 1 ? '1 translation' : `${entries.length} translations`} · saved in this browser
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close history"
              className="grid size-10 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-white hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none"
            >
              <X className="size-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {selected ? (
              <EntryDetail
                entry={selected}
                actions={actionsFor(selected)}
                onBack={() => setSelectedId(null)}
                onDelete={() => {
                  onDelete(selected.id)
                  setSelectedId(null)
                }}
              />
            ) : entries.length === 0 ? (
              <EmptyHistory />
            ) : (
              <>
                <label className="relative block">
                  <span className="sr-only">Search history</span>
                  <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search translations"
                    className="h-11 w-full rounded-full bg-white/80 pr-4 pl-10 text-sm text-ink-900 ring-1 ring-white placeholder:text-ink-400 focus:ring-2 focus:ring-brand-300 focus:outline-none"
                  />
                </label>
                <ul className="mt-4 flex flex-col gap-3">
                  {visible.map((entry) => (
                    <li key={entry.id}>
                      <EntryRow entry={entry} onOpen={() => setSelectedId(entry.id)} />
                    </li>
                  ))}
                </ul>
                {visible.length === 0 && (
                  <p className="mt-6 text-center text-sm text-ink-500">No translations match “{query}”.</p>
                )}
              </>
            )}
          </div>

          {!selected && entries.length > 0 && <ClearHistory onClear={onClear} />}
        </DialogPanel>
      </div>
    </Dialog>
  )
}

function LanguagePair({ entry }: { entry: HistoryEntry }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-brand-700">
      {entry.source?.name ?? 'Unknown'}
      <ArrowRight className="size-3" aria-hidden />
      {entry.target.name}
    </span>
  )
}

function EntryRow({ entry, onOpen }: { entry: HistoryEntry; onOpen: () => void }) {
  const SourceIcon = entry.origin === 'recording' ? Mic : FileAudio
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-3xl bg-white/70 p-4 text-left ring-1 ring-white transition hover:bg-white focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none"
    >
      <span className="flex items-center justify-between gap-3 text-xs">
        <LanguagePair entry={entry} />
        <time dateTime={new Date(entry.createdAt).toISOString()} title={formatDateTime(entry.createdAt)} className="shrink-0 text-ink-400">
          {formatRelativeTime(entry.createdAt)}
        </time>
      </span>
      <span lang={entry.target.code} dir={entry.target.rtl ? 'rtl' : 'ltr'} className="mt-1.5 line-clamp-2 block font-medium text-ink-900">
        {entry.translation}
      </span>
      <span className="mt-1 line-clamp-1 block text-sm text-ink-500">{entry.transcript}</span>
      <span className="mt-2 flex items-center gap-1.5 text-xs text-ink-400">
        <SourceIcon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{entry.audioName}</span>
        {entry.duration != null && <span className="shrink-0">· {formatDuration(entry.duration)}</span>}
        {entry.shareId && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1 font-semibold text-brand-600">
            <Link2 className="size-3.5" aria-hidden />
            Shared
          </span>
        )}
      </span>
    </button>
  )
}

function EntryDetail({
  entry,
  actions,
  onBack,
  onDelete,
}: {
  entry: HistoryEntry
  actions: ReactNode
  onBack: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 text-sm font-semibold text-ink-500 transition hover:bg-white hover:text-ink-900"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All translations
      </button>
      <div className="px-1">
        <p className="text-sm">
          <LanguagePair entry={entry} />
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          {formatDateTime(entry.createdAt)} · {entry.audioName}
          {entry.duration != null && ` · ${formatDuration(entry.duration)}`}
        </p>
      </div>
      <OriginalPanel language={entry.source} text={entry.transcript} />
      <ArrowDivider />
      <TranslatedPanel target={entry.target} text={entry.translation} truncated={entry.truncated} actions={actions} />
      <button
        type="button"
        onClick={onDelete}
        className="mt-1 inline-flex w-fit items-center gap-1.5 self-center rounded-full px-3 py-1.5 text-sm font-semibold text-red-700 transition hover:bg-red-50"
      >
        <Trash2 className="size-4" aria-hidden />
        Delete from history
      </button>
    </div>
  )
}

function EmptyHistory() {
  return (
    <div className="mt-10 flex flex-col items-center px-6 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-white text-brand-500 shadow-sm ring-1 ring-white">
        <History className="size-6" aria-hidden />
      </span>
      <p className="mt-4 font-semibold text-ink-900">No translations yet</p>
      <p className="mt-1 text-sm text-ink-500">
        Every translation you make is saved here automatically, in this browser only.
      </p>
    </div>
  )
}

function ClearHistory({ onClear }: { onClear: () => void }) {
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const timeout = window.setTimeout(() => setConfirming(false), 4000)
    return () => window.clearTimeout(timeout)
  }, [confirming])

  return (
    <div className="border-t border-white/80 bg-white/60 px-5 py-3 backdrop-blur-xl">
      <button
        type="button"
        onClick={() => (confirming ? onClear() : setConfirming(true))}
        className={`inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition ${
          confirming ? 'bg-red-600 text-white hover:bg-red-700' : 'text-ink-500 hover:bg-white hover:text-red-700'
        }`}
      >
        <Trash2 className="size-4" aria-hidden />
        {confirming ? 'Tap again to delete everything' : 'Clear history'}
      </button>
    </div>
  )
}
