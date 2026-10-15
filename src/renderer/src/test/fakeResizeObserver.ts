// A ResizeObserver a test resizes by hand. jsdom has no layout, so a real resize never fires;
// `resize(target)` runs the callback of every observer watching `target`, and nothing else.

interface Registration {
  target: Element
  cb: () => void
}

/** Install the fake on globalThis. Call `restore()` to put the previous ResizeObserver back. */
export function installFakeResizeObserver(): {
  resize: (target: Element) => void
  restore: () => void
} {
  let registrations: Registration[] = []
  class FakeResizeObserver {
    constructor(private readonly cb: () => void) {}
    observe(target: Element): void {
      registrations.push({ target, cb: this.cb })
    }
    disconnect(): void {
      registrations = registrations.filter((r) => r.cb !== this.cb)
    }
  }
  const g = globalThis as unknown as { ResizeObserver: unknown }
  const original = g.ResizeObserver
  g.ResizeObserver = FakeResizeObserver
  return {
    resize: (target) => {
      for (const r of registrations.filter((reg) => reg.target === target)) r.cb()
    },
    restore: () => {
      g.ResizeObserver = original
    }
  }
}
