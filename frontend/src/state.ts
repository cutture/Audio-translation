import type { AudioClip, HistoryEntry, Transcription } from './types'

export type Async<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: string }

export interface State {
  clip: AudioClip | null
  /** Transcription of the clip, including its detected language. */
  detection: Async<Transcription>
  /** The finished translation, as saved to history. */
  translation: Async<HistoryEntry>
  /** Target language code. */
  target: string | null
  /** Explains why the target language was changed automatically. */
  notice: string | null
}

export type Action =
  | { type: 'clipAdded'; clip: AudioClip }
  | { type: 'clipRemoved' }
  | { type: 'targetChanged'; code: string | null }
  | { type: 'detectionStarted'; clipId: number }
  | { type: 'detectionSucceeded'; clipId: number; data: Transcription }
  | { type: 'detectionFailed'; clipId: number; error: string }
  | { type: 'translationStarted'; clipId: number }
  | { type: 'translationSucceeded'; clipId: number; data: HistoryEntry }
  | { type: 'translationFailed'; clipId: number; error: string }

const IDLE = { status: 'idle' } as const

export function createInitialState(target: string | null): State {
  return { clip: null, detection: IDLE, translation: IDLE, target, notice: null }
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'clipAdded':
      return { ...state, clip: action.clip, detection: IDLE, translation: IDLE, notice: null }
    case 'clipRemoved':
      return { ...state, clip: null, detection: IDLE, translation: IDLE, notice: null }
    case 'targetChanged':
      return { ...state, target: action.code, notice: null }
  }

  // Ignore responses that belong to audio the user has since replaced or removed.
  if (action.clipId !== state.clip?.id) return state

  switch (action.type) {
    case 'detectionStarted':
      return { ...state, detection: { status: 'loading' }, translation: IDLE }
    case 'detectionSucceeded': {
      const detected = action.data.detected_language
      // Translating into the language the audio is already in is pointless, so clear the clash.
      const clash = detected?.code != null && detected.code === state.target
      return {
        ...state,
        detection: { status: 'success', data: action.data },
        target: clash ? null : state.target,
        notice: clash ? `Your audio is already in ${detected.name}, so pick a different language to translate into.` : null,
      }
    }
    case 'detectionFailed':
      return { ...state, detection: { status: 'error', error: action.error } }
    case 'translationStarted':
      return { ...state, translation: { status: 'loading' } }
    case 'translationSucceeded':
      return { ...state, translation: { status: 'success', data: action.data } }
    case 'translationFailed':
      return { ...state, translation: { status: 'error', error: action.error } }
  }
}
