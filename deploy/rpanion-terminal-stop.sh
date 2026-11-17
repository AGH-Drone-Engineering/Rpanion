#!/bin/bash
# ExecStop of rpanion-terminal.service. Terminates the processes of the unit while the tmux server
# and the pane shells stay up, so the pty exists while main.py handles SIGTERM (a write to a closed
# pty fails with EIO). systemd then stops the rest. RPANION_* variables exist for tests only.
set -u

TMUX_BIN=${RPANION_TMUX:-/usr/bin/tmux}
TMUX_SOCK=${RPANION_TERMINAL_SOCK:-/run/rpanion-terminal/tmux.sock}
WAIT_SECONDS=${RPANION_TERMINAL_WAIT:-13}   # TimeoutStopSec minus 2 s
# ExecStop runs in the cgroup of the unit
CGROUP_PROCS=${RPANION_CGROUP_PROCS:-/sys/fs/cgroup$(sed -n 's/^0:://p' /proc/self/cgroup)/cgroup.procs}

# True for this script and everything it started (sed, pgrep and subshells show up in cgroup.procs)
is_own() {
    local pid=$1 parent
    while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
        [ "$pid" = "$$" ] && return 0
        parent=$(sed -n 's/^PPid:[[:space:]]*//p' "/proc/$pid/status" 2>/dev/null)
        # A process that exited meanwhile needs no waiting for
        [ -z "$parent" ] && return 0
        pid=$parent
    done
    return 1
}

unit_pids() {
    local pid state
    while read -r pid; do
        [ -d "/proc/$pid" ] || continue
        state=$(sed -n 's/^State:[[:space:]]*\(.\).*/\1/p' "/proc/$pid/status" 2>/dev/null)
        [ "$state" = Z ] && continue
        echo "$pid"
    done < "$CGROUP_PROCS"
}

# Panes that run a shell: interactive shells ignore SIGTERM, so they are not waited for
pane_shells() {
    local pid
    "$TMUX_BIN" -S "$TMUX_SOCK" list-panes -a -F '#{pane_pid}' 2>/dev/null | while read -r pid; do
        case "$(cat "/proc/$pid/comm" 2>/dev/null)" in
            bash|sh|zsh|dash) echo "$pid" ;;
        esac
    done
}

# Processes of the unit except the tmux server and this script's own
others() {
    local pid
    for pid in $(unit_pids); do
        [ "$pid" = "${MAINPID:-}" ] && continue
        is_own "$pid" && continue
        echo "$pid"
    done
}

for pid in $(others); do
    kill -TERM "$pid" 2>/dev/null
done

deadline=$((SECONDS + WAIT_SECONDS))
while :; do
    left=$(others | grep -vxF -f <(pane_shells) || true)
    [ -z "$left" ] && exit 0
    if [ "$SECONDS" -ge "$deadline" ]; then
        echo "Still running after ${WAIT_SECONDS}s: $(for pid in $left; do echo -n "$pid($(cat "/proc/$pid/comm" 2>/dev/null)) "; done)" >&2
        exit 0
    fi
    sleep 0.2
done
