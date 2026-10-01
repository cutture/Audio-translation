import { useCallback, useEffect, useRef, useState } from 'react'
import { historyDb } from '../lib/historyDb'
import { player } from '../lib/player'
import { forgetSpeech } from '../lib/speech'
import type { HistoryEntry } from '../types'

const MAX_ENTRIES = 50
const ignore = () => {}

export const entryAudioKey = (id: string) => `entry:${id}`

function discardAudio(ids: string[]) {
  for (const id of ids) {
    player.stop(entryAudioKey(id))
    forgetSpeech(id)
  }
}

/** Translation history for this browser, newest first. Works in memory if storage is unavailable. */
export function useHistory() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const entriesRef = useRef<HistoryEntry[]>([])

  const commit = useCallback((next: HistoryEntry[]) => {
    entriesRef.current = next
    setEntries(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    historyDb
      .list()
      .then(async (stored) => {
        if (cancelled) return
        // Keep anything added while the database was still loading.
        const known = new Set(entriesRef.current.map((entry) => entry.id))
        const merged = [...entriesRef.current, ...stored.filter((entry) => !known.has(entry.id))]
        merged.sort((a, b) => b.createdAt - a.createdAt)
        commit(merged)

        const live = new Set(merged.map((entry) => entry.id))
        const orphaned = (await historyDb.speechIds()).filter((id) => !live.has(id))
        if (orphaned.length) await historyDb.remove(orphaned)
      })
      .catch(ignore)
    return () => {
      cancelled = true
    }
  }, [commit])

  const add = useCallback(
    (entry: HistoryEntry) => {
      const next = [entry, ...entriesRef.current]
      const dropped = next.slice(MAX_ENTRIES).map((old) => old.id)
      commit(next.slice(0, MAX_ENTRIES))
      historyDb.save(entry).catch(ignore)
      if (dropped.length) {
        discardAudio(dropped)
        historyDb.remove(dropped).catch(ignore)
      }
    },
    [commit],
  )

  const update = useCallback(
    (id: string, patch: Partial<Omit<HistoryEntry, 'id'>>) => {
      const entry = entriesRef.current.find((candidate) => candidate.id === id)
      if (!entry) return
      const updated = { ...entry, ...patch }
      commit(entriesRef.current.map((candidate) => (candidate.id === id ? updated : candidate)))
      historyDb.save(updated).catch(ignore)
    },
    [commit],
  )

  const remove = useCallback(
    (id: string) => {
      commit(entriesRef.current.filter((entry) => entry.id !== id))
      discardAudio([id])
      historyDb.remove([id]).catch(ignore)
    },
    [commit],
  )

  const clear = useCallback(() => {
    discardAudio(entriesRef.current.map((entry) => entry.id))
    commit([])
    historyDb.clear().catch(ignore)
  }, [commit])

  return { entries, add, update, remove, clear }
}
