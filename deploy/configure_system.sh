#!/bin/bash
set -e
set -x

echo "Configuring rpanion-system helper, sudoers rules, web terminal and memory settings..."

# The rpanion user is normally created by the .deb postinst, which runs after this script
if ! getent passwd rpanion >/dev/null; then
    sudo adduser --system --group --quiet rpanion
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo install -o root -g root -m 755 "$SCRIPT_DIR/../server/rpanion-system.sh" /usr/local/sbin/rpanion-system

# Separate fragment from the one written by the .deb postinst, so both install paths work.
# Validate before install: a broken sudoers fragment disables sudo entirely
SUDOERS_TMP=$(mktemp)
cat <<'SUDOERS' > "$SUDOERS_TMP"
# Window list polled every 3 s by the web terminal
# Alias names must differ between sudoers fragments
Cmnd_Alias RPANION_TMUX_POLL_IMAGE = /usr/bin/tmux -N -S /run/rpanion-terminal/tmux.sock list-windows *
Defaults!RPANION_TMUX_POLL_IMAGE !log_allowed, !pam_session
rpanion ALL=(ALL) NOPASSWD: \
  /usr/local/sbin/rpanion-system hostname *, \
  /usr/local/sbin/rpanion-system sshpassword, \
  /usr/bin/systemctl start rpanion-terminal, \
  /usr/bin/systemctl stop --no-block rpanion-terminal
rpanion ALL=(#1000) NOPASSWD: /usr/bin/tmux -N -S /run/rpanion-terminal/tmux.sock *
SUDOERS
if sudo visudo -cf "$SUDOERS_TMP" >/dev/null; then
    sudo install -o root -g root -m 440 "$SUDOERS_TMP" /etc/sudoers.d/rpanion-system
else
    echo "Generated sudoers fragment is invalid, not installed" >&2
    rm -f "$SUDOERS_TMP"
    exit 1
fi
rm -f "$SUDOERS_TMP"

## Generate missing SSH host keys on boot; images are created without them
sudo install -o root -g root -m 755 -d /etc/systemd/system/ssh.service.d
sudo install -o root -g root -m 644 "$SCRIPT_DIR/ssh-hostkeys.conf" /etc/systemd/system/ssh.service.d/rpanion-hostkeys.conf

## Terminal session (tmux as user 1000)
sudo install -o root -g root -m 755 -d /usr/local/lib/rpanion-terminal
sudo install -o root -g root -m 644 "$SCRIPT_DIR/rpanion-terminal.tmux.conf" /usr/local/lib/rpanion-terminal/tmux.conf
sudo install -o root -g root -m 755 "$SCRIPT_DIR/rpanion-terminal-stop.sh" /usr/local/lib/rpanion-terminal/stop.sh
sudo install -o root -g root -m 644 "$SCRIPT_DIR/rpanion-terminal.service" /etc/systemd/system/rpanion-terminal.service

## Out-of-memory handling: the kernel OOM killer stops the largest process; Rpanion is excluded
## from that choice and keeps its memory, processes of user 1000 do not swap
for unit in rpanion-server.service system.slice user-1000.slice; do
    sudo install -o root -g root -m 755 -d "/etc/systemd/system/$unit.d"
done
sudo install -o root -g root -m 644 "$SCRIPT_DIR/rpanion-server-memory.conf" /etc/systemd/system/rpanion-server.service.d/rpanion-memory.conf
sudo install -o root -g root -m 644 "$SCRIPT_DIR/rpanion-system-slice.conf" /etc/systemd/system/system.slice.d/rpanion-memory.conf
sudo install -o root -g root -m 644 "$SCRIPT_DIR/rpanion-user-slice.conf" /etc/systemd/system/user-1000.slice.d/rpanion-memory.conf

sudo systemctl daemon-reload
# The terminal unit is started on demand from the web UI

# Keeps the user manager running without a login session, so /run/user/1000 exists for the terminal
TERMINAL_USER=$(getent passwd 1000 | cut -d: -f1 || true)
if [ -n "$TERMINAL_USER" ]; then
    sudo loginctl enable-linger "$TERMINAL_USER"
fi

# Memory controller for MemoryLow, MemorySwapMax and the session statistics. Takes effect after a reboot. RPANION_SKIP_CMDLINE=1 skips the edit.
if [ "${RPANION_SKIP_CMDLINE:-0}" != 1 ]; then
    sudo "$SCRIPT_DIR/enable-memory-cgroup.sh"
fi

echo "rpanion-system helper, sudoers rules, web terminal and memory settings configured."
