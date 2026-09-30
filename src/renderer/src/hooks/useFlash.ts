// Action feedback (spec 2026-09-29 §1.4) — a value that shows for a moment and clears itself: the
// `✓ Copied` on a Button's `feedback`, Settings' `✓ Saved` mark. A second flash restarts the
// clock; unmount clears it, so nothing sets state on a component that is gone.
import { useCallback, useEffect, useRef, useState } from 'react'

export const FLASH_MS = 1500

export function useFlash<T>(ms: number = FLASH_MS): [T | null, (value: T) => void] {
  const [value, setValue] = useState<T | null>(null)
  // One box per hook. The cleanup reads it through a local captured in the effect body — never
  // `ref.current` inside a cleanup (react-hooks/exhaustive-deps).
  const timer = useRef<{ handle: ReturnType<typeof setTimeout> | null }>({ handle: null })

  useEffect(() => {
    const box = timer.current
    return () => {
      if (box.handle !== null) clearTimeout(box.handle)
      box.handle = null
    }
  }, [])

  const flash = useCallback(
    (next: T): void => {
      const box = timer.current
      if (box.handle !== null) clearTimeout(box.handle)
      setValue(next)
      box.handle = setTimeout(() => {
        box.handle = null
        setValue(null)
      }, ms)
    },
    [ms]
  )

  return [value, flash]
}
