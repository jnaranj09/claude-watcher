// The Liquid Glass v2 drive checks (spec 2026-10-08 "Testing / Drive"): the WebGL glass in the
// REAL app — wallpapers, 16 px gaps, the cascade under data-glass-on, scroll alignment, context
// loss, the focused view, accessibility, contrast on the real glass and the per-frame cost.
// Read .claude/rules/run-app.md first. `npm run build`, then one scenario per process (each
// relaunches the app with its own settings):
//
//   node tests/drive/glassCheck.mjs shots <theme> [wallpaper] [tag]   board + focused shots
//   node tests/drive/glassCheck.mjs checks                            scenarios 2, 3, 5, 6, 7
//   node tests/drive/glassCheck.mjs scroll                            scenario 4
//   node tests/drive/glassCheck.mjs cost [2]                          scenario 9 (1x or 2x)
//
// PNGs land in test-results/drive/glass/, numbers in test-results/drive/glass/report.json.
// The drive profile's settings file is copied before and put back on exit.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// GLASS_DRIVE = another checkout's driveApp.mjs (the Step 1 baseline on main); the PNGs still land
// in THIS checkout, under GLASS_SUB (e.g. `baseline`).
const d = await import(process.env.GLASS_DRIVE ?? './driveApp.mjs')
const HERE = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const OUT = path.join(HERE, 'test-results/drive/glass', process.env.GLASS_SUB ?? '')
const REPORT = path.join(OUT, 'report.json')
const SETTINGS = path.join(homedir(), '.config/claude-watcher-drive/c9watch-settings.json')
const BACKUP = `${SETTINGS}.glasscheck-backup`
const FRAMES = path.join(HERE, 'tests/drive/glassFrames.py')
/** The baseline (main) has no WebGL glass: no data-glass-on to wait for, no glass to measure. */
const GLASS = process.env.GLASS_DRIVE === undefined

mkdirSync(OUT, { recursive: true })

/** Write themeId (+ the liquid-glass wallpaper) into the drive settings; restored on exit. */
function useTheme(themeId, wallpaper) {
  if (existsSync(SETTINGS) && !existsSync(BACKUP)) copyFileSync(SETTINGS, BACKUP)
  const file = existsSync(SETTINGS) ? JSON.parse(readFileSync(SETTINGS, 'utf8')) : { settings: {} }
  file.settings.themeId = themeId
  if (wallpaper !== undefined) {
    file.settings.wallpaperByTheme = {
      ...file.settings.wallpaperByTheme,
      'liquid-glass': wallpaper
    }
  }
  writeFileSync(SETTINGS, JSON.stringify(file, null, '\t'))
}
process.on('exit', () => {
  if (existsSync(BACKUP)) {
    copyFileSync(BACKUP, SETTINGS)
    execFileSync('rm', ['-f', BACKUP])
  }
})

function report(key, value) {
  const all = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) : {}
  all[key] = value
  writeFileSync(REPORT, JSON.stringify(all, null, 2))
  console.log(`[glass] ${key}:`, JSON.stringify(value))
}

