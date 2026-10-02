import { useSyncExternalStore } from 'react'

/**
 * One audio player for the whole app, so starting one translation stops any other.
 * Each translation is identified by a key; components read its state with usePlayback.
 */
export type PlaybackStatus = 'idle' | 'loading' | 'playing' | 'paused'

export interface Playback {
  status: PlaybackStatus
  /** Seconds. */
  position: number
  /** Seconds, once known. */
  duration: number | null
}

interface Snapshot extends Playback {
  key: string | null
}

const IDLE: Snapshot = { key: null, status: 'idle', position: 0, duration: null }
const listeners = new Set<() => void>()
// Remembered so a translation still shows its length after another one has played.
const knownDurations = new Map<string, number>()
const mountedPlayers = new Map<string, number>()
let snapshot: Snapshot = IDLE
let generation = 0
let element: HTMLAudioElement | null = null

function update(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch }
  listeners.forEach((listener) => listener())
}

const isLoaded = () => snapshot.status === 'playing' || snapshot.status === 'paused'

function audioElement(): HTMLAudioElement {
  if (!element) {
    const audio = new Audio()
    audio.addEventListener('timeupdate', () => {
      if (isLoaded()) update({ position: audio.currentTime })
    })
    audio.addEventListener('durationchange', () => {
      if (!snapshot.key || !Number.isFinite(audio.duration)) return
      knownDurations.set(snapshot.key, audio.duration)
      update({ duration: audio.duration })
    })
    audio.addEventListener('ended', () => {
      audio.currentTime = 0
      update({ status: 'paused', position: 0 })
    })
    // Paused or resumed from outside the app, e.g. by a hardware media key.
    audio.addEventListener('pause', () => {
      if (snapshot.status === 'playing') update({ status: 'paused' })
    })
    audio.addEventListener('play', () => {
      if (snapshot.status === 'paused') update({ status: 'playing' })
    })
    element = audio
  }
  return element
}

async function start(key: string, resolveUrl: () => Promise<string>) {
  const audio = audioElement()
  const current = ++generation
  audio.pause()
  snapshot = { key, status: 'loading', position: 0, duration: knownDurations.get(key) ?? null }
  update({})
  try {
    const url = await resolveUrl()
    if (current !== generation) return
    audio.src = url
    await audio.play()
    if (current === generation) update({ status: 'playing' })
  } catch (err) {
    // Superseded requests (another play or a stop) fail quietly.
    if (current !== generation) return
    snapshot = IDLE
    update({})
    throw err
  }
}

export const player = {
  /** Play, pause or resume `key`. `resolveUrl` may generate the audio on first play. */
  async toggle(key: string, resolveUrl: () => Promise<string>): Promise<void> {
    if (snapshot.key !== key || snapshot.status === 'idle') return start(key, resolveUrl)
    const audio = audioElement()
    if (snapshot.status === 'loading') {
      player.stop(key)
    } else if (snapshot.status === 'playing') {
      audio.pause()
      update({ status: 'paused' })
    } else {
      await audio.play()
      update({ status: 'playing' })
    }
  },

  seek(key: string, seconds: number) {
    if (snapshot.key !== key || !isLoaded()) return
    audioElement().currentTime = seconds
    update({ position: seconds })
  },

  /** Stops playback, or only if `key` is what's loaded. */
  stop(key?: string) {
    if (key !== undefined && snapshot.key !== key) return
    generation++
    element?.pause()
    snapshot = IDLE
    update({})
  },

  /**
   * Registers a visible player for `key`; returns a release function. When the last
   * player for a key goes away (e.g. the history panel closes), its audio stops.
   */
  retain(key: string): () => void {
    mountedPlayers.set(key, (mountedPlayers.get(key) ?? 0) + 1)
    return () => {
      const remaining = (mountedPlayers.get(key) ?? 1) - 1
      if (remaining > 0) {
        mountedPlayers.set(key, remaining)
      } else {
        mountedPlayers.delete(key)
        player.stop(key)
      }
    }
  },
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePlayback(key: string): Playback {
  const current = useSyncExternalStore(subscribe, () => snapshot)
  if (current.key === key) return current
  return { status: 'idle', position: 0, duration: knownDurations.get(key) ?? null }
}
