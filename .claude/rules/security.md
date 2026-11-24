---
paths:
  - '.github/workflows/**'
  - 'electron-builder.yml'
  - 'security/**'
  - 'docs/threat-model.md'
  - 'src/main/api/**'
  - 'src/main/hooks/**'
---

# Rule: security

The threat model (`docs/threat-model.md`) is the list of every threat and the check that covers it.
Each rule below names its sensor, or says "Prose only".

- **A change that adds an attack surface adds its threat row in the same change**: a new outside
  input, route, upload, image, workflow, deploy script or dependency with network access. The row
  names a check (`test:`, `file:`, `npm:`, `ci:`) or `accepted:` with the reason. Sensor: guard
  `threat-model` (references resolve); whether a row was added is reviewer only.
- **No credential for an outside service in the repo, a CI secret or a CI variable**, even
  read-only. CI uses only what the platform gives every run. Sensor: gitleaks in `npm run security` (whole
  history and the uncommitted diff; false positives by fingerprint in `.gitleaksignore`); CI settings are prose only (reviewer).
- **Everything is pinned.** Actions by full commit SHA with `# vX.Y.Z`, images as
  `<tag>@sha256:<digest>`. A bump changes the tag and the digest (or SHA and comment) together, and
  every copy of a version in one commit. Sensor: guard `supply-chain-pins` (also `check-pins`: one Node version
  in every workflow); Dependabot (`.github/dependabot.yml`) proposes the bumps.
- **A high or critical CVE with a fix blocks; the default answer is the fix.** Bump or replace the
  dependency. Sensor: Trivy fs in `npm run security`. The app ships no images, so there is no image scan.
- **The allow-list only shrinks.** A new entry or a later expiry needs the owner's agreement in the
  commit message, a reason, an expiry at most 180 days ahead and the narrowest id the tool allows.
  Sensor: guard `security-allow-list` (`security/allow.json`, `.gitleaksignore`); the owner's
  agreement is prose only.
- **A new dangerous sink gets a Semgrep rule with a fixture**, seen red once on real code, never a
  registry rule. Sensor: Semgrep in `npm run security`, rules in `security/semgrep/` (`semgrep --test`
  fails a rule whose fixture does not match).
- **Least privilege in CI.** Workflow permissions read-only by default, write scopes on the one job
  that needs them, no persisted checkout credentials. The repo builds no image and has no compose file
  (`security/tools.Dockerfile` only pins the scanners and is never built); the first one adds its checks (non-root, all capabilities dropped, read-only root) and their
  guards. Sensor: zizmor `--offline` in `npm run security`, medium and up.
- **The Electron security settings are never weakened** (`sandbox`, `contextIsolation`,
  `nodeIntegration: false`, the packaged fuses, the trusted IPC wrapper). Sensor:
  `tests/main/rendererHardening.guard.test.ts` (CSP, webPreferences), `ipcMainImport.guard.test.ts`,
  `tests/unit/electronFuses.test.ts` and `smoke`; the rest is the reviewer's
  "Security" check.
- **No scan of a real deployment runs in CI.** The app is not deployed; DAST (T14) runs only
  against a throwaway e2e-profile app. Prose only.
- **A security check that could not run is reported as NOT RUN**, never as clean, and a missing
  tool is red. Sensor: `security/run.mjs`
  (red on a missing tool, a failed pull, or zero commits, files or workflows scanned).
