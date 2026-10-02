import { formatBytes } from './format'

/** Formats accepted by the OpenAI transcription API (mirrors the backend). */
const EXTENSIONS = ['.mp3', '.wav', '.m4a', '.mp4', '.webm', '.ogg', '.oga', '.flac', '.mpeg', '.mpga']

export const ACCEPT_ATTRIBUTE = ['audio/*', ...EXTENSIONS].join(',')

export function validateAudioFile(file: File, maxBytes: number): string | null {
  const dot = file.name.lastIndexOf('.')
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
  if (!EXTENSIONS.includes(extension) && !file.type.startsWith('audio/')) {
    return 'Unsupported file type. Use MP3, WAV, M4A, MP4, WEBM, OGG or FLAC.'
  }
  if (file.size === 0) return 'This file is empty.'
  if (file.size > maxBytes) {
    return `This file is ${formatBytes(file.size)}; the limit is ${formatBytes(maxBytes)}.`
  }
  return null
}
