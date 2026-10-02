import { ArrowRight, Eye, EyeOff, LoaderCircle, Lock, UserRound } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { errorMessage, oauthStartUrl, signIn, signUp } from '../api'
import type { OAuthProvider, SessionInfo, User } from '../types'
import { AppHeader } from './AppHeader'
import { Alert, Card, LogoMark } from './ui'

export interface AuthNotice {
  tone: 'error' | 'warning'
  message: string
}

interface Props {
  options: Omit<SessionInfo, 'user'>
  /** Why the user is here, e.g. their session ended or a provider sign-in failed. */
  notice: AuthNotice | null
  onSignedIn: (user: User) => void
}

type Mode = 'sign-in' | 'sign-up'

const COPY: Record<Mode, { title: string; subtitle: string; submit: string; busy: string }> = {
  'sign-in': {
    title: 'Welcome back 👋',
    subtitle: 'Sign in to translate, listen to and share your audio.',
    submit: 'Sign in',
    busy: 'Signing in…',
  },
  'sign-up': {
    title: 'Create your account ✨',
    subtitle: 'Translate your voice into 60+ languages, free to start.',
    submit: 'Create account',
    busy: 'Creating your account…',
  },
}

export function AuthPage({ options, notice, onSignedIn }: Props) {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState(false)
  const copy = COPY[mode]
  const signingUp = mode === 'sign-up'

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setConfirmation('')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setAttempted(true)
    if (signingUp && password !== confirmation) {
      setError('The passwords don’t match.')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const { user } = await (signingUp ? signUp : signIn)(username.trim(), password)
      onSignedIn(user)
    } catch (err) {
      setError(errorMessage(err))
      setSubmitting(false)
    }
  }

  const incomplete = !username.trim() || !password || (signingUp && !confirmation)

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto flex max-w-md flex-col items-center px-4 pt-2 pb-12 sm:pt-6">
        <div className="relative">
          <div className="absolute inset-0 scale-125 rounded-full bg-brand-300/45 blur-2xl" aria-hidden />
          <div className="relative grid size-20 place-items-center rounded-full bg-linear-to-b from-white to-brand-50 shadow-card ring-1 ring-white">
            <LogoMark className="size-10" />
          </div>
        </div>
        <h1 className="mt-6 text-center text-3xl font-extrabold tracking-tight text-ink-900">{copy.title}</h1>
        <p className="mt-2 text-center text-pretty text-ink-500">{copy.subtitle}</p>

        <Card className="mt-7 w-full p-5 sm:p-7">
          {options.signup_enabled && (
            <div role="tablist" aria-label="Sign in or create an account" className="mb-5 grid grid-cols-2 gap-1 rounded-full bg-white/70 p-1 ring-1 ring-white">
              {(['sign-in', 'sign-up'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => switchMode(value)}
                  className="h-10 rounded-full text-sm font-semibold text-ink-500 transition hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none aria-selected:bg-white aria-selected:text-ink-900 aria-selected:shadow-sm"
                >
                  {value === 'sign-in' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
          )}

          {notice && !attempted && (
            <Alert tone={notice.tone} className="mb-5">
              {notice.message}
            </Alert>
          )}
          {options.setup_required && (
            <Alert tone="warning" className="mb-5">
              <p className="font-semibold">No accounts yet</p>
              <p className="mt-1">Create the first one on the server, from the project folder:</p>
              <code className="mt-2 block rounded-lg bg-white/80 px-2.5 py-1.5 font-mono text-xs break-all text-ink-900">
                flask --app app users create &lt;username&gt;
              </code>
            </Alert>
          )}

          {options.providers.length > 0 && (
            <>
              <div className="flex flex-col gap-2.5">
                {options.providers.map((provider) => (
                  <ProviderButton key={provider.id} provider={provider} signingUp={signingUp} />
                ))}
              </div>
              <div className="my-5 flex items-center gap-3 text-xs font-medium text-ink-400" aria-hidden>
                <span className="h-px flex-1 bg-brand-100" />
                or with a username
                <span className="h-px flex-1 bg-brand-100" />
              </div>
            </>
          )}

          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <Field
              label="Username"
              icon={<UserRound />}
              hint={signingUp ? '3–32 characters: letters, numbers, “.”, “_” or “-”.' : undefined}
            >
              <input
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className={INPUT}
              />
            </Field>
            <Field
              label="Password"
              icon={<Lock />}
              hint={signingUp ? 'At least 8 characters.' : undefined}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-full text-ink-400 hover:text-ink-900"
                >
                  {showPassword ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
                </button>
              }
            >
              <input
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={signingUp ? 'new-password' : 'current-password'}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`${INPUT} pr-12`}
              />
            </Field>
            {signingUp && (
              <Field label="Confirm password" icon={<Lock />}>
                <input
                  name="confirm-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className={INPUT}
                />
              </Field>
            )}

            {error && <Alert>{error}</Alert>}

            <button
              type="submit"
              disabled={submitting || incomplete}
              className="mt-1 flex h-12 items-center justify-center gap-2 rounded-full bg-linear-to-b from-brand-400 to-brand-600 font-semibold text-white shadow-glow transition hover:brightness-105 focus-visible:ring-4 focus-visible:ring-brand-300 focus-visible:outline-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
            >
              {submitting ? (
                <>
                  <LoaderCircle className="size-5 animate-spin" aria-hidden />
                  {copy.busy}
                </>
              ) : (
                <>
                  {copy.submit}
                  <ArrowRight className="size-[18px]" aria-hidden />
                </>
              )}
            </button>
          </form>
        </Card>
        {!options.signup_enabled && (
          <p className="mt-5 text-center text-xs text-ink-400">New accounts are created by the administrator of this app.</p>
        )}
      </main>
    </div>
  )
}

