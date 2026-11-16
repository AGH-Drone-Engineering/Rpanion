#!/bin/bash
set -e
set -x

echo "Configuring Ethernet profiles..."

# The rpanion user is normally created by the .deb postinst, which runs after this script
if ! getent passwd rpanion >/dev/null; then
    sudo adduser --system --group --quiet rpanion
fi

# Primary wired interface: eth0 on RPi 3/4, end0 on some RPi 5 images
ETH_IFACE=$(nmcli -t -f DEVICE,TYPE dev 2>/dev/null | grep ":ethernet$" | head -n1 | cut -d: -f1)
if [ -z "$ETH_IFACE" ]; then
    ETH_IFACE=$(ls /sys/class/net 2>/dev/null | grep -E '^(eth|end|en)' | head -n1)
fi
ETH_IFACE=${ETH_IFACE:-eth0}
echo "Using Ethernet interface: $ETH_IFACE"

# Existing profiles are left as they are: priorities and addresses may have
# been changed in the web UI. Delete a profile to have it recreated.
if nmcli connection show "Ethernet-Client" >/dev/null 2>&1; then
    echo "Ethernet-Client exists, leaving it unchanged"
else
    # DHCP client, preferred on boot; gives up after 5 s so Ethernet-Server can take over
    sudo nmcli connection add type ethernet ifname "$ETH_IFACE" con-name "Ethernet-Client" \
        connection.autoconnect yes \
        connection.autoconnect-priority 100 \
        connection.autoconnect-retries 1 \
        ipv4.method auto \
        ipv4.dhcp-timeout 5 \
        ipv4.may-fail no
fi

if nmcli connection show "Ethernet-Server" >/dev/null 2>&1; then
    echo "Ethernet-Server exists, leaving it unchanged"
else
    # DHCP server fallback
    sudo nmcli connection add type ethernet ifname "$ETH_IFACE" con-name "Ethernet-Server" \
        connection.autoconnect yes \
        connection.autoconnect-priority 50 \
        ipv4.method shared ipv4.addresses 10.0.3.1/24
fi

# Remove the distribution default profile last, and only when it is not
# carrying the current connection (deleting it would drop an SSH session on it).
if nmcli connection show "Wired connection 1" >/dev/null 2>&1; then
    if [ "$(nmcli -g GENERAL.STATE connection show "Wired connection 1" 2>/dev/null)" = "activated" ]; then
        echo "WARNING: 'Wired connection 1' is active and was kept. Delete it after reconnecting over another link."
    else
        sudo nmcli connection delete "Wired connection 1"
    fi
fi

# Dispatcher script for Ethernet secondary IP aliases
sudo mkdir -p /etc/NetworkManager/dispatcher.d
if [ ! -f /etc/default/rpanion-eth-alias ]; then
    echo 'ETH_ALIASES=""' | sudo tee /etc/default/rpanion-eth-alias > /dev/null
fi
sudo chown rpanion:rpanion /etc/default/rpanion-eth-alias
sudo chmod 644 /etc/default/rpanion-eth-alias

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sudo rm -f /etc/NetworkManager/dispatcher.d/99-eth0-alias.sh
sudo install -o root -g root -m 755 "$SCRIPT_DIR/rpanion-eth-alias-dispatcher.sh" /etc/NetworkManager/dispatcher.d/99-rpanion-eth-alias.sh

echo "Ethernet configuration completed."
