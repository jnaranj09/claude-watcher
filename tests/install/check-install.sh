#!/bin/sh
# Install ONE claude-watcher package on a clean distro container and prove every shared
# library resolves (spec 2026-09-30 release pipeline, section 3). Run as root inside the
# container: `sh tests/install/check-install.sh dist/claude-watcher-<v>-amd64.deb`.
# The app is NOT launched (no display); `ldd` is the check.
set -eu

[ $# -eq 1 ] || { echo "usage: $0 <package>" >&2; exit 2; }
pkg="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
[ -f "$pkg" ] || { echo "[install] no such package: $1" >&2; exit 2; }

case "$pkg" in
  *.deb)
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg" ;;
  *.rpm)
    dnf install -y -q "$pkg" ;;
  *.pacman)
    pacman -Syu --noconfirm --quiet
    pacman -U --noconfirm "$pkg" ;;
  *) echo "[install] unknown package type: $pkg" >&2; exit 2 ;;
esac

bin="$(find /opt -type f -name claude-watcher -perm -u+x 2>/dev/null | head -n 1)"
# The file node-pty loads FIRST (its lib/utils.js tries build/Release before prebuilds/). The
# package also carries darwin/win32 prebuilds; ldd on one of those proves nothing.
pty="$(find /opt -type f -path '*app.asar.unpacked/node_modules/node-pty/build/Release/pty.node' 2>/dev/null | head -n 1)"
# Fail on an EMPTY find: a moved install path must not pass vacuously.
[ -n "$bin" ] || { echo "[install] FAIL: claude-watcher binary not found under /opt" >&2; exit 1; }
[ -n "$pty" ] || { echo "[install] FAIL: pty.node not found under /opt" >&2; exit 1; }

fail=0
for f in "$bin" "$pty"; do
  out="$(ldd "$f" 2>&1 || true)"
  if ! printf '%s\n' "$out" | grep -q '=>'; then
    echo "[install] FAIL: ldd could not read $f (not a Linux ELF?):" >&2
    echo "$out" >&2
    fail=1
    continue
  fi
  missing="$(printf '%s\n' "$out" | grep 'not found' || true)"
  if [ -n "$missing" ]; then
    echo "[install] FAIL: $f has unresolved libraries:" >&2
    echo "$missing" >&2
    fail=1
  fi
done
[ "$fail" -eq 0 ] || exit 1

desktop=/usr/share/applications/com.claudewatcher.app.desktop
[ -f "$desktop" ] || { echo "[install] FAIL: $desktop missing (desktop identity, AR-10)" >&2; exit 1; }

echo "[install] PASS: $(basename "$pkg")"