function ProviderButton({ provider, signingUp }: { provider: OAuthProvider; signingUp: boolean }) {
  const [redirecting, setRedirecting] = useState(false)

  // Coming back with the browser's Back button restores this page as it was; drop the spinner.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => event.persisted && setRedirecting(false)
    window.addEventListener('pageshow', reset)
    return () => window.removeEventListener('pageshow', reset)
  }, [])
  return (
    <a
      href={oauthStartUrl(provider.id)}
      onClick={() => setRedirecting(true)}
      className="flex h-12 items-center justify-center gap-3 rounded-full bg-white font-semibold text-ink-900 shadow-sm ring-1 ring-brand-100 transition hover:bg-brand-50/60 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none"
    >
      {redirecting ? <LoaderCircle className="size-5 animate-spin text-ink-400" aria-hidden /> : <ProviderLogo id={provider.id} />}
      {signingUp ? `Sign up with ${provider.name}` : `Continue with ${provider.name}`}
    </a>
  )
}

function ProviderLogo({ id }: { id: string }) {
  if (id === 'google') {
    return (
      <svg viewBox="0 0 48 48" className="size-5" aria-hidden>
        <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
        <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
        <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
        <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
      </svg>
    )
  }
  if (id === 'github') {
    return (
      <svg viewBox="0 0 24 24" className="size-5 text-ink-900" fill="currentColor" aria-hidden>
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
    )
  }
  return null
}

const INPUT =
  'h-12 w-full rounded-full bg-white pl-11 pr-4 text-[15px] text-ink-900 ring-1 ring-brand-100 placeholder:text-ink-400 focus:ring-2 focus:ring-brand-300 focus:outline-none'

function Field({
  label,
  icon,
  hint,
  trailing,
  children,
}: {
  label: string
  icon: ReactNode
  hint?: string
  trailing?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-1 text-sm font-semibold text-ink-700">{label}</span>
      <span className="relative block">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-brand-500 [&>svg]:size-[18px]" aria-hidden>
          {icon}
        </span>
        {children}
        {trailing}
      </span>
      {hint && <span className="mt-1.5 block px-1 text-xs text-ink-500">{hint}</span>}
    </label>
  )
}
