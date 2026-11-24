// Security audit finding `contextHandlers.ts:restore:symlink-follow-write`: History and Restore
// gate the reported path's TEXT (`isInstructionPath`), so a reported `.md` that is a link out to
// another file must not be read into history or written by Restore. Fault: a write or read that
// follows the link to a file that is not an absolute `.md`, or blocks on a FIFO.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeContextFs } from './contextHandlers'
import { nodeFileHistoryFs } from './fileHistory'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-restore-link-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('Context Restore and History with links', () => {
  it('Restore through a .md link to a non-.md file rejects and leaves the target untouched', async () => {
    writeFileSync(join(dir, 'bashrc'), 'operator shell\n')
    symlinkSync(join(dir, 'bashrc'), join(dir, 'CLAUDE.md'))
    await expect(
      nodeContextFs.writeFile(join(dir, 'CLAUDE.md'), Buffer.from('x'))
    ).rejects.toThrow()
    expect(readFileSync(join(dir, 'bashrc'), 'utf8')).toBe('operator shell\n')
  })

  it('Restore through a .md link to another .md file writes that file', async () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'old\n')
    symlinkSync(join(dir, 'AGENTS.md'), join(dir, 'CLAUDE.md'))
    await nodeContextFs.writeFile(join(dir, 'CLAUDE.md'), Buffer.from('new\n'))
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('new\n')
  })

  it('Restore of a missing file creates it, and a dangling link there rejects', async () => {
    await nodeContextFs.writeFile(join(dir, 'NEW.md'), Buffer.from('made\n'))
    expect(readFileSync(join(dir, 'NEW.md'), 'utf8')).toBe('made\n')
    symlinkSync(join(dir, 'elsewhere'), join(dir, 'DANGLING.md'))
    await expect(
      nodeContextFs.writeFile(join(dir, 'DANGLING.md'), Buffer.from('x'))
    ).rejects.toThrow()
  })

  it('History does not read a .md link that points to a non-.md file', async () => {
    writeFileSync(join(dir, 'secret.txt'), 'token\n')
    symlinkSync(join(dir, 'secret.txt'), join(dir, 'CLAUDE.md'))
    expect(await nodeFileHistoryFs.readOperatorFile(join(dir, 'CLAUDE.md'), 100)).toEqual({
      ok: false,
      reason: 'not_file'
    })
  })

  it.skipIf(process.platform === 'win32')(
    'a FIFO named .md is refused without blocking',
    async () => {
      execFileSync('mkfifo', [join(dir, 'PIPE.md')])
      expect(await nodeFileHistoryFs.readOperatorFile(join(dir, 'PIPE.md'), 100)).toEqual({
        ok: false,
        reason: 'not_file'
      })
      await expect(
        nodeContextFs.writeFile(join(dir, 'PIPE.md'), Buffer.from('x'))
      ).rejects.toThrow()
    }
  )
})
