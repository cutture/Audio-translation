import type { Language } from '../types'
import { formatDateTime } from './format'

export function triggerDownload(href: string, filename = '') {
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  triggerDownload(url, filename)
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function saveText(text: string, filename: string) {
  // The BOM makes older Windows editors read the file as UTF-8 (for Devanagari, Arabic, …).
  saveBlob(new Blob(['﻿', text], { type: 'text/plain;charset=utf-8' }), filename)
}

export function translationFileName(target: Language, extension: string, timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
  const slug = target.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return `translation-${slug}-${stamp}.${extension}`
}

export function translationAsText(record: {
  transcript: string
  translation: string
  source: { name: string } | null
  target: { name: string }
  createdAt: number
}): string {
  return [
    `Translated on ${formatDateTime(record.createdAt)}`,
    '',
    `Original (${record.source?.name ?? 'unknown language'})`,
    record.transcript,
    '',
    `Translation (${record.target.name})`,
    record.translation,
    '',
  ].join('\n')
}
