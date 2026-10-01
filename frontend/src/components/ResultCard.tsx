import { History, Languages, LoaderCircle, Mic, ScanSearch } from 'lucide-react'
import type { ReactNode, Ref } from 'react'
import type { Async } from '../state'
import type { HistoryEntry, Transcription } from '../types'
import { ArrowDivider, OriginalPanel, TranslatedPanel } from './TranslationView'
import { Alert, Card, CardHeader, IconTile, RetryButton } from './ui'

interface Props {
  detection: Async<Transcription>
  translation: Async<HistoryEntry>
  /** Listen / download / share controls for the finished translation. */
  actions?: ReactNode
  languageCount: number
  onRetryTranslation: () => void
  ref?: Ref<HTMLElement>
}

export function ResultCard({ detection, translation, actions, languageCount, onRetryTranslation, ref }: Props) {
  let subtitle = 'Your transcript and translation will appear here'
  if (translation.status === 'success') {
    subtitle = `${translation.data.source?.name ?? 'Audio'} → ${translation.data.target.name}`
  } else if (detection.status === 'success') {
    subtitle = 'Transcript ready. Choose a language to translate into.'
  }

  return (
    <Card ref={ref} className="flex scroll-mt-4 flex-col gap-5 p-5 sm:p-7">
      <CardHeader icon={<Languages />} title="Translation" subtitle={subtitle} />

      {detection.status === 'idle' && <EmptyState languageCount={languageCount} />}
      {detection.status === 'loading' && <Skeleton label="Listening to your audio…" />}
      {detection.status === 'error' && (
        <p className="rounded-2xl bg-white/60 px-4 py-6 text-center text-sm text-ink-500 ring-1 ring-white">
          We couldn’t transcribe this audio. See the audio panel for details.
        </p>
      )}
      {detection.status === 'success' && (
        <div className="flex flex-col gap-3">
          <OriginalPanel language={detection.data.detected_language} text={detection.data.transcript} />
          <ArrowDivider />
          <TranslationResult translation={translation} actions={actions} onRetry={onRetryTranslation} />
        </div>
      )}
    </Card>
  )
}

function TranslationResult({
  translation,
  actions,
  onRetry,
}: {
  translation: Async<HistoryEntry>
  actions?: ReactNode
  onRetry: () => void
}) {
  switch (translation.status) {
    case 'idle':
      return (
        <p className="rounded-2xl border-2 border-dashed border-brand-200/80 px-4 py-7 text-center text-sm text-ink-500">
          Pick a language and press <span className="font-semibold text-ink-700">Translate</span> to see it here.
        </p>
      )
    case 'loading':
      return <Skeleton label="Translating…" warm />
    case 'error':
      return <Alert action={<RetryButton onClick={onRetry} />}>{translation.error}</Alert>
    case 'success':
      return (
        <TranslatedPanel
          target={translation.data.target}
          text={translation.data.translation}
          truncated={translation.data.truncated}
          actions={actions}
          footer={
            <span className="inline-flex items-center gap-1.5">
              <History className="size-3.5" aria-hidden />
              Saved to your history · translated with {translation.data.model}
            </span>
          }
        />
      )
  }
}

function Skeleton({ label, warm = false }: { label: string; warm?: boolean }) {
  return (
    <div className={`rounded-3xl p-5 ring-1 ring-white ${warm ? 'bg-brand-50/80' : 'bg-white/60'}`}>
      <p className="flex items-center gap-2 text-sm font-medium text-ink-500">
        <LoaderCircle className="size-4 animate-spin text-brand-500" aria-hidden />
        {label}
      </p>
      <div className="mt-4 space-y-2.5" aria-hidden>
        {['w-11/12', 'w-full', 'w-3/4'].map((width) => (
          <div key={width} className={`h-3 rounded-full bg-brand-100 motion-safe:animate-pulse ${width}`} />
        ))}
      </div>
    </div>
  )
}

function EmptyState({ languageCount }: { languageCount: number }) {
  const steps = [
    { icon: <Mic />, title: 'Record or upload', text: 'Speak into your microphone or drop in an audio file.' },
    { icon: <ScanSearch />, title: 'We detect the language', text: 'Your audio is transcribed and its language recognised.' },
    {
      icon: <Languages />,
      title: 'Translate, listen & share',
      text: `Choose from ${languageCount || 'dozens of'} languages, hear the result and share it by link.`,
    },
  ]
  return (
    <ol className="grid gap-3">
      {steps.map((step, index) => (
        <li key={step.title} className="flex items-start gap-3.5 rounded-3xl bg-white/60 p-4 ring-1 ring-white">
          <IconTile>{step.icon}</IconTile>
          <div>
            <p className="font-semibold text-ink-900">
              {index + 1}. {step.title}
            </p>
            <p className="text-sm text-ink-500">{step.text}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
