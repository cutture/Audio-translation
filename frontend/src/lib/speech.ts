import { synthesizeSpeech } from '../api'
import type { HistoryEntry } from '../types'
import { historyDb } from './historyDb'

/**
 * Spoken audio for history entries. Generated once by the server, then kept in
 * memory and IndexedDB so replaying or downloading never pays for it twice.
 */
const blobs = new Map<string, Blob>()
const urls = new Map<string, string>()
const pending = new Map<string, Promise<Blob>>()

type Speakable = Pick<HistoryEntry, 'id' | 'translation' | 'target'>

export function getSpeech(entry: Speakable): Promise<Blob> {
  const cached = blobs.get(entry.id)
  if (cached) return Promise.resolve(cached)

  let promise = pending.get(entry.id)
  if (!promise) {
    promise = (async () => {
      const stored = await historyDb.getSpeech(entry.id).catch(() => undefined)
      const audio = stored ?? (await synthesizeSpeech(entry.translation, entry.target.code))
      if (!stored) historyDb.saveSpeech(entry.id, audio).catch(() => {})
      blobs.set(entry.id, audio)
      return audio
    })().finally(() => pending.delete(entry.id))
    pending.set(entry.id, promise)
  }
  return promise
}

export async function getSpeechUrl(entry: Speakable): Promise<string> {
  const audio = await getSpeech(entry)
  let url = urls.get(entry.id)
  if (!url) {
    url = URL.createObjectURL(audio)
    urls.set(entry.id, url)
  }
  return url
}

/** Drop the in-memory copy (the caller removes the stored one). */
export function forgetSpeech(id: string) {
  blobs.delete(id)
  const url = urls.get(id)
  if (url) URL.revokeObjectURL(url)
  urls.delete(id)
}

/** Drop every in-memory copy, e.g. when the user signs out. */
export function forgetAllSpeech() {
  for (const id of [...urls.keys()]) forgetSpeech(id)
  blobs.clear()
  pending.clear()
}
