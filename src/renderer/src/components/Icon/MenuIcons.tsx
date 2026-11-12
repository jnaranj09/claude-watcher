// The menu row icons: ONE line set (16 grid, 1.5 stroke, 14px, round caps), inline like PinIcon —
// no icon dependency, `currentColor` follows the text ramp. Decorative: every row names itself.
// Every action row in a menu carries one of these in `Popover.ItemIcon` (design.md, "Menu rows").
// The search boxes' magnifier (`SearchIcon`) is drawn from the same set.
import type { JSX, ReactNode } from 'react'

function LineIcon({ children }: { children: ReactNode }): JSX.Element {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

/** Settings — two sliders. */
export function SlidersIcon(): JSX.Element {
  return (
    <LineIcon>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </LineIcon>
  )
}

/** Shortcuts — a keyboard. */
export function KeyboardIcon(): JSX.Element {
  return (
    <LineIcon>
      <rect x="1.5" y="3.75" width="13" height="8.5" rx="1.75" />
      <path d="M4.5 6.75h.01M7 6.75h.01M9.5 6.75h.01M12 6.75h.01M5.5 9.5h5" />
    </LineIcon>
  )
}

/** Sessions — a clock face. */
export function ClockIcon(): JSX.Element {
  return (
    <LineIcon>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </LineIcon>
  )
}

/** Active sessions, and the filter type `Session` — a terminal prompt. */
export function TerminalIcon(): JSX.Element {
  return (
    <LineIcon>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.75" />
      <path d="M4.5 6.5 6.5 8l-2 1.5M8.5 10h3" />
    </LineIcon>
  )
}

/** Past sessions — an archive box (an ended session is archived there). */
export function ArchiveIcon(): JSX.Element {
  return (
    <LineIcon>
      <rect x="1.5" y="2.5" width="13" height="3" rx="1" />
      <path d="M2.5 5.5v7a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-7M6.5 8.5h3" />
    </LineIcon>
  )
}

/** Templates — a page layout. */
export function TemplateIcon(): JSX.Element {
  return (
    <LineIcon>
      <rect x="1.5" y="1.5" width="13" height="13" rx="1.75" />
      <path d="M1.5 6h13M6.5 6v8.5" />
    </LineIcon>
  )
}

/** Import session — an arrow down into a tray. */
export function ImportIcon(): JSX.Element {
  return (
    <LineIcon>
      <path d="M8 2v8M5 7l3 3 3-3M2.5 10.5v2a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-2" />
    </LineIcon>
  )
}

/** Tag rules — a checklist. */
export function RulesIcon(): JSX.Element {
  return (
    <LineIcon>
      <path d="m2.5 4.5 1 1 2-2M2.5 10.5l1 1 2-2M8 4.5h5.5M8 10.5h5.5" />
    </LineIcon>
  )
}

/** Create — a plus. */
export function PlusIcon(): JSX.Element {
  return (
    <LineIcon>
      <path d="M8 3v10M3 8h10" />
    </LineIcon>
  )
}

/** Launched / Ended / Updated — a calendar page. */
export function CalendarIcon(): JSX.Element {
  return (
    <LineIcon>
      <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="1.75" />
      <path d="M2.25 6.75h11.5M5.5 1.75v3M10.5 1.75v3" />
    </LineIcon>
  )
}

/** Pick a folder — a folder. */
export function FolderIcon(): JSX.Element {
  return (
    <LineIcon>
      <path d="M1.5 4a1 1 0 0 1 1-1h3.4l1.6 1.6h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
    </LineIcon>
  )
}

/** The filter bar's Goal row — a flag. */
export function GoalIcon(): JSX.Element {
  return (
    <LineIcon>
      <path d="M3.5 14V2.5M3.5 3h8l-1.6 2.6L11.5 8h-8" />
    </LineIcon>
  )
}

/** The search box's magnifier: the board's filter bar and the Sessions and Memory rails. */
export function SearchIcon(): JSX.Element {
  return (
    <LineIcon>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </LineIcon>
  )
}

/** Memory — a bookmark (what sessions kept to come back to). */
export function MemoryIcon(): JSX.Element {
  return (
    <LineIcon>
      <path d="M4.5 2.5h7v11L8 11l-3.5 2.5z" />
    </LineIcon>
  )
}

/** The filter type `Session deleted` — a bin. */
export function TrashIcon(): JSX.Element {
  return (
    <LineIcon>
      <path d="M2.5 4.5h11M6.5 4.5v-2h3v2M4 4.5l.7 8.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8l.7-8.2" />
    </LineIcon>
  )
}
