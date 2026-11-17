// The app's one extractor, built from what main holds (memory phase 2, Task 11): every input is an
// injected function, so index.ts only hands over Node's and Electron's own functions and its
// getters, and a `main-unit` test reaches the whole wiring (the call, the kill, the version check,
// the start's catch-up). Every input is read when a save point or a job needs it, so the extractor
// is safe before memory opens, under SMOKE (memory never opens) and after the quit closed it.
import type { Settings } from '../../../shared/schemas/settings'
import type { TranscriptLookupDeps } from '../../pty/claudeTranscript'
import type { OpenedMemory } from '../memoryStartup'
import { createExtractor, type Extractor, type ExtractorDeps } from './extractor'
import {
  createExtractCall,
  createExtractVersionGate,
  createTimerPair,
  extractSources
} from './extractWiring'
import type { SpawnSeam } from './headlessClaude'

const LOG_PREFIX = '[claude-watcher][memory]'

type CallDeps = Parameters<typeof createExtractCall>[0]

export interface AppExtractorIo {
  /** The live settings (Memory on, checkpoint, tasks, model). */
  settings: () => Pick<
    Settings,
    'memoryEnabled' | 'memoryCheckpoint' | 'memorySaveTasks' | 'memoryModel'
  >
  memory: () => Pick<OpenedMemory, 'store' | 'commands' | 'extractState'> | null
  goals: ExtractorDeps['goals']
  pastSessions: ExtractorDeps['pastSessions']
  sessionMeta: ExtractorDeps['sessionMeta']
  activity: ExtractorDeps['activity']
  /** Where a save's result goes: index.ts hands it to the hold (ipc/extractResultPush.ts), which
   *  sends it to every ready window or keeps it until one is ready. */
  push: ExtractorDeps['push']
  /** claude's projects folder on disk (`transcriptLookupDepsFromFs`). */
  lookup: () => TranscriptLookupDeps
  /** A transcript file's size (`statSync(p).size`), null when it cannot be read: a yes/no read. */
  fileSize: ExtractorDeps['size']
  readSlice: ExtractorDeps['read']
  /** `claude --version` (R35, R37): `read` probes (and keeps the answer for the launch path too);
   *  `held` is what this run's launch path last read, undefined before any. */
  version: { read: () => string | null; held: () => string | null | undefined }
  shell: string
  userData: () => string
  /** The sessions' base env (`buildPtyEnv`). */
  ptyEnv: () => Record<string, string>
  /** claude on disk, from that env (`resolveClaudeOnDisk`). */
  resolveClaude: (env: Record<string, string>) => { command: string; dir: string | null }
  spawn: SpawnSeam
  /** `process.kill`, given the negated process-group id unchanged. */
  kill: CallDeps['kill']
  /** `mkdirSync`, called with `{ recursive: true, mode: 0o700 }` (R36). */
  mkdir: CallDeps['mkdir']
  now: () => number
  log: (line: string) => void
}

export interface AppExtractor {
  extractor: Extractor
  /** The start's catch-up (D24, R22): once, and only when the goals and past-sessions stores
   *  exist (a task candidate with no goals store is lost for good). With memory not open it does
   *  nothing (the extractor's own check). A second call does nothing. */
  start(): void
}

export function createAppExtractor(io: AppExtractorIo): AppExtractor {
  const extractor = createExtractor({
    enabled: () => io.settings().memoryEnabled,
    checkpoint: () => io.settings().memoryCheckpoint,
    tasksOn: () => io.settings().memorySaveTasks,
    model: () => io.settings().memoryModel,
    ...extractSources({ memory: io.memory, lookup: io.lookup }),
    goals: io.goals,
    pastSessions: io.pastSessions,
    sessionMeta: io.sessionMeta,
    size: io.fileSize,
    read: io.readSlice,
    // R35, R37: an OK answer is kept for the run, and the launch path's answer is reused; only a
    // job asks (never a hook, never window creation).
    versionOk: createExtractVersionGate(io.version.read, io.version.held),
    call: createExtractCall({
      shell: io.shell,
      userData: io.userData,
      env: io.ptyEnv,
      resolveClaude: () => io.resolveClaude(io.ptyEnv()),
      spawn: io.spawn,
      kill: io.kill,
      mkdir: io.mkdir,
      ...createTimerPair()
    }),
    activity: io.activity,
    push: io.push,
    now: io.now,
    log: io.log
  })
  let started = false
  return {
    extractor,
    start() {
      if (started) return
      if (io.goals() === null || io.pastSessions() === null) {
        io.log(`${LOG_PREFIX} code=memory_catchup_not_ready`)
        return
      }
      started = true
      extractor.catchUp()
    }
  }
}
