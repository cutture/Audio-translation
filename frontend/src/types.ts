export interface Language {
  code: string
  name: string
  native_name: string
  rtl: boolean
}

/** A language heard in the audio. `code` is null when it is outside our catalogue. */
export interface DetectedLanguage extends Omit<Language, 'code'> {
  code: string | null
  supported: boolean
}

export interface AppConfig {
  languages: Language[]
  limits: { max_upload_bytes: number; max_recording_seconds: number; max_text_chars: number; max_speech_chars: number }
  models: { transcription: string; detection: string; translation: string; speech: string }
}

export interface Transcription {
  transcript: string
  detected_language: DetectedLanguage | null
  duration: number | null
  model: string
}

export interface TranslationResult {
  translation: string
  source_language: Language | null
  target_language: Language
  model: string
  truncated: boolean
}

export interface AudioClip {
  id: number
  file: File
  url: string
  origin: 'upload' | 'recording'
  /** Known duration in seconds (recordings report it before the browser can). */
  durationHint: number | null
}

/** A completed translation, kept in this browser's history. */
export interface HistoryEntry {
  id: string
  createdAt: number
  audioName: string
  origin: AudioClip['origin']
  duration: number | null
  source: DetectedLanguage | null
  target: Language
  transcript: string
  translation: string
  model: string
  truncated: boolean
  /** Set once the translation has been shared by link. */
  shareId?: string
}

export interface SharedTranslation {
  id: string
  created_at: string
  transcript: string
  translation: string
  source_language: Language | null
  target_language: Language
  audio_url: string
}
