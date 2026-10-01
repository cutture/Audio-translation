import type { ReactNode } from 'react'
import { LogoMark } from './ui'

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
      <a
        href="/"
        className="flex items-center gap-2.5 rounded-full focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none"
      >
        <span className="grid size-10 place-items-center rounded-full bg-white shadow-card ring-1 ring-white">
          <LogoMark className="size-6" />
        </span>
        <span className="text-[17px] font-bold tracking-tight text-ink-900">Audio Translator</span>
      </a>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </header>
  )
}
