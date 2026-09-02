// Story 2.2 — the KDE attention notifier tests (main-unit / node project).
//
// Inject a FAKE notificationFactory (the DI seam, AC-6) so NO real OS notification fires and
// NO Electron import is loaded on the test path. Asserts:
//   - AC-1: exactly ONE notification per `attention.raised` call (1:1, no extra debounce).
//   - AC-3: the title names WHAT HAPPENED, per status (YourTurn / NeedsAttention /
//     NeedsPermission / unknown) — never the board CATEGORY word "needs you"; body has
//     projectPath (+ pendingToolName verbatim when present, absent when not) — UX-DR22.
//   - AC-3/AC-7 PRIVACY: the constructed title/body contain NO pendingToolInput/firstPrompt/
//     latestMessage content (the underlying session would carry those; they must not appear).
//   - AC-4: activating the notification emits ONLY the FR-9 jump-to-card signal (the id) and
//     NEVER raises the window (there is no window-raise surface in the seam at all).
//   - AC-7 never-crash: a throwing fake factory does NOT throw out of notify(); it logs
//     id + code ONLY (no session value).
// [Source: story 2.2 Task 6.1; AC-1/3/4/6/7; .claude/rules/zod-boundaries.md#Never-log]
import { describe, it, expect, vi } from 'vitest'
import {
  createAttentionNotifier,
  buildNotificationContent,
  type NotificationLike,
  type NotificationOptions
} from './notifications'
import { STATUS_YOUR_TURN } from '../../shared/ipc/contract'
import type { AttentionRaisedEvent } from '../../shared/ipc/contract'

const FIXED_NOW = 1_750_000_000_000

/** The privacy-sensitive values that must NEVER appear in the notification content. These
 *  are fields on the underlying c9watch Session that are deliberately NOT on the frozen
 *  `AttentionRaisedEvent` shape — the notifier must never reach for them. */
const SECRET_TOOL_INPUT = 'rm -rf / --no-preserve-root  # SECRET pendingToolInput'
const SECRET_FIRST_PROMPT = 'SECRET firstPrompt: my api key is sk-live-12345'
const SECRET_LATEST_MESSAGE = 'SECRET latestMessage: deploying to prod now'

/** Build a frozen `attention.raised`. `pendingToolName` is included only when provided. */
function raised(over: Partial<AttentionRaisedEvent> = {}): AttentionRaisedEvent {
  const base: AttentionRaisedEvent = {
    type: 'attention.raised',
    id: over.id ?? 'id-1',
    sessionName: over.sessionName ?? 'webapp',
    projectPath: over.projectPath ?? '/home/u/projects/webapp',
    status: over.status ?? 'NeedsPermission',
    timestamp: over.timestamp ?? FIXED_NOW,
    ...(over.pendingToolName !== undefined ? { pendingToolName: over.pendingToolName } : {})
  }
  return base
}

/** A capturing fake factory + the constructed notifications (so we can assert show-count
 *  and inspect title/body/onActivate without any Electron / OS notification). */
function makeFakeFactory(): {
  factory: (opts: NotificationOptions) => NotificationLike
  shown: NotificationOptions[]
  showCalls: number
  last: () => NotificationOptions | undefined
} {
  const built: NotificationOptions[] = []
  const shown: NotificationOptions[] = []
  const factory = (opts: NotificationOptions): NotificationLike => {
    built.push(opts)
    return {
      show(): void {
        shown.push(opts)
      }
    }
  }
  return {
    factory,
    shown,
    get showCalls(): number {
      return shown.length
    },
    last: () => built[built.length - 1]
  }
}

describe('attention notifier — fires exactly once per attention.raised (AC-1)', () => {
  it('fires exactly ONE notification per notify() call (1:1, no extra debounce)', () => {
    const fake = makeFakeFactory()
    const notifier = createAttentionNotifier({ notificationFactory: fake.factory })
    notifier.notify(raised())
    expect(fake.showCalls).toBe(1)
  })

  it('three distinct attention.raised → three notifications (1:1, no cooldown collapses them)', () => {
    const fake = makeFakeFactory()
    const notifier = createAttentionNotifier({ notificationFactory: fake.factory })
    notifier.notify(raised({ id: 'a' }))
    notifier.notify(raised({ id: 'b' }))
    notifier.notify(raised({ id: 'c' }))
    expect(fake.showCalls).toBe(3)
  })
})

