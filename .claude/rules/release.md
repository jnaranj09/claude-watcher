---
paths:
  - 'electron-builder.yml'
  - '.github/**'
  - 'package.json'
  - 'tests/install/**'
  - 'tests/smoke/**'
---

# Rule: cutting a release

Spec: `docs/superpowers/specs/2026-09-30-release-pipeline-linux-design.md` (local only).

## The flow

1. Bump the version: `npm version <x.y.z> --no-git-tag-version` (updates `package.json` and
   `package-lock.json`).
2. Commit, push `main`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. `.github/workflows/release.yml` runs: gate (`ci.yml`) → deb/rpm/pacman on `ubuntu-22.04` →
   packaged smoke under `xvfb` → install check on debian:12, ubuntu:22.04, fedora, archlinux →
   a DRAFT GitHub Release with the packages + `SHA256SUMS`.
5. Read the draft, edit the notes, press Publish. Nothing is public before that.

A tag that does not match `package.json` `version` fails the release job before upload.

## Dry run

Actions → Release → Run workflow (or a PR touching `electron-builder.yml`, `package*.json`,
`tests/install/**`, `tests/smoke/**` or the workflow). Everything runs except the release job.

## Why it is built this way

- **`ubuntu-22.04`, never `ubuntu-latest`, for the build job.** `postinstall` compiles node-pty's
  `pty.node` on the runner, and it links against the runner's glibc. 22.04 = glibc 2.35, which
  Debian 12, Ubuntu 22.04 and Fedora 38+ have. A newer runner silently raises that floor. (Seen
  2026-09-30: a package built on the Arch host needed `GLIBC_2.42` and failed on Debian 12.) So a
  package built locally is for THIS machine only — never upload one.
- **The CI smoke's WebGL check is a warning** (`SMOKE_WEBGL=optional`, `tests/smoke/smokeVerdict.mjs`):
  the runner has no GPU. Every other check is strict. Locally `npm run smoke` stays fully strict
  — that is the WebGL gate.
- **`deb.depends` / `rpm.depends` / `pacman.depends` are explicit**: electron-builder's defaults
  pull `libappindicator`. A wrong list shows up in the install check (`ldd` → `not found`) —
  fix the list there. The check reads node-pty's `build/Release/pty.node`, the file node-pty
  loads first; the darwin/win32 prebuilds in the package are not Linux ELF files.
- **No auto-update** (`publish: null` in `electron-builder.yml`). Users download from GitHub
  Releases. The key is `null`, not omitted: omitted, electron-builder infers a GitHub provider
  from `package.json` `repository` and ships an `app-update.yml`.
- **Artifact names are distro-native**: `-amd64.deb`, `-x86_64.rpm`, `-x64.pacman`
  (electron-builder maps `${arch}` per target). The workflow matches by extension.

## Running the packaged smoke from an agent shell

The Bash tool's shell has no display. Take the session's from systemd first:
`export $(systemctl --user show-environment | grep -E '^(DISPLAY|WAYLAND_DISPLAY|XAUTHORITY)=' | xargs)`.
