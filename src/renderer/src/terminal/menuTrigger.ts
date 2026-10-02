// Which right-click opens the terminal Copy/Paste menu (Settings → Terminal). Plain right-click
// (the default) opens it whatever modifier is held, as it always did; a modifier choice needs
// exactly that modifier, so claude's own right-click paste no longer opens the menu too.
import type { TerminalMenuTrigger } from '../../../shared/schemas/settings'

export function opensTerminalMenu(
  trigger: TerminalMenuTrigger,
  e: Pick<MouseEvent, 'shiftKey' | 'ctrlKey'>
): boolean {
  switch (trigger) {
    case 'right-click':
      return true
    case 'shift-right-click':
      return e.shiftKey && !e.ctrlKey
    case 'ctrl-right-click':
      return e.ctrlKey && !e.shiftKey
  }
}
