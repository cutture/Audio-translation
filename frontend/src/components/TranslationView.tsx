import { ArrowDown } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Language } from '../types'
import { Alert, CopyButton } from './ui'

interface SpokenLanguage {
  code: string | null
  name: string
  rtl: boolean
}

export function OriginalPanel({ language, text }: { language: SpokenLanguage | null; text: string }) {
  return (
    <div className="rounded-3xl bg-white/70 p-5 ring-1 ring-white">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold tracking-wide text-ink-400 uppercase">
          Original · {language?.name ?? 'Unknown language'}
        </p>
        <CopyButton text={text} label="Copy transcript" />
      </div>
      <p
        lang={language?.code ?? undefined}
        dir={language?.rtl ? 'rtl' : 'ltr'}
        className="mt-2 leading-relaxed whitespace-pre-line text-ink-700"
      >
        {text}
      </p>
    </div>
  )
}

export function ArrowDivider() {
  return (
    <div className="flex justify-center" aria-hidden>
      <span className="grid size-9 place-items-center rounded-full bg-white text-brand-500 shadow-sm ring-1 ring-white">
        <ArrowDown className="size-4" />
      </span>
    </div>
  )
}

export function TranslatedPanel({
  target,
  text,
  truncated = false,
  actions,
  footer,
}: {
  target: Language
  text: string
  truncated?: boolean
  actions?: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="rounded-3xl bg-linear-to-br from-brand-100/90 via-brand-50 to-white p-5 shadow-sm ring-1 ring-white">
      <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
        {target.name}
        {target.native_name !== target.name && (
          <bdi lang={target.code} className="ml-1.5 font-medium tracking-normal normal-case text-brand-600/80">
            {target.native_name}
          </bdi>
        )}
      </p>
      <p
        lang={target.code}
        dir={target.rtl ? 'rtl' : 'ltr'}
        className="mt-2 text-xl leading-relaxed font-medium whitespace-pre-line text-ink-900"
      >
        {text}
      </p>
      {truncated && (
        <Alert tone="warning" className="mt-3">
          This translation was cut short because the transcript is very long.
        </Alert>
      )}
      {actions && <div className="mt-4">{actions}</div>}
      {footer && <p className="mt-4 text-xs text-ink-400">{footer}</p>}
    </div>
  )
}
