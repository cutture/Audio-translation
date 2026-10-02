import { LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { SESSION_EXPIRED_EVENT, errorMessage, fetchSession, isAbortError, signOut } from '../api'
import App from '../App'
import { setHistoryOwner } from '../lib/historyDb'
import { player } from '../lib/player'
import { forgetAllSpeech } from '../lib/speech'
import type { SessionInfo, User } from '../types'
import { AuthPage, type AuthNotice } from './AuthPage'
import { Alert, RetryButton } from './ui'

type AuthState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'signed-out'; options: Omit<SessionInfo, 'user'> }
  | { status: 'signed-in'; user: User }

// Set by the server when a Google/GitHub sign-in comes back without a session.
const PROVIDER_ERRORS: Record<string, string> = {
  oauth_cancelled: 'Sign-in was cancelled.',
  oauth_failed: 'We couldn’t sign you in with that account. Please try again.',
  oauth_unavailable: 'That sign-in method isn’t available.',
  signup_disabled: 'No account is linked to that sign-in, and new accounts can only be created by the administrator.',
}

function takeProviderError(): AuthNotice | null {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('auth_error')
  if (!code) return null
  url.searchParams.delete('auth_error')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  return { tone: 'error', message: PROVIDER_ERRORS[code] ?? PROVIDER_ERRORS.oauth_failed }
}

/** Shows the sign-in / sign-up page until there is a session, then the translator. */
export function AuthGate() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [notice, setNotice] = useState<AuthNotice | null>(takeProviderError)
  const [attempt, setAttempt] = useState(0)
  const signedIn = useRef(false)

  const enter = useCallback((user: User) => {
    signedIn.current = true
    setHistoryOwner(user.username)
    setNotice(null)
    setAuth({ status: 'signed-in', user })
  }, [])

  const leave = useCallback((message: string | null) => {
    player.stop()
    forgetAllSpeech()
    setHistoryOwner(null)
    // Only tell someone their session ended if they were actually signed in.
    if (signedIn.current) setNotice(message ? { tone: 'warning', message } : null)
    signedIn.current = false
    setAuth({ status: 'loading' })
    setAttempt((n) => n + 1) // reload the sign-in options
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchSession(controller.signal)
      .then(({ user, ...options }) => {
        if (user) enter(user)
        else setAuth({ status: 'signed-out', options })
      })
      .catch((err) => {
        if (!isAbortError(err)) setAuth({ status: 'error', error: errorMessage(err) })
      })
    return () => controller.abort()
  }, [attempt, enter])

  // Any API call rejected with 401 (expired session, changed password, deleted account).
  useEffect(() => {
    const onExpired = () => leave('Your session has ended. Please sign in again.')
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [leave])

  const handleSignOut = async () => {
    try {
      await signOut()
    } catch {
      // Offline: still leave locally; the cookie expires on its own.
    }
    leave(null)
  }

  switch (auth.status) {
    case 'loading':
      return (
        <div className="grid min-h-dvh place-items-center">
          <p className="flex items-center gap-2.5 text-sm text-ink-500">
            <LoaderCircle className="size-5 animate-spin text-brand-500" aria-hidden />
            Loading…
          </p>
        </div>
      )
    case 'error':
      return (
        <div className="mx-auto grid min-h-dvh max-w-md place-items-center px-4">
          <Alert
            action={
              <RetryButton
                onClick={() => {
                  setAuth({ status: 'loading' })
                  setAttempt((n) => n + 1)
                }}
              />
            }
          >
            {auth.error}
          </Alert>
        </div>
      )
    case 'signed-out':
      return <AuthPage options={auth.options} notice={notice} onSignedIn={enter} />
    case 'signed-in':
      // Keyed so nothing from one account's session carries over to the next.
      return <App key={auth.user.username} user={auth.user} onSignOut={handleSignOut} />
  }
}
