import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { ChevronDown, LogOut } from 'lucide-react'
import type { User } from '../types'

export function UserMenu({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  return (
    <Menu>
      <MenuButton
        aria-label={`Account menu for ${user.username}`}
        className="inline-flex h-10 items-center gap-2 rounded-full bg-white/80 pr-2 pl-1 text-sm font-semibold text-ink-700 shadow-sm ring-1 ring-white transition hover:bg-white hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:outline-none sm:pr-3"
      >
        <span className="grid size-8 place-items-center rounded-full bg-linear-to-b from-brand-400 to-brand-600 text-sm font-bold text-white uppercase">
          {user.username[0]}
        </span>
        <span className="hidden max-w-28 truncate sm:inline">{user.username}</span>
        <ChevronDown className="size-4 text-ink-400" aria-hidden />
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        transition
        className="z-50 w-56 rounded-2xl border border-white bg-white/95 p-1.5 shadow-xl shadow-brand-900/10 backdrop-blur-xl transition duration-150 ease-out [--anchor-gap:8px] focus:outline-none data-closed:-translate-y-1 data-closed:opacity-0"
      >
        <div className="px-3 py-2">
          <p className="text-xs text-ink-500">Signed in as</p>
          <p className="truncate font-semibold text-ink-900">{user.username}</p>
        </div>
        <div className="mx-2 my-1 h-px bg-brand-100" />
        <MenuItem>
          <button
            type="button"
            onClick={onSignOut}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-ink-700 data-focus:bg-brand-50"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  )
}
