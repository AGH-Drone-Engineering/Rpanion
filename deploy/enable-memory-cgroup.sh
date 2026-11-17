#!/bin/bash
# Raspberry Pi firmware appends cgroup_disable=memory to the kernel command line. The last of
# cgroup_enable/cgroup_disable wins, so cgroup_enable=memory goes to the end of cmdline.txt.
# Does nothing when the controller is available or there is no cmdline.txt (Jetson, other Debian).
# Run as root. RPANION_* variables exist for tests only.
set -eu

CMDLINE=${RPANION_CMDLINE_FILE:-/boot/firmware/cmdline.txt}
CONTROLLERS=${RPANION_CGROUP_CONTROLLERS:-/sys/fs/cgroup/cgroup.controllers}

if grep -qw memory "$CONTROLLERS" 2>/dev/null; then
    echo "Memory cgroup controller already available"
    exit 0
fi
if [ ! -f "$CMDLINE" ]; then
    echo "No $CMDLINE, memory cgroup controller not changed"
    exit 0
fi
if grep -qw cgroup_enable=memory "$CMDLINE"; then
    echo "cgroup_enable=memory already in $CMDLINE, reboot to activate"
    exit 0
fi

backup=$(mktemp)
cp -p "$CMDLINE" "$backup"
# Trailing blanks removed so the option joins the single line
sed -i '1s/[[:space:]]*$/ cgroup_enable=memory/' "$CMDLINE"
# awk counts a last line without a newline; cmdline.txt on Raspberry Pi OS has none
if [ "$(awk 'END { print NR }' "$CMDLINE")" -ne 1 ] || ! grep -qw cgroup_enable=memory "$CMDLINE"; then
    cp -p "$backup" "$CMDLINE"
    rm -f "$backup"
    echo "Unexpected result, $CMDLINE restored" >&2
    exit 1
fi
rm -f "$backup"
echo "Added cgroup_enable=memory to $CMDLINE, reboot to activate"
