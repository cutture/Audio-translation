import type { ReactNode } from 'react'
import { IconTile } from './ui'

export interface StatTile {
  icon: ReactNode
  label: string
  value: string
}

export function StatTiles({ tiles, className = '' }: { tiles: StatTile[]; className?: string }) {
  return (
    <dl className={`grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 ${className}`}>
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="flex flex-col rounded-3xl border border-white/80 bg-white/65 p-4 shadow-card backdrop-blur-xl sm:p-5"
        >
          <IconTile className="size-10">{tile.icon}</IconTile>
          <dt className="order-last truncate text-sm text-ink-500">{tile.label}</dt>
          <dd className="mt-4 truncate text-lg font-bold text-ink-900">{tile.value}</dd>
        </div>
      ))}
    </dl>
  )
}