const frames = (...args) =>
  JSON.parse(execFileSync('python3', [FRAMES, ...args.map(String)], { encoding: 'utf8' }))

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`)
  await page.waitForTimeout(400)
  await page.screenshot({ path: file })
  console.log('[glass] shot', path.relative(HERE, file))
  return file
}

/** The hidden display is 1920x1080 device px: at 2x a window fits only ~960x540 CSS px. */
async function size(app, page, w, h) {
  await app.evaluate(
    ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]?.setContentSize(w, h),
    [w, h]
  )
  await page.waitForFunction(
    ([w, h]) => window.innerWidth === w && window.innerHeight === h,
    [w, h]
  )
}

async function glassOn(page, on = true) {
  await page.waitForFunction(
    (on) => document.documentElement.hasAttribute('data-glass-on') === on,
    on,
    {
      timeout: 10000
    }
  )
}

/** n sessions: the first needs you, the second works, the rest idle. */
async function sessions(page, pickDir, n) {
  const ids = []
  for (let i = 0; i < n; i++) ids.push(await d.launchSession(page))
  if (ids[0]) await d.needsYou(pickDir, ids[0])
  if (ids[1]) await d.working(pickDir, ids[1])
  await page.waitForTimeout(800)
  return ids
}

async function focus(page, id) {
  await page.locator(`[data-column] [data-session-id="${id}"]`).first().click({ force: true })
  await page
    .locator('[data-testid="embedded-terminal"] >> visible=true')
    .first()
    .waitFor({ state: 'visible' })
}
async function back(page) {
  await page.locator('[data-testid="focused-back"]').click()
  await page.locator('[data-testid="column-grid"]').waitFor({ state: 'visible' })
}

const box = async (page, sel) =>
  (await page.locator(sel).count()) > 0 ? page.locator(sel).first().boundingBox() : null

// ── scenarios ────────────────────────────────────────────────────────────────────────────────

/** Scenarios 1, 8, 10: board + focused shots; on Liquid Glass, contrast on the real glass. */
async function shots([theme = 'liquid-glass', wallpaper, tag = wallpaper ?? theme]) {
  useTheme(theme, wallpaper)
  await d.run(async ({ app, page, pickDir }) => {
    await size(app, page, 1440, 900)
    const ids = await sessions(page, pickDir, 3)
    const lg = GLASS && theme === 'liquid-glass'
    if (lg) await glassOn(page)
    const board = await shot(page, `${tag}-board`)
    if (lg) {
      // Scenario 8: computed ink over the median glass pixel behind it, on the hero card.
      const hero = `[data-column] [data-session-id="${ids[0]}"]`
      const calm = `[data-column] [data-session-id="${ids[2]}"]`
      const contrastOf = async (card) => {
        const out = {}
        for (const id of ['pid', 'project-path']) {
          const sel = `${card} [data-testid="${id}"]`
          const b = await box(page, sel)
          if (b === null) continue
          const ink = await page.locator(sel).evaluate((el) => {
            const m = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(
              getComputedStyle(el).color
            )
            let op = 1
            for (let a = el; a !== null; a = a.parentElement)
              op *= Number(getComputedStyle(a).opacity)
            return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 1) * op] : null
          })
          if (ink) out[id] = frames('contrast', board, b.x, b.y, b.width, b.height, ...ink).ratio
        }
        return out
      }
      report(`contrast.${tag}`, { hero: await contrastOf(hero), calm: await contrastOf(calm) })
    }
    if (theme !== 'liquid-glass') {
      report(
        `unchanged.${tag}`,
        await page.evaluate(() => {
          const count = document
            .querySelector('[data-testid="column-count"]')
            ?.textContent?.replace(/\s+/g, ' ')
            .trim()
          const card = document.querySelector('[data-column] [data-status="needs-you"]')
          const menu = document.querySelector('[data-app-menu]')
          return {
            count,
            // The header root via its name: the baseline has no data-column-header hook.
            tick: getComputedStyle(
              document.querySelector('[data-testid="column-name"]').parentElement.parentElement
            ).borderTopColor,
            cardEdge: card ? getComputedStyle(card).borderLeftColor : null,
            needsYou: getComputedStyle(document.documentElement)
              .getPropertyValue('--needs-you')
              .trim(),
            menuRadius: menu ? getComputedStyle(menu).borderTopLeftRadius : null
          }
        })
      )
    }
    await focus(page, ids[0])
    await shot(page, `${tag}-focused`)
  })
}

/** Scenarios 2, 3, 5, 6, 7 on Lake. */
async function checks() {
  useTheme('liquid-glass', 'lake')
  await d.run(async ({ app, page, pickDir }) => {
    await size(app, page, 1440, 900)
    const ids = await sessions(page, pickDir, 3)
    await glassOn(page)

    // 2. Gaps.
    const header = await box(page, '[data-testid="app-header"]')
    const filter = await box(page, '[data-testid="filter-bar"]')
    const cols = await page
      .locator('section[data-column]')
      .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))
    const gaps = {
      headerToFilter: filter.y - (header.y + header.height),
      filterToColumns: cols[0].top - (filter.y + filter.height),
      betweenColumns: cols.slice(1).map((c, i) => c.left - cols[i].right)
    }

    // 3. Cascade, computed.
    const cascade = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="header-new-session"]')
      const col = document.querySelector('section[data-column]')
      const card = document.querySelector('[data-column] [data-status="needs-you"]')
      return {
        buttonFilter: getComputedStyle(b).filter,
        buttonBefore: getComputedStyle(b, '::before').content,
        buttonBgImage: getComputedStyle(b).backgroundImage,
        columnBefore: getComputedStyle(col, '::before').content,
        cardEdge: card ? getComputedStyle(card).borderLeftColor : null
      }
    })
    await page.locator('[data-testid="header-new-session"]').click()
    await page.locator('[data-testid="menu-manage"]').click()
    const modal = "[role='dialog'][aria-modal='true']"
    await page.locator(modal).first().waitFor({ state: 'visible' })
    await page.waitForTimeout(300)
    cascade.modalControl = await page.evaluate((modal) => {
      const b = document.querySelector(`${modal} [data-glass='control']`)
      return b
        ? {
            self: getComputedStyle(b).backdropFilter,
            before: getComputedStyle(b, '::before').backdropFilter
          }
        : null
    }, modal)
    await shot(page, 'cascade-modal')
    await page.keyboard.press('Escape')
    await page.locator(modal).first().waitFor({ state: 'detached' })
    report('cascade', cascade)

    // 5. Context loss → CSS glass in the next frame → restore → back within 1 s.
    await page.evaluate(() => {
      window.__lose = document
        .querySelector('canvas[aria-hidden]')
        .getContext('webgl2')
        .getExtension('WEBGL_lose_context')
      window.__lose.loseContext()
    })
    await glassOn(page, false)
    await shot(page, 'context-lost')
    const t0 = Date.now()
    await page.evaluate(() => window.__lose.restoreContext())
    await glassOn(page, true)
    report('contextLoss', { offAfterLoss: true, backMs: Date.now() - t0 })

    // 6. Focused view: header → bubble gap, bubble → terminal panel gap, tab vs strip luminance.
    await focus(page, ids[0])
    await glassOn(page)
    const focusedPng = await shot(page, 'focused')
    const f = await page.evaluate(() => {
      const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null)
      const bubble = r(document.querySelector('[data-testid="focused-session"]'))
      const panel = r(
        // The visible panel: kept-alive terminals stay laid out, off-screen.
        [...document.querySelectorAll('[data-terminal-panel]')].find((e) => {
          const b = e.getBoundingClientRect()
          return b.width > 0 && b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight
        })
      )
      const tab = r(document.querySelector('[data-testid="rail-row"][data-active]'))
      const rail = r(document.querySelector('[data-testid="attention-rail"]'))
      const header = r(document.querySelector('[data-testid="app-header"]'))
      return { bubble, panel, tab, rail, header }
    })
    gaps.headerToFocused = f.bubble.top - f.header.bottom
    // D.6: the bubble's inner edge → the terminal panel (right and bottom; the top holds the bar).
    gaps.bubbleToPanel = f.panel
      ? { right: f.bubble.right - f.panel.right, bottom: f.bubble.bottom - f.panel.bottom }
      : null
    report('gaps', gaps)
    if (f.tab && f.panel) {
      // The area around the terminal: the strip between the rail and the panel, beside the tab.
      const left = f.rail ? f.rail.right + 2 : f.panel.left - 10
      const strip = [left, f.tab.top + 6, Math.max(2, f.panel.left - left - 2), f.tab.height - 12]
      report(
        'focusedLum',
        frames(
          'lum',
          focusedPng,
          // The tab's text-free right end (text pixels would skew the mean).
          f.tab.right - 50,
          f.tab.top + 6,
          44,
          f.tab.height - 12,
          ...strip
        )
      )
    }
    await back(page)

    // 7. Accessibility (CDP media emulation).
    const cdp = await page.context().newCDPSession(page)
    const a11y = {}
    for (const [name, value, tag] of [
      ['prefers-reduced-transparency', 'reduce', 'reducedTransparency'],
      ['prefers-contrast', 'more', 'moreContrast']
    ]) {
      try {
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name, value }] })
      } catch (e) {
        a11y[tag] = { rejected: String(e) }
        continue
      }
      await page.waitForTimeout(500)
      a11y[tag] = await page.evaluate(() => ({
        canvas: document.querySelector('canvas[aria-hidden]') !== null,
        glassOn: document.documentElement.hasAttribute('data-glass-on'),
        columnBg: getComputedStyle(document.querySelector('section[data-column]')).backgroundColor
      }))
      await shot(page, `a11y-${tag}`)
      await cdp.send('Emulation.setEmulatedMedia', { features: [] })
      await glassOn(page)
    }
    report('a11y', a11y)
  })
}

/** Scenario 4: scroll alignment (screencast frames during wheel scroll). */
async function scroll() {
  useTheme('liquid-glass', 'lake')
  await d.run(async ({ app, page, pickDir }) => {
    await sessions(page, pickDir, 6)
    await size(app, page, 1440, 420)
    await glassOn(page)
    const dir = path.join(OUT, 'scroll')
    execFileSync('rm', ['-rf', dir])
    mkdirSync(dir, { recursive: true })
    const grid = await box(page, '[data-testid="column-grid"]')
    const card = page.locator('section[data-column="idle"] [data-session-id]').first()
    const cardBox = await card.boundingBox()
    const nameBox = await card.locator('[data-testid="session-name"]').boundingBox()
    const cdp = await page.context().newCDPSession(page)
    const pngs = []
    cdp.on('Page.screencastFrame', (e) => {
      pngs.push(e.data)
      cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {})
    })
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    await page.mouse.move(grid.x + grid.width / 2, grid.y + grid.height / 2)
    for (const dy of [18, -18]) {
      for (let i = 0; i < 14; i++) {
        await page.mouse.wheel(0, dy)
        await page.waitForTimeout(16)
      }
    }
    await page.waitForTimeout(300)
    await cdp.send('Page.stopScreencast')
    pngs.forEach((b64, i) =>
      writeFileSync(
        path.join(dir, `f${String(i).padStart(3, '0')}.png`),
        Buffer.from(b64, 'base64')
      )
    )
    const align = frames('align', dir, grid.y, cardBox.x, cardBox.width, nameBox.x, nameBox.width)
    // A card half under the filter bar: scroll by half a card, then look for rim rows in the bar.
    await page.mouse.wheel(0, Math.round(cardBox.height / 2))
    await page.waitForTimeout(400)
    const bar = await box(page, '[data-testid="filter-bar"]')
    const under = await shot(page, 'scroll-under-filter')
    const region = frames('region', under, bar.x, bar.y, bar.width, bar.height)
    report('scroll', { frames: pngs.length, ...align, filterBarRims: region.rims })
  })
}

/** Scenario 9: 120 forced full draws (1 px resizes), p50/p95 of glass-draw and glass-collect. */
async function cost([scale = '1']) {
  useTheme('liquid-glass', 'lake')
  const args = scale === '1' ? [] : [`--force-device-scale-factor=${scale}`]
  // 2x: the largest window the hidden display holds (more device px than 1x's 1440x900).
  const [w, h] = scale === '1' ? [1440, 900] : [940, 520]
  await d.run(
    async ({ app, page, pickDir }) => {
      await size(app, page, w, h)
      await sessions(page, pickDir, 3)
      await glassOn(page)
      // The layer clears its measures at once (no timeline growth), so an observer collects them.
      await page.evaluate(() => {
        window.__glassTimes = { 'glass-draw': [], 'glass-collect': [] }
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) window.__glassTimes[e.name]?.push(e.duration)
        }).observe({ type: 'measure' })
      })
      for (let i = 0; i < 120; i++) {
        await size(app, page, w + (i % 2), h)
        await page.waitForTimeout(32)
      }
      const stats = await page.evaluate(() => {
        const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]
        const of = (name) => {
          const xs = [...window.__glassTimes[name]].sort((a, b) => a - b)
          return { n: xs.length, p50: pct(xs, 50), p95: pct(xs, 95) }
        }
        const out = {
          draw: of('glass-draw'),
          collect: of('glass-collect'),
          dpr: window.devicePixelRatio,
          devicePx: [innerWidth * devicePixelRatio, innerHeight * devicePixelRatio],
          leftInTimeline: performance.getEntriesByType('measure').length
        }
        return out
      })
      report(`cost.${scale}x`, stats)
    },
    { args }
  )
}

const [cmd, ...rest] = process.argv.slice(2)
const scenarios = { shots, checks, scroll, cost }
if (!scenarios[cmd]) {
  console.error('usage: node tests/drive/glassCheck.mjs shots|checks|scroll|cost …')
  process.exit(2)
}
await scenarios[cmd](rest)
