#!/bin/bash
set -e
set -x

echo "Configuring device settings helper..."

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
rpanion ALL=(ALL) NOPASSWD: \
  /usr/local/sbin/rpanion-system hostname *, \
  /usr/local/sbin/rpanion-system sshpassword
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
sudo systemctl daemon-reload

echo "Device settings helper configured."
