// The window's renderer-loaded hook (ruling R38): memory's held save results reach the renderer
// only through `rendererLoaded`, so the window must call it on its own webContents'
// `did-finish-load`, and on no other event. `electron` is mocked (a process edge) with a fake
// BrowserWindow that records its handlers.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateWindowDeps } from './createWindow'

const fake = vi.hoisted(() => {
  class FakeWebContents {
    readonly handlers = new Map<string, ((...args: unknown[]) => void)[]>()
    once(event: string, fn: (...args: unknown[]) => void): void {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn])
    }
    readonly setWindowOpenHandler = vi.fn()
    readonly on = vi.fn()
    getURL(): string {
      return 'file:///app/index.html'
    }
  }
  class FakeWindow {
    static all: FakeWindow[] = []
    destroyed = false
    readonly windowOn = new Map<string, ((...args: unknown[]) => void)[]>()
    readonly webContents = new FakeWebContents()
    constructor() {
      FakeWindow.all.push(this)
    }
    on(event: string, fn: (...args: unknown[]) => void): void {
      this.windowOn.set(event, [...(this.windowOn.get(event) ?? []), fn])
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    isVisible(): boolean {
      return false
    }
    isMaximized(): boolean {
      return false
    }
    isMinimized(): boolean {
      return false
    }
    readonly show = vi.fn()
    readonly maximize = vi.fn()
    readonly setTitle = vi.fn()
    loadFile(): Promise<void> {
      return Promise.resolve()
    }
    loadURL(): Promise<void> {
      return Promise.resolve()
    }
  }
  return { FakeWindow }
})

vi.mock('electron', () => ({ BrowserWindow: fake.FakeWindow }))

const { makeCreateWindow } = await import('./createWindow')

let rendererLoaded: ReturnType<typeof vi.fn<(wc: Electron.WebContents) => void>>
let createWindow: () => void

beforeEach(() => {
  fake.FakeWindow.all = []
  rendererLoaded = vi.fn<(wc: Electron.WebContents) => void>()
  const deps = {
    smoke: true,
    icon: '/app/icon.png',
    preloadPath: '/app/preload.js',
    rendererSource: { kind: 'file', path: '/app/index.html' },
    quitGuardState: { isQuitting: false },
    externalLinks: { open: vi.fn() },
    ptys: new Map(),
    getSettingsStore: () => null,
    getApiLifecycle: () => null,
    getThemeLifecycle: () => null,
    registerWatchFeed: vi.fn(),
    teardownWatchFeed: vi.fn(),
    teardownWindowTerminals: vi.fn(),
    rendererLoaded
  }
  createWindow = makeCreateWindow(deps as unknown as CreateWindowDeps)
})

/** The `i`th window createWindow built. */
function windowAt(i: number): InstanceType<typeof fake.FakeWindow> {
  const win = fake.FakeWindow.all[i]
  if (win === undefined) throw new Error(`no window ${i}`)
  return win
}

/** Every handler the window registered on `event` (webContents `once`, else the window's `on`). */
function fire(win: InstanceType<typeof fake.FakeWindow>, event: string): void {
  const handlers = win.webContents.handlers.get(event) ?? win.windowOn.get(event) ?? []
  for (const h of handlers) h()
}

describe("createWindow's renderer-loaded hook", () => {
  it("calls rendererLoaded once, with the window's own webContents, on did-finish-load only", () => {
    createWindow()
    createWindow()
    const first = windowAt(0)
    const second = windowAt(1)
    // Every other load-time event the window listens to first: none of them may call it.
    ;[...first.webContents.handlers.keys()]
      .filter((event) => event !== 'did-finish-load')
      .forEach((event) => fire(first, event))
    fire(first, 'ready-to-show')
    expect(rendererLoaded).not.toHaveBeenCalled()
    fire(first, 'did-finish-load')
    expect(rendererLoaded).toHaveBeenCalledTimes(1)
    expect(rendererLoaded.mock.calls[0]?.[0]).toBe(first.webContents)
    fire(second, 'did-finish-load')
    expect(rendererLoaded).toHaveBeenCalledTimes(2)
    expect(rendererLoaded.mock.calls[1]?.[0]).toBe(second.webContents)
  })

  it('calls nothing for a window destroyed before its page loaded', () => {
    createWindow()
    const win = windowAt(0)
    win.destroyed = true
    fire(win, 'did-finish-load')
    expect(rendererLoaded).not.toHaveBeenCalled()
  })
})