describe('attention notifier — content shape, verbatim status words (AC-3)', () => {
  it('title names the status; body has projectPath + pendingToolName VERBATIM', () => {
    const fake = makeFakeFactory()
    const notifier = createAttentionNotifier({ notificationFactory: fake.factory })
    notifier.notify(
      raised({
        sessionName: 'webapp',
        projectPath: '/p/webapp',
        pendingToolName: 'NeedsPermission'
      })
    )
    const opts = fake.last()
    expect(opts?.title).toBe('webapp wants permission')
    expect(opts?.body).toContain('/p/webapp')
    // VERBATIM (UX-DR22): the status/tool word is shown as-is, never re-labeled.
    expect(opts?.body).toContain('NeedsPermission')
  })

  it('body shows projectPath only when pendingToolName is ABSENT (omitted, not synthesized)', () => {
    const fake = makeFakeFactory()
    const notifier = createAttentionNotifier({ notificationFactory: fake.factory })
    // No pendingToolName key at all → the body is the projectPath alone.
    notifier.notify(raised({ projectPath: '/p/auth' }))
    const opts = fake.last()
    expect(opts?.body).toBe('/p/auth')
  })

  it('body shows projectPath only when pendingToolName is EMPTY (no dangling "· " tail)', () => {
    const fake = makeFakeFactory()
    const notifier = createAttentionNotifier({ notificationFactory: fake.factory })
    // c9watch's pendingToolName is z.string().optional() ("may be absent/empty"). An empty
    // string must NOT render a separator with nothing after it.
    notifier.notify(raised({ projectPath: '/p/auth', pendingToolName: '' }))
    const opts = fake.last()
    expect(opts?.body).toBe('/p/auth')
    expect(opts?.body).not.toContain('·')
  })

  it('buildNotificationContent is a pure helper producing the same shape', () => {
    const c = buildNotificationContent(
      raised({ sessionName: 's', projectPath: '/p', pendingToolName: 'Bash' })
    )
    expect(c.title).toBe('s wants permission')
    expect(c.body).toContain('/p')
    expect(c.body).toContain('Bash')
  })
})

describe('attention notifier — the title names the STATUS, never the board category (AC-3)', () => {
  // The `needs-you` COLUMN is an internal category name. A desktop notification is read by a
  // human with no board in front of them, so the title must say what actually happened. The
  // raise already carries the triggering `status` — this is the ONLY thing that varies.
  const CASES: ReadonlyArray<{ status: string; title: string }> = [
    { status: STATUS_YOUR_TURN, title: 'webapp · your turn' },
    { status: 'NeedsAttention', title: 'webapp asked a question' },
    { status: 'NeedsPermission', title: 'webapp wants permission' }
  ]

  for (const { status, title } of CASES) {
    it(`status ${status} → title "${title}"`, () => {
      expect(buildNotificationContent(raised({ sessionName: 'webapp', status })).title).toBe(title)
    })
  }

  it('an UNKNOWN/new status still notifies, with the neutral title (status is NOT enum-locked)', () => {
    // zod-boundaries.md: a brand-new claude status must classify, never fail closed. It reaches
    // needs-you via fail-toward-attention, so it must still produce a sane human title.
    const c = buildNotificationContent(raised({ sessionName: 'webapp', status: 'BrandNewStatus' }))
    expect(c.title).toBe('webapp is waiting for you')
  })

  it('NO title ever carries the board category word or the raw status token', () => {
    const fake = makeFakeFactory()
    const notifier = createAttentionNotifier({ notificationFactory: fake.factory })
    for (const status of [STATUS_YOUR_TURN, 'NeedsAttention', 'NeedsPermission', 'Whatever']) {
      notifier.notify(raised({ sessionName: 'webapp', status }))
      const title = fake.last()?.title ?? ''
      expect(title.toLowerCase()).not.toContain('needs you')
      expect(title.toLowerCase()).not.toContain('needs-you')
      // The raw CamelCase status token belongs in the body (verbatim), never in the prose title.
      expect(title).not.toContain(status)
      // It still names the session.
      expect(title).toContain('webapp')
    }
  })
})

