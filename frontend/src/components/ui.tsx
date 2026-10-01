import { Check, CircleAlert, Copy, Info, RotateCcw } from 'lucide-react'
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import { copyText } from '../lib/clipboard'

export function Card({ className = '', ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={`rounded-[28px] border border-white/80 bg-white/65 shadow-card backdrop-blur-xl ${className}`}
      {...props}
    />
  )
}

export function IconTile({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-100/80 text-brand-600 ring-1 ring-white [&>svg]:size-5 ${className}`}
    >
      {children}
    </span>
  )
}

export function CardHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: ReactNode }) {
  return (
    <div className="flex items-start gap-3.5">
      <IconTile>{icon}</IconTile>
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight text-ink-900">{title}</h2>
        <p className="text-sm text-ink-500">{subtitle}</p>
      </div>
    </div>
  )
}

export function Alert({
  tone = 'error',
  children,
  action,
  className = '',
}: {
  tone?: 'error' | 'warning'
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  const Icon = tone === 'error' ? CircleAlert : Info
  const colors = tone === 'error' ? 'bg-red-50/90 text-red-800 ring-red-200/80' : 'bg-amber-50/90 text-amber-900 ring-amber-200/80'
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-sm ring-1 ${colors} ${className}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-ink-900 shadow-sm transition hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none"
    >
      <RotateCcw className="size-3.5" aria-hidden />
      Retry
    </button>
  )
}

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 1600)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const copy = () => {
    // Clipboard access can be denied; the text is still selectable.
    copyText(text).then(() => setCopied(true), () => {})
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : label}
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold text-ink-500 transition hover:bg-white hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
    >
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="logo-petal" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffa36b" />
          <stop offset="1" stopColor="#d9480f" />
        </linearGradient>
      </defs>
      <path
        fill="#8a3b1b"
        opacity=".85"
        transform="rotate(45 24 21.8)"
        d="M24 11c.9 6.7 4.1 9.9 10.8 10.8C28.1 22.7 24.9 25.9 24 32.6c-.9-6.7-4.1-9.9-10.8-10.8C19.9 20.9 23.1 17.7 24 11Z"
      />
      <path
        fill="url(#logo-petal)"
        d="M24 6c1.4 10 6.6 15.2 16.6 16.6C30.6 24 25.4 29.2 24 39.2 22.6 29.2 17.4 24 7.4 22.6 17.4 21.2 22.6 16 24 6Z"
      />
    </svg>
  )
}
