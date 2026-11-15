#!/bin/bash
set -e
set -x

echo "Configuring WiFi power save and AP watchdog..."

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
d /run/rpanion-wifi 0777 root root -
EOF
sudo systemd-tmpfiles --create

# Install AP fallback watchdog service and timer
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo cp "$SCRIPT_DIR/rpanion-wifi-watchdog.sh" /usr/local/bin/rpanion-wifi-watchdog.sh
sudo chmod +x /usr/local/bin/rpanion-wifi-watchdog.sh
sudo cp "$SCRIPT_DIR/rpanion-wifi-watchdog.service" /etc/systemd/system/rpanion-wifi-watchdog.service
sudo cp "$SCRIPT_DIR/rpanion-wifi-watchdog.timer" /etc/systemd/system/rpanion-wifi-watchdog.timer

sudo systemctl daemon-reload
sudo systemctl enable --now rpanion-wifi-watchdog.timer

echo "WiFi configuration completed."

