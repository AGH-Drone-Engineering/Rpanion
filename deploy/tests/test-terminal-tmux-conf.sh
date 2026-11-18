#!/bin/bash
# Loads deploy/rpanion-terminal.tmux.conf into a private tmux server and checks the wheel keys
# scroll the history. Skipped when tmux is not installed.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$DIR/../rpanion-terminal.tmux.conf"
FAILS=0
ok()   { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILS=$((FAILS + 1)); }

if ! command -v tmux >/dev/null; then
    echo "tmux not installed, skipped"
    exit 0
fi

TMP=$(mktemp -d)
SOCK="$TMP/sock"
trap 'tmux -S "$SOCK" kill-server 2>/dev/null; rm -rf "$TMP"' EXIT

# Log hook pointed at a missing file: the installed log.conf would log into the live directory
sed "s#/usr/local/lib/rpanion-terminal/log.conf#$TMP/missing-log.conf#" "$CONF" > "$TMP/tmux.conf"
grep -q "$TMP/missing-log.conf" "$TMP/tmux.conf" || { fail "log hook replaced"; exit 1; }

# source-file -q of the missing log.conf hook must not fail the load
if tmux -S "$SOCK" -f "$TMP/tmux.conf" new-session -d -s t -x 80 -y 20 'seq 1 300; sleep 30'; then
    ok "config loads"
else
    fail "config loads"; exit 1
fi
[ "$(tmux -S "$SOCK" show -gv mouse)" = off ] && ok "mouse off" || fail "mouse off"
tmux -S "$SOCK" list-keys -T root | grep -q "User0 .*scroll-up" && ok "User0 scrolls up" || fail "User0 scrolls up"
tmux -S "$SOCK" list-keys -T root | grep -q "User1 .*scroll-down" && ok "User1 scrolls down" || fail "User1 scrolls down"

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
