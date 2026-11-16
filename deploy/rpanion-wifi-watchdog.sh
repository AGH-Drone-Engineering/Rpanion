#!/bin/bash
# Rpanion Wi-Fi fallback watchdog (runs as root, long-running service).
# - Brings up the WiFiAP profile when wlan0 has been without a client
#   connection for FALLBACK_DELAY seconds.
# - While the AP is up and has no stations, switches back to a saved client
#   network that is in range (unless AP_AUTO_RECONNECT=false or the user
#   started the AP manually: manual-hold flag written by rpanion-server).
# State dir is writable by the rpanion group, so files are replaced via
# mktemp+mv (never written through an existing path) and parsed as numbers.

IFACE="wlan0"
AP_CON="WiFiAP"
FALLBACK_DELAY=20       # seconds disconnected before activating AP
INTERVAL=10             # seconds between checks
RESCAN_INTERVAL=60      # minimum seconds between explicit scans in AP mode
BACKOFF=300             # seconds before retrying a client profile that failed
CONNECT_WAIT=30         # nmcli --wait for client activation
STATE_DIR="${RPANION_WIFI_STATE_DIR:-/run/rpanion-wifi}"
CONFIG_FILE="${RPANION_WIFI_CONFIG:-/etc/default/rpanion-wifi}"

log() {
    echo "[watchdog] $*"
}

now() {
    date +%s
}

read_auto_reconnect() {
    if [ -f "$CONFIG_FILE" ] && grep -qx 'AP_AUTO_RECONNECT=false' "$CONFIG_FILE"; then
        echo false
    else
        echo true
    fi
}

# write_state <name> <value>
write_state() {
    local tmp
    tmp=$(mktemp "$STATE_DIR/.tmp.XXXXXX") || return 1
    printf '%s\n' "$2" > "$tmp" && mv -f "$tmp" "$STATE_DIR/$1"
}

# read_epoch <name>: prints the stored number, or nothing if absent/invalid
read_epoch() {
    local file="$STATE_DIR/$1" value
    [ -f "$file" ] && [ ! -L "$file" ] || return 0
    value=$(head -c 32 "$file" | tr -d '\n')
    case "$value" in
        ''|*[!0-9]*) ;;
        *) echo "$value" ;;
    esac
}

clear_state() {
    local name
    for name in "$@"; do
        rm -f "$STATE_DIR/$name"
    done
}

# ssid_visible <ssid> <newline-separated list>
ssid_visible() {
    printf '%s\n' "$2" | grep -qxF -- "$1"
}

in_backoff() {
    local failed
    failed=$(read_epoch "backoff-$1")
    [ -n "$failed" ] && [ $(( $(now) - failed )) -lt "$BACKOFF" ]
}

visible_ssids() {
    local last
    last=$(read_epoch last-rescan)
    if [ -z "$last" ] || [ $(( $(now) - last )) -ge "$RESCAN_INTERVAL" ]; then
        nmcli device wifi rescan ifname "$IFACE" 2>/dev/null || true
        write_state last-rescan "$(now)"
    fi
    # Single field with escaping off: SSIDs are printed verbatim
    nmcli -e no -t -f SSID dev wifi list ifname "$IFACE" --rescan no 2>/dev/null | grep -v '^$'
}

# Saved Wi-Fi client profiles with autoconnect, highest priority first: "<uuid> <ssid>" lines
saved_client_profiles() {
    local ap_uuid uuids line ssid=""
    ap_uuid=$(nmcli -g connection.uuid connection show "$AP_CON" 2>/dev/null)
    # Fields before NAME never contain ':'; NAME is escaped and not used
    uuids=$(nmcli -t -f AUTOCONNECT-PRIORITY,UUID,TYPE,AUTOCONNECT,NAME connection show 2>/dev/null \
        | awk -F: '$3 == "802-11-wireless" && $4 == "yes" { print $1 ":" $2 }' \
        | sort -t: -k1,1nr | cut -d: -f2 | grep -vxF -- "$ap_uuid")
    [ -n "$uuids" ] || return 0
    # shellcheck disable=SC2086
    nmcli -s -t -f 802-11-wireless.ssid,connection.uuid connection show $uuids 2>/dev/null | while IFS= read -r line; do
        case "$line" in
            802-11-wireless.ssid:*) ssid="${line#802-11-wireless.ssid:}" ;;
            connection.uuid:*) [ -n "$ssid" ] && echo "${line#connection.uuid:} $ssid"; ssid="" ;;
        esac
    done
}

try_client_reconnect() {
    local ap_ssid visible uuid ssid
    ap_ssid=$(nmcli -g 802-11-wireless.ssid connection show "$AP_CON" 2>/dev/null)
    visible=$(visible_ssids | grep -vxF -- "$ap_ssid")
    [ -n "$visible" ] || return 0
    while read -r uuid ssid; do
        [ -n "$uuid" ] || continue
        in_backoff "$uuid" && continue
        ssid_visible "$ssid" "$visible" || continue
        log "Saved network '$ssid' in range, switching from AP"
        if nmcli --wait "$CONNECT_WAIT" connection up "$uuid"; then
            clear_state disconnect-time "backoff-$uuid"
        else
            log "Connecting to '$ssid' failed, retry after ${BACKOFF}s"
            write_state "backoff-$uuid" "$(now)"
        fi
        return 0
    done < <(saved_client_profiles)
}

run_once() {
    local dev_line dev_type dev_state active_con started
    dev_line=$(nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev 2>/dev/null | grep "^${IFACE}:")
    [ -n "$dev_line" ] || return 0
    IFS=':' read -r _ dev_type dev_state active_con <<< "$dev_line"
    [ "$dev_type" = "wifi" ] || return 0
    [ "$dev_state" = "unavailable" ] && return 0

    if [ "$dev_state" = "connected" ] && [ "$active_con" != "$AP_CON" ]; then
        clear_state disconnect-time manual-hold
        return 0
    fi

    if [ "$dev_state" = "connected" ]; then
        clear_state disconnect-time
        iw dev "$IFACE" station dump 2>/dev/null | grep -q "^Station " && return 0
        [ -e "$STATE_DIR/manual-hold" ] && return 0
        [ "$(read_auto_reconnect)" = "true" ] || return 0
        try_client_reconnect
        return 0
    fi

    case "$dev_state" in
        connecting*) return 0 ;;
    esac

    started=$(read_epoch disconnect-time)
    if [ -z "$started" ]; then
        write_state disconnect-time "$(now)"
        return 0
    fi
    if [ $(( $(now) - started )) -ge "$FALLBACK_DELAY" ]; then
        log "$IFACE disconnected for $(( $(now) - started ))s, activating $AP_CON"
        nmcli --wait "$CONNECT_WAIT" connection up "$AP_CON" || true
        clear_state disconnect-time
    fi
}

main() {
    mkdir -p "$STATE_DIR"
    if [ "${1:-}" = "--once" ]; then
        run_once
        return
    fi
    while true; do
        run_once
        sleep "$INTERVAL"
    done
}

# Functions only when sourced (tests)
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    main "$@"
fi
