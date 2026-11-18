#!/bin/bash
# Runs the log-pane.py unit tests, then loads deploy/rpanion-terminal-log.conf into a private tmux
# server (script path substituted, log directory in a temporary directory). Skipped when tmux is
# not installed.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$DIR/../rpanion-terminal-log.conf"
PANE="$DIR/../rpanion-terminal-log-pane.py"
FAILS=0
ok()   { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILS=$((FAILS + 1)); }

python3 -I "$DIR/test_log_pane.py" >/dev/null 2>&1 && ok "log-pane.py unit tests" || { fail "log-pane.py unit tests"; python3 -I "$DIR/test_log_pane.py" 2>&1 | tail -20; }

if ! command -v tmux >/dev/null; then
    echo "tmux not installed, skipped"
    [ "$FAILS" -eq 0 ] && exit 0 || exit 1
fi

TMP=$(mktemp -d)
SOCK="$TMP/sock"
LOGDIR="$TMP/terminal"
mkdir -p "$LOGDIR"
trap 'tmux -S "$SOCK" kill-server 2>/dev/null; rm -rf "$TMP"' EXIT

sed "s#/usr/local/lib/rpanion-terminal/log-pane.py#$PANE#" "$CONF" > "$TMP/log.conf"
export RPANION_TERMINAL_LOG_DIR="$LOGDIR"
T() { tmux -S "$SOCK" "$@"; }
count() { find "$LOGDIR" -name '*.log' | wc -l; }
wait_for() { for _ in $(seq 1 50); do eval "$1" && return 0; sleep 0.1; done; return 1; }

T -f "$TMP/log.conf" new-session -d -s main -x 80 -y 20 'echo first-window-text; sleep 60'
wait_for '[ "$(count)" -ge 1 ]' && ok "first session creates a log file" || fail "first session creates a log file"
wait_for 'grep -q first-window-text "$LOGDIR"/*.log' && ok "pane text is written" || fail "pane text is written"

# Two grouped sessions (browser tabs), then a window created from one of them
T new-session -d -t main -s web-a
T new-session -d -t main -s web-b
sleep 0.5
check_after=$(count)
[ "$check_after" -eq 1 ] && ok "grouped sessions share the pane pipe ($check_after file)" || fail "grouped sessions share the pane pipe ($check_after files)"
for s in web-c web-d web-e; do T new-session -d -t main -s "$s"; done
[ "$(T list-panes -a -F '#{pane_pipe}' | sort -u)" = 1 ] && ok "pipe stays open after more grouped sessions" || fail "pipe stays open after more grouped sessions"
T send-keys -t main:0 'echo after-grouped-text' Enter
wait_for 'grep -q after-grouped-text "$LOGDIR"/*.log' && ok "text after grouped sessions is written" || fail "text after grouped sessions is written"

T new-window -t web-a: 'echo second-window-text; sleep 60'
wait_for '[ "$(count)" -ge 2 ]' && ok "new window creates a log file" || fail "new window creates a log file"
sleep 0.5
[ "$(count)" -eq 2 ] && ok "one file per pane with two grouped clients" || fail "one file per pane with two grouped clients ($(count) files)"
[ "$(grep -l second-window-text "$LOGDIR"/*.log | wc -l)" -eq 1 ] && ok "second window text in one file" || fail "second window text in one file"

T split-window -t web-b: 'echo split-text; sleep 60'
wait_for '[ "$(count)" -ge 3 ]' && ok "split pane creates a log file" || fail "split pane creates a log file"

# .disabled stops writing; the flag is polled every 5 s
touch "$LOGDIR/.disabled"
sleep 6.5
T send-keys -t main:0 'echo while-disabled-text' Enter
sleep 1
grep -q while-disabled-text "$LOGDIR"/*.log && fail ".disabled stops writing" || ok ".disabled stops writing"
rm "$LOGDIR/.disabled"
sleep 6.5
T send-keys -t main:0 'echo after-enable-text' Enter
wait_for 'grep -q after-enable-text "$LOGDIR"/*.log' && ok "writing resumes after .disabled is removed" || fail "writing resumes after .disabled is removed"

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
