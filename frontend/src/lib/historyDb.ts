import type { HistoryEntry } from '../types'

/**
 * IndexedDB storage for translation history and its spoken audio. Everything stays
 * in this browser, in a separate database per signed-in user; callers treat failures
 * (e.g. storage disabled, nobody signed in) as non-fatal.
 */
const DB_NAME_PREFIX = 'audio-translator'
const DB_VERSION = 1
const ENTRIES = 'entries'
const SPEECH = 'speech' // MP3 blobs keyed by entry id

let owner: string | null = null
let opening: Promise<IDBDatabase> | null = null

/** Point history at the signed-in user's database (null when signed out). */
export function setHistoryOwner(username: string | null) {
  const next = username?.toLowerCase() ?? null // usernames are case-insensitive
  if (next === owner) return
  owner = next
  const previous = opening
  opening = null
  previous?.then((db) => db.close(), () => {})
}

function openDb(): Promise<IDBDatabase> {
  if (!owner) return Promise.reject(new Error('Nobody is signed in.'))
  if (!opening) {
    const name = `${DB_NAME_PREFIX}:${owner}`
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(ENTRIES)) db.createObjectStore(ENTRIES, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(SPEECH)) db.createObjectStore(SPEECH)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    promise.catch(() => {
      if (opening === promise) opening = null // allow a later retry
    })
    opening = promise
  }
  return opening
}

async function transact<T>(
  stores: string[],
  mode: IDBTransactionMode,
  work: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    const request = work(tx)
    tx.oncomplete = () => resolve(request ? request.result : undefined)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export const historyDb = {
  async list(): Promise<HistoryEntry[]> {
    return (await transact<HistoryEntry[]>([ENTRIES], 'readonly', (tx) => tx.objectStore(ENTRIES).getAll())) ?? []
  },
  async save(entry: HistoryEntry): Promise<void> {
    await transact([ENTRIES], 'readwrite', (tx) => {
      tx.objectStore(ENTRIES).put(entry)
    })
  },
  async remove(ids: string[]): Promise<void> {
    await transact([ENTRIES, SPEECH], 'readwrite', (tx) => {
      for (const id of ids) {
        tx.objectStore(ENTRIES).delete(id)
        tx.objectStore(SPEECH).delete(id)
      }
    })
  },
  async clear(): Promise<void> {
    await transact([ENTRIES, SPEECH], 'readwrite', (tx) => {
      tx.objectStore(ENTRIES).clear()
      tx.objectStore(SPEECH).clear()
    })
  },
  getSpeech(id: string): Promise<Blob | undefined> {
    return transact<Blob>([SPEECH], 'readonly', (tx) => tx.objectStore(SPEECH).get(id))
  },
  async saveSpeech(id: string, audio: Blob): Promise<void> {
    await transact([SPEECH], 'readwrite', (tx) => {
      tx.objectStore(SPEECH).put(audio, id)
    })
  },
  async speechIds(): Promise<string[]> {
    const keys = await transact<IDBValidKey[]>([SPEECH], 'readonly', (tx) => tx.objectStore(SPEECH).getAllKeys())
    return (keys ?? []).map(String)
  },
}
