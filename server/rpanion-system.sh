#!/bin/bash
# Root helper for device settings, run through sudo by server/systemIdentity.js.
# Installed to /usr/local/sbin/rpanion-system (root-owned) because the
# rpanion user can write to the application directory.
#   rpanion-system hostname <name> [--ap]  hostname and mDNS name; --ap also sets the WiFiAP SSID
#   rpanion-system sshpassword      password on stdin, one line
# RPANION_* variables exist for tests only; sudo env_reset removes them.
set -eu

SSH_USER=pi
AP_CON=WiFiAP
HOSTS_FILE=${RPANION_HOSTS_FILE:-/etc/hosts}
LOCK_FILE=${RPANION_LOCK_FILE:-/run/rpanion-system.lock}

# The device name can also become the AP SSID, which is limited to 32 bytes.
# All-digit names are read as IPv4 numbers by inet_aton().
valid_device_name() {
    [[ "$1" =~ ^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$ ]] &&
        [ "$1" != localhost ] &&
        ! [[ "$1" =~ ^[0-9]+$ ]]
}

update_hosts() {
    # sudo resolves the own hostname through the 127.0.1.1 entry
    if grep -q '^127\.0\.1\.1[[:space:]]' "$HOSTS_FILE"; then
        sed -i -E "s/^127\.0\.1\.1[[:space:]].*/127.0.1.1 $1 $1/" "$HOSTS_FILE"
    else
        echo "127.0.1.1 $1 $1" >> "$HOSTS_FILE"
    fi
}

restart_avahi() {
    # Not installed or stopped: no mDNS to update
    if systemctl is-active --quiet avahi-daemon; then
        systemctl restart avahi-daemon
    fi
}

set_device_name() {
    local name=$1 update_ap=$2 old_name hosts_backup ap_exists=0 ap_active=0 old_ssid=""

    old_name=$(hostname)
    if [ "$update_ap" = 1 ] && nmcli -g connection.id connection show "$AP_CON" >/dev/null 2>&1; then
        ap_exists=1
        old_ssid=$(nmcli -g 802-11-wireless.ssid connection show "$AP_CON")
        if nmcli -g GENERAL.STATE connection show "$AP_CON" 2>/dev/null | grep -q activated; then
            ap_active=1
        fi
    fi
    hosts_backup=$(mktemp)
    cp -p "$HOSTS_FILE" "$hosts_backup"

    if ! { hostnamectl set-hostname "$name" &&
           update_hosts "$name" &&
           { [ "$ap_exists" = 0 ] || nmcli connection modify "$AP_CON" 802-11-wireless.ssid "$name"; } &&
           restart_avahi; }; then
        echo "Changing device name failed, restoring $old_name" >&2
        hostnamectl set-hostname "$old_name" || true
        cp -p "$hosts_backup" "$HOSTS_FILE" || true
        if [ "$ap_exists" = 1 ]; then
            nmcli connection modify "$AP_CON" 802-11-wireless.ssid "$old_ssid" || true
        fi
        restart_avahi || true
        rm -f "$hosts_backup"
        exit 1
    fi
    rm -f "$hosts_backup"

    # A new SSID needs re-activation, which drops clients of the AP, possibly the
    # operator's own session. Delayed so the HTTP response is delivered first.
    if [ "$ap_active" = 1 ]; then
        if ! systemd-run --quiet --collect --on-active=3 /usr/bin/nmcli connection up "$AP_CON" >/dev/null; then
            echo "Device name changed; $AP_CON keeps the old SSID until it is re-activated" >&2
        fi
    fi
}

exec 9>"$LOCK_FILE"
if ! flock -w 30 9; then
    echo "Another device settings change is in progress" >&2
    exit 75
fi

case "${1:-}" in
    hostname)
        name="${2:-}"
        case "${3:-}" in
            "") update_ap=0 ;;
            --ap) update_ap=1 ;;
            *) echo "Usage: $0 hostname <name> [--ap]" >&2; exit 64 ;;
        esac
        if ! valid_device_name "$name"; then
            echo "Invalid device name" >&2
            exit 2
        fi
        set_device_name "$name" "$update_ap"
        ;;
    sshpassword)
        IFS= read -r password || true
        if [ -z "$password" ] || [[ "$password" == *[[:cntrl:]]* ]]; then
            echo "Invalid password" >&2
            exit 2
        fi
        if ! getent passwd "$SSH_USER" >/dev/null; then
            echo "User $SSH_USER does not exist" >&2
            exit 3
        fi
        printf '%s:%s\n' "$SSH_USER" "$password" | chpasswd
        ;;
    *)
        echo "Usage: $0 hostname <name> [--ap] | sshpassword" >&2
        exit 64
        ;;
esac
