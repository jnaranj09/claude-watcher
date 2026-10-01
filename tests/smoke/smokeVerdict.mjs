/**
 * The packaged smoke's exit-gate decision, pulled out of run-packaged-smoke.mjs so it is
 * unit-tested (tests/unit/smokeVerdict.test.ts).
 *
 * `SMOKE_WEBGL=optional` (CI only — the runner has no GPU) turns the WebGL check into a
 * warning. It relaxes NOTHING else: the app's own `report.pass` includes WebGL, so in optional
 * mode pass is re-derived from every other check instead of trusted.
 */

/** `optional` only for that exact value; anything else is strict. */
export function webglMode(env) {
  return env.SMOKE_WEBGL === 'optional' ? 'optional' : 'strict'
}

export function evaluateVerdict(report, mode) {
  if (report === null || typeof report !== 'object') return { ok: false, warnings: [] }
  const c = report.checks || {}
  const others =
    c.typeEcho?.pass === true &&
    c.resize?.pass === true &&
    c.tui?.pass === true &&
    // Programmatic API — `/docs`, `/openapi.json` and one Swagger UI ASSET must answer 200 from
    // inside the PACKAGED asar. Main binds the listener on an ephemeral port in smoke mode and
    // fetches all three before writing the verdict; a 0 is a failed/timed-out fetch (or no
    // listener at all), a 503 on `/docs` is `swagger-ui-dist` unresolvable inside the package, and
    // a 404 on the asset is a packaged file the read could not open (the `files` allow-list
    // trimmed it) — `/docs` itself would still answer 200 in that case, which is why the asset is
    // fetched.
    report.main?.api?.pass === true &&
    // Bundled themes — Liquid Glass and Paper must list clean and Liquid Glass must load from
    // <resourcesPath>/themes (electron-builder extraResources). A false here is a theme the
    // package did not carry, or one that no longer composes.
    report.main?.themes?.pass === true
  const webgl = c.webgl?.pass === true

  if (mode === 'strict') {
    return { ok: report.pass === true && others && webgl, warnings: [] }
  }
  const ok = report.error === undefined && others
  const warnings = ok && !webgl ? ['webgl check failed — accepted (SMOKE_WEBGL=optional)'] : []
  return { ok, warnings }
}
