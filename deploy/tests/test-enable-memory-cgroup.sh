#!/bin/bash
# Checks deploy/enable-memory-cgroup.sh on temporary files; no root needed.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$DIR/../enable-memory-cgroup.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILS=0

ok()   { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILS=$((FAILS + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }

run() {
    RPANION_CMDLINE_FILE="$TMP/cmdline.txt" RPANION_CGROUP_CONTROLLERS="$TMP/controllers" bash "$SCRIPT" >"$TMP/out" 2>&1
}

echo "cpuset cpu io pids" > "$TMP/controllers"
echo "console=tty1 root=/dev/sda2 cgroup_disable=memory rootwait " > "$TMP/cmdline.txt"
run; check "adds option: exits 0" "$?" 0
check "appended after cgroup_disable" "$(cat "$TMP/cmdline.txt")" "console=tty1 root=/dev/sda2 cgroup_disable=memory rootwait cgroup_enable=memory"
check "still one line" "$(wc -l < "$TMP/cmdline.txt")" 1
run; check "second run: exits 0" "$?" 0
check "second run: unchanged" "$(grep -o cgroup_enable=memory "$TMP/cmdline.txt" | wc -l)" 1

echo "console=tty1 rootwait" > "$TMP/cmdline.txt"
echo "cpuset cpu io memory pids" > "$TMP/controllers"
run; check "controller present: exits 0" "$?" 0
check "controller present: file untouched" "$(cat "$TMP/cmdline.txt")" "console=tty1 rootwait"

echo "cpuset cpu io pids" > "$TMP/controllers"
rm "$TMP/cmdline.txt"
run; check "no cmdline.txt: exits 0" "$?" 0
[ -e "$TMP/cmdline.txt" ] && fail "no cmdline.txt: not created" || ok "no cmdline.txt: not created"

# Raspberry Pi OS writes cmdline.txt without a trailing newline
echo "cpuset cpu io pids" > "$TMP/controllers"
printf 'console=tty1 cgroup_disable=memory rootwait' > "$TMP/cmdline.txt"
run; check "no trailing newline: exits 0" "$?" 0
check "no trailing newline: appended" "$(cat "$TMP/cmdline.txt")" "console=tty1 cgroup_disable=memory rootwait cgroup_enable=memory"
check "no trailing newline: none added" "$(tail -c 1 "$TMP/cmdline.txt" | od -An -c | tr -d ' ')" "y"

printf 'console=tty1\nrootwait\n' > "$TMP/cmdline.txt"
run; check "two lines: exits 1" "$?" 1
check "two lines: restored" "$(cat "$TMP/cmdline.txt" | tr '\n' ' ')" "console=tty1 rootwait "

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
