#!/bin/bash
# Runs server/migrate-logs.sh on a temporary tree.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$DIR/../../server/migrate-logs.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILS=0
ok()   { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILS=$((FAILS + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }

export RPANION_ETC_DIR="$TMP/etc"
mkdir -p "$TMP/etc/flightlogs/kmzlogs" "$TMP/etc/media/sub/deeper" "$TMP/etc/config"
echo a > "$TMP/etc/flightlogs/a.tlog"
echo b > "$TMP/etc/flightlogs/b.bin"
echo c > "$TMP/etc/flightlogs/kmzlogs/a.kmz"
echo d > "$TMP/etc/media/p.jpg"
echo e > "$TMP/etc/media/sub/deeper/v.mp4"
echo cfg > "$TMP/etc/config/settings.json"

"$SCRIPT" >/dev/null || fail "first run exits 0"
L="$TMP/etc/logs"
check "tlog moved" "$(cat "$L/telemetry/a.tlog")" a
check "bin moved" "$(cat "$L/bin/b.bin")" b
check "kmz moved" "$(cat "$L/kmz/a.kmz")" c
check "media moved" "$(cat "$L/media/p.jpg")" d
check "media subfolder kept" "$(cat "$L/media/sub/deeper/v.mp4")" e
[ -d "$L/terminal" ] && ok "terminal dir created" || fail "terminal dir created"
[ ! -e "$TMP/etc/flightlogs" ] && ok "flightlogs removed" || fail "flightlogs removed"
[ ! -e "$TMP/etc/media" ] && ok "old media removed" || fail "old media removed"
check "config untouched" "$(cat "$TMP/etc/config/settings.json")" cfg

# Second run is a no-op
"$SCRIPT" >/dev/null && ok "second run exits 0" || fail "second run exits 0"
check "tlog kept after rerun" "$(cat "$L/telemetry/a.tlog")" a

# Existing destination file is not overwritten
mkdir -p "$TMP/etc/flightlogs"
echo new > "$TMP/etc/flightlogs/a.tlog"
"$SCRIPT" >/dev/null
check "no overwrite" "$(cat "$L/telemetry/a.tlog")" a
[ -e "$TMP/etc/flightlogs/a.tlog" ] && ok "conflicting file left in place" || fail "conflicting file left in place"

# Fresh install without old directories
rm -rf "$TMP/etc"
"$SCRIPT" >/dev/null && ok "fresh install" || fail "fresh install"
[ -d "$TMP/etc/logs/media" ] && ok "fresh dirs created" || fail "fresh dirs created"

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
