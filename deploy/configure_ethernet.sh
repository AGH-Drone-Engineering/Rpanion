#!/bin/bash
set -e
set -x

echo "Configuring Ethernet profiles..."

# The rpanion user is normally created by the .deb postinst, which runs after this script
if ! getent passwd rpanion >/dev/null; then
    sudo adduser --system --group --quiet rpanion
fi

# Detect primary ethernet interface (supports eth0 on RPi 3/4 and end0 on RPi 5)
ETH_IFACE=$(nmcli -t -f DEVICE,TYPE dev 2>/dev/null | grep ":ethernet$" | head -n1 | cut -d: -f1)
if [ -z "$ETH_IFACE" ]; then
    ETH_IFACE=$(ls /sys/class/net 2>/dev/null | grep -E '^(eth|end|en)' | head -n1 || echo "eth0")
fi
echo "Using Ethernet interface: $ETH_IFACE"

# Remove default connection if present
sudo nmcli connection delete "Wired connection 1" 2>/dev/null || true

# Ethernet-Client: attempts DHCP for 5s (priority 100)
if nmcli connection show "Ethernet-Client" >/dev/null 2>&1; then
    sudo nmcli connection modify "Ethernet-Client" \
        connection.interface-name "$ETH_IFACE" \
        connection.autoconnect yes \
        connection.autoconnect-priority 100 \
        connection.autoconnect-retries 1 \
        ipv4.method auto \
        ipv4.dhcp-timeout 5 \
        ipv4.may-fail no
else
    sudo nmcli connection add type ethernet con-name "Ethernet-Client" ifname "$ETH_IFACE"
    sudo nmcli connection modify "Ethernet-Client" \
        connection.autoconnect yes \
        connection.autoconnect-priority 100 \
        connection.autoconnect-retries 1 \
        ipv4.method auto \
        ipv4.dhcp-timeout 5 \
        ipv4.may-fail no
fi

# Ethernet-Server: DHCP server fallback 10.0.3.1/24 (priority 50)
if nmcli connection show "Ethernet-Server" >/dev/null 2>&1; then
    sudo nmcli connection modify "Ethernet-Server" \
        connection.interface-name "$ETH_IFACE" \
        connection.autoconnect yes \
        connection.autoconnect-priority 50 \
        ipv4.method shared \
        ipv4.addresses 10.0.3.1/24
else
    sudo nmcli connection add type ethernet con-name "Ethernet-Server" ifname "$ETH_IFACE"
    sudo nmcli connection modify "Ethernet-Server" \
        connection.autoconnect yes \
        connection.autoconnect-priority 50 \
        ipv4.method shared \
        ipv4.addresses 10.0.3.1/24
fi

# Install NetworkManager dispatcher script for Ethernet secondary IP aliases
sudo mkdir -p /etc/NetworkManager/dispatcher.d
sudo mkdir -p /etc/default
if [ ! -f /etc/default/rpanion-eth-alias ]; then
    sudo tee /etc/default/rpanion-eth-alias > /dev/null << 'EOF'
ETH_ALIASES=""
EOF
fi
sudo chown rpanion:rpanion /etc/default/rpanion-eth-alias
sudo chmod 644 /etc/default/rpanion-eth-alias

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo rm -f /etc/NetworkManager/dispatcher.d/99-eth0-alias.sh
sudo install -o root -g root -m 755 "$SCRIPT_DIR/rpanion-eth-alias-dispatcher.sh" /etc/NetworkManager/dispatcher.d/99-rpanion-eth-alias.sh

echo "Ethernet configuration completed."

