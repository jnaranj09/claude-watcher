import { describe, expect, it, vi } from 'vitest'
import { openThemesFolder } from './openThemesFolder'

const DIR = '/home/someone/.config/claude-watcher/themes'

describe('openThemesFolder', () => {
  it('returns without waiting for the opener (Electron 39 never settles openPath on Linux)', () => {
    const openPath = vi.fn(() => new Promise<string>(() => {}))
    const mkdir = vi.fn()
    // Synchronous on purpose: the IPC handler must answer at once. An awaited openPath that never
    // settles left the invoke pending until its reply channel was collected (~30 s), and the
    // renderer then showed "Could not open the themes folder." over a folder that had opened.
    expect(openThemesFolder(DIR, { mkdir, openPath, log: vi.fn() })).toBeUndefined()
    expect(mkdir).toHaveBeenCalledWith(DIR)
    expect(openPath).toHaveBeenCalledWith(DIR)
  })

  it('logs a code, never the path, when the opener reports a problem', async () => {
    const log = vi.fn()
    openThemesFolder(DIR, {
      mkdir: vi.fn(),
      openPath: () => Promise.resolve(`Failed to open ${DIR}`),
      log
    })
    await vi.waitFor(() => expect(log).toHaveBeenCalled())
    expect(log).toHaveBeenCalledWith('[claude-watcher][themes] code=themes_open_folder_failed')
    expect(JSON.stringify(log.mock.calls)).not.toContain(DIR)
  })

  it('logs a code when the opener rejects', async () => {
    const log = vi.fn()
    openThemesFolder(DIR, {
      mkdir: vi.fn(),
      openPath: () => Promise.reject(new Error(`ENOENT ${DIR}`)),
      log
    })
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith('[claude-watcher][themes] code=themes_open_folder_failed')
    )
    expect(JSON.stringify(log.mock.calls)).not.toContain(DIR)
  })

  it('does not open, and logs a code only, when the folder cannot be created', () => {
    const log = vi.fn()
    const openPath = vi.fn(() => Promise.resolve(''))
    openThemesFolder(DIR, {
      mkdir: () => {
        throw new Error(`EACCES ${DIR}`)
      },
      openPath,
      log
    })
    expect(openPath).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      '[claude-watcher][themes] code=themes_open_folder_mkdir_failed'
    )
    expect(JSON.stringify(log.mock.calls)).not.toContain(DIR)
  })
})
