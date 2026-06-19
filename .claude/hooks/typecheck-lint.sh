#!/usr/bin/env bash
# Story 0.3 — PostToolUse feedback hook (AC-2).
#
# Fires after Edit|Write|MultiEdit on a *.ts|*.tsx file. Gives the agent fast
# red/green so it fixes type/lint errors IN-LOOP. Budget: < 2s on the warm caches.
#
# Mechanism (architecture.md#Enforcement, <2s budget):
#   - `eslint --cache <file>` on the SINGLE changed file (fast; warm cache).
#   - INCREMENTAL `tsc --noEmit --incremental` over the build projects (TS needs the
#     whole program for cross-file types, but `--incremental` + the warm
#     `.tsbuildinfo` keeps it ~0.6s/project). We use `--composite false` so NO
#     declaration files are emitted into `src/` (composite emit would clobber the
#     hand-written `src/preload/index.d.ts` Window.pty augmentation).
#
# Reads the changed file path from the hook's stdin JSON (`tool_input.file_path`).
# Exits non-zero on any tsc/eslint error so the agent sees the failure.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd)"

# --- read the changed file path from stdin (hook payload) ---------------------
PAYLOAD="$(cat)"
FILE="$(printf '%s' "$PAYLOAD" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch{process.stdout.write("")}})' 2>/dev/null)"

# Only act on TS/TSX edits. Anything else is a no-op (do not burn the budget).
case "$FILE" in
  *.ts | *.tsx) ;;
  *) exit 0 ;;
esac

# Ignore files outside the repo source tree we typecheck.
case "$FILE" in
  "$ROOT"/* | src/* | tests/* | *.config.ts) ;;
  *) exit 0 ;;
esac

STATUS=0

# --- 1) ESLint on the single changed file (fast, cached) ----------------------
if [ -f "$FILE" ]; then
  if ! npx --no-install eslint --cache "$FILE"; then
    STATUS=1
  fi
fi

# --- 2) Incremental typecheck (warm .tsbuildinfo → fast) ----------------------
# Pick the project(s) the file belongs to so we do the least work:
#   src/renderer → web ; src/main|src/preload → node ; src/__fixtures__|*.test.ts → test ;
#   src/shared   → node + web (shared by both). Default to all three when unsure.
TS_NODE='npx --no-install tsc --noEmit --incremental --tsBuildInfoFile .tsbuild-node.tsbuildinfo -p tsconfig.node.json --composite false'
TS_WEB='npx --no-install tsc --noEmit --incremental --tsBuildInfoFile .tsbuild-web.tsbuildinfo -p tsconfig.web.json --composite false'
TS_TEST='npx --no-install tsc --noEmit --incremental --tsBuildInfoFile .tsbuild-test.tsbuildinfo -p tsconfig.test.json'

run() { eval "$1" || STATUS=1; }

# Match BOTH absolute (Claude Code passes `tool_input.file_path` absolute today)
# AND repo-relative paths (the in-tree guard above also admits `src/*`/`tests/*`),
# so a relative path routes to the minimal project set instead of falling through
# to the all-three default and blowing the <2s budget. [Review finding #1]
case "$FILE" in
  *.test.ts | */__fixtures__/* | src/__fixtures__/* ) run "$TS_TEST" ;;
  */src/renderer/* | src/renderer/* ) run "$TS_WEB" ;;
  */src/main/* | src/main/* | */src/preload/* | src/preload/* ) run "$TS_NODE" ;;
  */src/shared/* | src/shared/* ) run "$TS_NODE"; run "$TS_WEB"; run "$TS_TEST" ;;
  * ) run "$TS_NODE"; run "$TS_WEB"; run "$TS_TEST" ;;
esac

exit $STATUS
