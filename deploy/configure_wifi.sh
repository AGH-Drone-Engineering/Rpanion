#!/bin/bash
set -e
set -x

echo "Configuring WiFi power save and AP watchdog..."

# The rpanion user is normally created by the .deb postinst, which runs after this script
if ! getent passwd rpanion >/dev/null; then
    sudo adduser --system --group --quiet rpanion
fi

# Disable WiFi power save (2 = disabled in NetworkManager)
sudo tee /etc/NetworkManager/conf.d/disable-wifi-powersave.conf << 'EOF'
[connection]
wifi.powersave = 2
EOF

# Ensure WiFiAP does not autoconnect on its own so client reconnects take precedence
if nmcli connection show "WiFiAP" >/dev/null 2>&1; then
    sudo nmcli connection modify "WiFiAP" connection.autoconnect no
fi

# Configure shared runtime directory for wifi watchdog
sudo tee /etc/tmpfiles.d/rpanion-wifi.conf << 'EOF'
d /run/rpanion-wifi 0770 root rpanion -
EOF
sudo systemd-tmpfiles --create

# Install AP fallback watchdog service (replaces the former 10 s timer)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo install -o root -g root -m 755 "$SCRIPT_DIR/rpanion-wifi-watchdog.sh" /usr/local/bin/rpanion-wifi-watchdog.sh
sudo install -o root -g root -m 644 "$SCRIPT_DIR/rpanion-wifi-watchdog.service" /etc/systemd/system/rpanion-wifi-watchdog.service
if [ -f /etc/systemd/system/rpanion-wifi-watchdog.timer ]; then
    sudo systemctl disable --now rpanion-wifi-watchdog.timer || true
    sudo rm -f /etc/systemd/system/rpanion-wifi-watchdog.timer
fi

# Parsed (not sourced) by the watchdog; written by rpanion-server
if [ ! -f /etc/default/rpanion-wifi ]; then
    echo "AP_AUTO_RECONNECT=true" | sudo tee /etc/default/rpanion-wifi > /dev/null
fi
sudo chown rpanion:rpanion /etc/default/rpanion-wifi
sudo chmod 644 /etc/default/rpanion-wifi

sudo systemctl daemon-reload
sudo systemctl enable --now rpanion-wifi-watchdog.service

echo "WiFi configuration completed."

