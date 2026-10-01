import type { AppConfig, SharedTranslation, Transcription, TranslationResult } from './types'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(message: string, status: number, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.'
}

/** Fetch and turn transport failures and JSON error bodies into ApiErrors. */
async function send(url: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new ApiError('Could not reach the server. Make sure the backend is running.', 0, 'network_error')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    throw new ApiError(
      body?.error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      body?.error?.code ?? 'http_error',
    )
  }
  return response
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return (await send(url, init)).json() as Promise<T>
}

function postJson(body: unknown, signal?: AbortSignal): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal }
}

export function fetchConfig(signal?: AbortSignal) {
  return request<AppConfig>('/api/config', { signal })
}

export function transcribeAudio(file: File, signal?: AbortSignal) {
  const form = new FormData()
  form.append('file', file, file.name)
  return request<Transcription>('/api/transcribe', { method: 'POST', body: form, signal })
}

export function translateText(
  input: { text: string; sourceLanguage: string | null; targetLanguage: string },
  signal?: AbortSignal,
) {
  return request<TranslationResult>(
    '/api/translate',
    postJson({ text: input.text, source_language: input.sourceLanguage, target_language: input.targetLanguage }, signal),
  )
}

/** Returns MP3 audio of the text read aloud. */
export async function synthesizeSpeech(text: string, language: string): Promise<Blob> {
  return (await send('/api/speech', postJson({ text, language }))).blob()
}

export function createShare(input: {
  transcript: string
  translation: string
  sourceLanguage: string | null
  targetLanguage: string
}) {
  return request<{ id: string; url: string }>(
    '/api/shares',
    postJson({
      transcript: input.transcript,
      translation: input.translation,
      source_language: input.sourceLanguage,
      target_language: input.targetLanguage,
    }),
  )
}

export function fetchShare(id: string, signal?: AbortSignal) {
  return request<SharedTranslation>(`/api/shares/${encodeURIComponent(id)}`, { signal })
}
