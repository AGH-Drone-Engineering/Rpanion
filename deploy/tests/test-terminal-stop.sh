#!/bin/bash
# Checks deploy/rpanion-terminal-stop.sh against a fake cgroup.procs and a stubbed tmux; no root needed.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STOP="$DIR/../rpanion-terminal-stop.sh"
TMP=$(mktemp -d)
trap 'kill -KILL $(jobs -p) 2>/dev/null; rm -rf "$TMP"' EXIT
FAILS=0

ok()   { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILS=$((FAILS + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }

mkdir -p "$TMP/bin"
# list-panes prints the pids in $TMP/panes
cat > "$TMP/bin/tmux" <<'STUB'
#!/bin/bash
cat "$PANES_FILE" 2>/dev/null
STUB
chmod +x "$TMP/bin/tmux"
export PANES_FILE="$TMP/panes"

# Interactive-like shell: ignores SIGTERM. The sleep is a child, so comm of the pid stays "bash"
start_shell() {
    bash -c 'trap "" TERM; while :; do sleep 0.1; done' &
    SHELL_PID=$!
}
# Handles SIGTERM like main.py: cleanup takes $1 seconds
start_worker() {
    bash -c 'trap "echo term >> '"$TMP"'/worker-'"$2"'; sleep '"$1"'; exit 0" TERM; while :; do sleep 0.1; done' &
    WORKER_PID=$!
}
# Same comm as the other helpers ("bash"), ignores SIGTERM and is not a pane shell
start_stubborn() {
    bash -c 'trap "" TERM; while :; do sleep 0.1; done' &
    STUBBORN_PID=$!
}

run_stop() {
    local start=$SECONDS
    RPANION_TMUX="$TMP/bin/tmux" RPANION_CGROUP_PROCS="$TMP/procs" RPANION_TERMINAL_WAIT=${1:-4} \
        MAINPID=$MAIN_PID bash "$STOP" > "$TMP/out" 2>&1
    RC=$?
    ELAPSED=$((SECONDS - start))
}

sleep 300 & MAIN_PID=$!
sleep 0.3

# Shell only: nothing to wait for
start_shell
echo "$MAIN_PID $SHELL_PID" | tr ' ' '\n' > "$TMP/procs"
echo "$SHELL_PID" > "$TMP/panes"
run_stop
check "shell only: exits 0" "$RC" 0
[ "$ELAPSED" -le 1 ] && ok "shell only: no wait" || fail "shell only: no wait (${ELAPSED}s)"
kill -0 "$MAIN_PID" 2>/dev/null && ok "tmux server not signaled" || fail "tmux server not signaled"

# Several windows: list-panes -a prints the shell of every window, none of them is waited for
start_shell; SHELL2_PID=$SHELL_PID
start_shell; SHELL3_PID=$SHELL_PID
echo "$MAIN_PID $SHELL2_PID $SHELL3_PID" | tr ' ' '\n' > "$TMP/procs"
echo "$SHELL2_PID $SHELL3_PID" | tr ' ' '\n' > "$TMP/panes"
run_stop
check "several windows: exits 0" "$RC" 0
[ "$ELAPSED" -le 1 ] && ok "several windows: no wait" || fail "several windows: no wait (${ELAPSED}s)"

# A worker in the second window is waited for while the shells of both windows are not
start_worker 2 b
echo "$MAIN_PID $SHELL2_PID $SHELL3_PID $WORKER_PID" | tr ' ' '\n' > "$TMP/procs"
run_stop 6
[ -f "$TMP/worker-b" ] && ok "several windows: worker in a later window received SIGTERM" || fail "several windows: worker in a later window received SIGTERM"
[ "$ELAPSED" -ge 2 ] && [ "$ELAPSED" -le 4 ] && ok "several windows: waited for the worker (${ELAPSED}s)" || fail "several windows: waited for the worker (${ELAPSED}s)"
echo "$SHELL_PID" > "$TMP/panes"

# Worker with slow cleanup: waited for, got SIGTERM
start_worker 2 a
echo "$MAIN_PID $SHELL_PID $WORKER_PID" | tr ' ' '\n' > "$TMP/procs"
run_stop 6
check "worker: exits 0" "$RC" 0
[ -f "$TMP/worker-a" ] && ok "worker: received SIGTERM" || fail "worker: received SIGTERM"
[ "$ELAPSED" -ge 2 ] && [ "$ELAPSED" -le 4 ] && ok "worker: waited for cleanup (${ELAPSED}s)" || fail "worker: waited for cleanup (${ELAPSED}s)"
kill -0 "$WORKER_PID" 2>/dev/null && fail "worker: gone" || ok "worker: gone"

# Process that ignores SIGTERM: wait ends at the limit
start_stubborn
echo "$MAIN_PID $SHELL_PID $STUBBORN_PID" | tr ' ' '\n' > "$TMP/procs"
run_stop 2
check "stubborn: exits 0" "$RC" 0
[ "$ELAPSED" -ge 2 ] && [ "$ELAPSED" -le 4 ] && ok "stubborn: wait limited (${ELAPSED}s)" || fail "stubborn: wait limited (${ELAPSED}s)"
grep -q "Still running after 2s: $STUBBORN_PID" "$TMP/out" && ok "stubborn: logged" || fail "stubborn: logged"
kill -KILL "$STUBBORN_PID" 2>/dev/null

# Exited processes still listed in cgroup.procs are ignored
echo "$MAIN_PID $SHELL_PID 999999" | tr ' ' '\n' > "$TMP/procs"
run_stop
check "stale pid: exits 0" "$RC" 0
[ "$ELAPSED" -le 1 ] && ok "stale pid: no wait" || fail "stale pid: no wait (${ELAPSED}s)"

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
