// Overlay motion (spec 2026-10-04 §2) — was the last action a key or a pointer press?
// An overlay opened or closed from the keyboard must not animate (it is done hundreds of times a
// day). The answer lives on <html> as `data-input`, so CSS can read it
// (`:root[data-input='keyboard'] … { transition: none }`) and so can usePresentValue at close time.
// Capture phase on window: a handler that stops propagation (xterm, a menu's Escape) cannot hide it.
export type InputKind = 'keyboard' | 'pointer'

export function lastInput(): InputKind | null {
  const v = document.documentElement.dataset.input
  return v === 'keyboard' || v === 'pointer' ? v : null
}

export function installInputModality(): () => void {
  const root = document.documentElement
  const onKey = (): void => {
    root.dataset.input = 'keyboard'
  }
  const onPointer = (): void => {
    root.dataset.input = 'pointer'
  }
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('pointerdown', onPointer, true)
  return () => {
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('pointerdown', onPointer, true)
    delete root.dataset.input
  }
}
