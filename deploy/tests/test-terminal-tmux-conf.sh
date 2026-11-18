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

# source-file -q of the missing log config must not fail the load
if tmux -S "$SOCK" -f "$CONF" new-session -d -s t -x 80 -y 20 'seq 1 300; sleep 30'; then
    ok "config loads"
else
    fail "config loads"; exit 1
fi
[ "$(tmux -S "$SOCK" show -gv mouse)" = off ] && ok "mouse off" || fail "mouse off"
tmux -S "$SOCK" list-keys -T root | grep -q "User0 .*scroll-up" && ok "User0 scrolls up" || fail "User0 scrolls up"
tmux -S "$SOCK" list-keys -T root | grep -q "User1 .*scroll-down" && ok "User1 scrolls down" || fail "User1 scrolls down"

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
