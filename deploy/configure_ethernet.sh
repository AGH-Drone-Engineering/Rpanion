#!/bin/bash
set -e
set -x

echo "Configuring Ethernet profiles..."

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
sudo chmod 664 /etc/default/rpanion-eth-alias

sudo tee /etc/NetworkManager/dispatcher.d/99-eth0-alias.sh > /dev/null << 'EOF'
#!/bin/sh
IFACE="$1"
ACTION="$2"

case "$IFACE" in
    eth*|end*|en*) ;;
    *) exit 0 ;;
esac

if [ "$ACTION" = "up" ]; then
    CONFIG_FILE="/etc/default/rpanion-eth-alias"
    if [ -f "$CONFIG_FILE" ]; then
        . "$CONFIG_FILE"
        if [ -n "$ETH_ALIASES" ]; then
            for entry in $ETH_ALIASES; do
                ip addr add "$entry" dev "$IFACE" 2>/dev/null || true
            done
        fi
        if [ "$ALIAS_ENABLED" = "true" ] && [ -n "$ALIAS_IP" ]; then
            PREFIX="24"
            case "$ALIAS_NETMASK" in
                "255.255.255.0") PREFIX="24" ;;
                "255.255.0.0") PREFIX="16" ;;
                "255.0.0.0") PREFIX="8" ;;
                "255.255.255.128") PREFIX="25" ;;
                "255.255.255.192") PREFIX="26" ;;
                "255.255.255.224") PREFIX="27" ;;
                "255.255.255.240") PREFIX="28" ;;
                "255.255.255.248") PREFIX="29" ;;
                "255.255.255.252") PREFIX="30" ;;
            esac
            ip addr add "${ALIAS_IP}/${PREFIX}" dev "$IFACE" 2>/dev/null || true
        fi
    fi
fi
EOF
sudo chmod 755 /etc/NetworkManager/dispatcher.d/99-eth0-alias.sh
sudo chown root:root /etc/NetworkManager/dispatcher.d/99-eth0-alias.sh

echo "Ethernet configuration completed."

