import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react'
import { Check, ChevronDown, Globe } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import type { Language } from '../types'

interface Props {
  languages: Language[]
  value: string | null
  onChange: (code: string) => void
  /** The language of the audio, which can't be a translation target. */
  audioLanguage: string | null
  disabled?: boolean
}

const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

const needleOf = (query: string) => normalize(query.trim())

/** Lower is better: exact code, then name prefix, then word prefix, then anywhere. */
function matchRank(lang: Language, needle: string): number | null {
  if (lang.code === needle) return 0
  const fields = [lang.name, lang.native_name].map(normalize)
  if (fields.some((field) => field.startsWith(needle))) return 1
  if (fields.some((field) => field.split(/\s+/).some((word) => word.startsWith(needle)))) return 2
  if (fields.some((field) => field.includes(needle))) return 3
  return null
}

export function LanguagePicker({ languages, value, onChange, audioLanguage, disabled }: Props) {
  const [query, setQuery] = useState('')
  const selected = languages.find((lang) => lang.code === value) ?? null

  const filtered = useMemo(() => {
    const needle = needleOf(query)
    if (!needle) return languages
    return languages
      .map((lang) => ({ lang, rank: matchRank(lang, needle) }))
      .filter((match): match is { lang: Language; rank: number } => match.rank !== null)
      .sort((a, b) => a.rank - b.rank) // stable, so alphabetical order is kept within a rank
      .map((match) => match.lang)
  }, [languages, query])

  // Headless UI keeps the current selection highlighted while filtering, so Enter would
  // re-pick it ("hin" + Enter would keep "Chinese"). While a query is typed, treat nothing
  // as selected and remount the options so the best match is highlighted instead. A ref
  // (not state) because Headless UI compares with the previous render's comparator.
  const filteringRef = useRef(false)
  const sameLanguage = useCallback(
    (a: Language | null, b: Language | null) => !filteringRef.current && a?.code === b?.code,
    [],
  )
  const updateQuery = (next: string) => {
    filteringRef.current = needleOf(next) !== ''
    setQuery(next)
  }

  return (
    <Combobox
      value={selected}
      by={sameLanguage}
      onChange={(lang: Language | null) => lang && onChange(lang.code)}
      onClose={() => updateQuery('')}
      disabled={disabled}
      immediate
    >
      <div className="relative min-w-0 flex-1">
        <Globe className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-brand-500" aria-hidden />
        <span className="pointer-events-none absolute top-2 left-12 text-[11px] font-semibold tracking-wide text-ink-400 uppercase">
          Translate to
        </span>
        <ComboboxInput
          aria-label="Translate to"
          placeholder="Choose a language"
          autoComplete="off"
          displayValue={(lang: Language | null) => lang?.name ?? ''}
          onChange={(event) => updateQuery(event.target.value)}
          className="h-14 w-full rounded-full bg-transparent pt-4 pr-11 pl-12 text-[15px] font-semibold text-ink-900 placeholder:font-medium placeholder:text-ink-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <ComboboxButton
          aria-label="Show languages"
          className="absolute inset-y-0 right-0 flex items-center rounded-r-full pr-4 pl-2 text-ink-400 hover:text-ink-900"
        >
          <ChevronDown className="size-5" />
        </ComboboxButton>
      </div>

      <ComboboxOptions
        anchor="bottom start"
        transition
        className="z-50 max-h-80 w-(--input-width) min-w-72 overflow-y-auto rounded-2xl border border-white bg-white/95 p-1.5 shadow-xl shadow-brand-900/10 backdrop-blur-xl transition duration-150 ease-out [--anchor-gap:12px] data-closed:-translate-y-1 data-closed:opacity-0"
      >
        {filtered.length === 0 && (
          <div className="px-3 py-2.5 text-sm text-ink-500">No language matches “{query}”.</div>
        )}
        {filtered.map((lang) => {
          const isAudioLanguage = lang.code === audioLanguage
          return (
            <ComboboxOption
              key={`${query}:${lang.code}`}
              value={lang}
              disabled={isAudioLanguage}
              className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm select-none data-disabled:cursor-not-allowed data-disabled:opacity-60 data-focus:bg-brand-50"
            >
              <span className="font-semibold text-ink-900">{lang.name}</span>
              <bdi lang={lang.code} className="truncate text-ink-400">
                {lang.native_name !== lang.name ? lang.native_name : ''}
              </bdi>
              {isAudioLanguage ? (
                <span className="ml-auto shrink-0 rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-700">
                  Audio language
                </span>
              ) : (
                <Check className={`ml-auto size-4 shrink-0 text-brand-500 ${lang.code === value ? '' : 'invisible'}`} aria-hidden />
              )}
            </ComboboxOption>
          )
        })}
      </ComboboxOptions>
    </Combobox>
  )
}