describe('attention notifier — PRIVACY: never leaks pendingToolInput/firstPrompt/latestMessage (AC-3/AC-7)', () => {
  it('the constructed title/body contain NONE of the privacy-sensitive session values', () => {
    const fake = makeFakeFactory()
    const notifier = createAttentionNotifier({ notificationFactory: fake.factory })
    // The frozen AttentionRaisedEvent shape has NO place for these; we additionally smuggle
    // them onto the event object to PROVE the notifier reads only the union's fields and never
    // reaches for the extras (a regression that read `(raised as any).firstPrompt` would fail).
    const ev = {
      ...raised({ pendingToolName: 'NeedsPermission' }),
      pendingToolInput: SECRET_TOOL_INPUT,
      firstPrompt: SECRET_FIRST_PROMPT,
      latestMessage: SECRET_LATEST_MESSAGE
    } as AttentionRaisedEvent
    notifier.notify(ev)
    const opts = fake.last()
    const content = `${opts?.title ?? ''}\n${opts?.body ?? ''}`
    expect(content).not.toContain(SECRET_TOOL_INPUT)
    expect(content).not.toContain(SECRET_FIRST_PROMPT)
    expect(content).not.toContain(SECRET_LATEST_MESSAGE)
    // And it still produced the legitimate, by-design content.
    expect(opts?.title).toBe('webapp wants permission')
    expect(opts?.body).toContain('NeedsPermission')
  })
})

describe('attention notifier — informational only, NO self-raise; activation = jump-to-card only (AC-4)', () => {
  it('activating the notification emits ONLY the FR-9 signal (the id), never a window raise', () => {
    const fake = makeFakeFactory()
    const onActivate = vi.fn()
    const notifier = createAttentionNotifier({
      notificationFactory: fake.factory,
      onActivate
    })
    notifier.notify(raised({ id: 'sess-42' }))
    // The seam has NO window-raise surface; onActivate is the ONLY activation behavior.
    // Simulate the user activating the notification by invoking the wired handler.
    expect(typeof fake.last()?.onActivate).toBe('function')
    fake.last()?.onActivate?.()
    expect(onActivate).toHaveBeenCalledTimes(1)
    expect(onActivate).toHaveBeenCalledWith('sess-42')
  })

  it('with no onActivate injected, the notification has no activation handler (pure alert)', () => {
    const fake = makeFakeFactory()
    const notifier = createAttentionNotifier({ notificationFactory: fake.factory })
    notifier.notify(raised())
    expect(fake.last()?.onActivate).toBeUndefined()
  })
})

describe('attention notifier — never-crash + never-log-the-value (AC-7)', () => {
  it('a throwing factory does NOT throw out of notify(); logs id + code ONLY (no session value)', () => {
    const log = vi.fn()
    const throwingFactory = (): NotificationLike => {
      throw new Error('libnotify exploded')
    }
    const notifier = createAttentionNotifier({ notificationFactory: throwingFactory, log })
    const ev = raised({
      id: 'id-boom',
      sessionName: 'super-secret-session',
      projectPath: '/home/u/secret',
      pendingToolName: 'NeedsPermission'
    })
    // never-crash: notify must swallow the failure.
    expect(() => notifier.notify(ev)).not.toThrow()
    // Logged exactly once, with id + code ONLY.
    expect(log).toHaveBeenCalledTimes(1)
    const logged = String(log.mock.calls[0]?.[0] ?? '')
    expect(logged).toContain('id=id-boom')
    expect(logged).toContain('code=notify_failed')
    // never-log-the-value: NO session value in the log args.
    expect(logged).not.toContain('super-secret-session')
    expect(logged).not.toContain('/home/u/secret')
    expect(logged).not.toContain('NeedsPermission')
  })

  it('a null factory return (unsupported platform) is a graceful no-op, not an error', () => {
    const notifier = createAttentionNotifier({ notificationFactory: () => null })
    expect(() => notifier.notify(raised())).not.toThrow()
  })

  it('a factory whose show() throws is caught (degrades, never crashes)', () => {
    const log = vi.fn()
    const factory = (): NotificationLike => ({
      show(): void {
        throw new Error('show failed')
      }
    })
    const notifier = createAttentionNotifier({ notificationFactory: factory, log })
    expect(() => notifier.notify(raised({ id: 'x' }))).not.toThrow()
    expect(log).toHaveBeenCalledTimes(1)
    expect(String(log.mock.calls[0]?.[0])).toContain('id=x')
  })
})
