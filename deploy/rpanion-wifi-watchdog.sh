#!/bin/bash
# Rpanion WiFi Fallback Watchdog
# Manages fallback to AP when client Wi-Fi is lost,
# and automatically reconnects to known networks when they come into range (only when AP is idle).

IFACE="wlan0"
AP_CON="WiFiAP"
FALLBACK_DELAY=20 # seconds disconnected before activating AP
RUN_DIR="/run/rpanion-wifi"
mkdir -p "$RUN_DIR"
chmod 777 "$RUN_DIR" 2>/dev/null || true
DISCONNECT_FILE="$RUN_DIR/disconnect-time"

# Read optional configuration
if [ -f "/etc/default/rpanion-wifi" ]; then
    . "/etc/default/rpanion-wifi"
fi
AP_AUTO_RECONNECT=${AP_AUTO_RECONNECT:-true}

# Check if wlan0 device exists
if ! nmcli dev status | grep -q "^${IFACE}\s\+wifi"; then
    exit 0
fi

# If WiFi radio is disabled, do nothing
if [ "$(nmcli radio wifi 2>/dev/null)" = "disabled" ]; then
    exit 0
fi

# Get current state of wlan0
DEV_STATE=$(nmcli -t -f DEVICE,STATE dev | grep "^${IFACE}:" | cut -d: -f2)

# Get active connection on wlan0 (if any)
ACTIVE_CON=$(nmcli -t -f DEVICE,CONNECTION dev | grep "^${IFACE}:" | cut -d: -f2)

# Case 1: wlan0 is connected to a regular client Wi-Fi network (not the fallback AP)
if [ "$DEV_STATE" = "connected" ] && [ -n "$ACTIVE_CON" ] && [ "$ACTIVE_CON" != "$AP_CON" ] && [ "$ACTIVE_CON" != "--" ]; then
    rm -f "$DISCONNECT_FILE"
    exit 0
fi

# Case 2: wlan0 is connected to the fallback AP (WiFiAP)
if [ "$DEV_STATE" = "connected" ] && [ "$ACTIVE_CON" = "$AP_CON" ]; then
    rm -f "$DISCONNECT_FILE"

    # If AP auto-reconnect is disabled, stay in AP permanently without background scanning
    if [ "$AP_AUTO_RECONNECT" = "false" ]; then
        exit 0
    fi

    # Trigger a background rescan to detect any in-range client networks
    nmcli device wifi rescan 2>/dev/null || true

    # Check if any saved autoconnect client network is visible (sorted by priority descending)
    VISIBLE_SSIDS=$(nmcli -t -f SSID dev wifi list 2>/dev/null | grep -v '^$' | grep -v "^${AP_CON}$" | grep -v "^rpanion$" | sort -u)
    SAVED_WIFI=$(nmcli -t -f AUTOCONNECT-PRIORITY,NAME,TYPE,AUTOCONNECT connection show 2>/dev/null \
        | grep ':802-11-wireless:yes$' \
        | grep -v ":${AP_CON}:" \
        | sort -t: -k1,1nr \
        | cut -d: -f2)

    for CON in $SAVED_WIFI; do
        SSID=$(nmcli -t -g 802-11-wireless.ssid connection show "$CON" 2>/dev/null)
        if [ -n "$SSID" ] && echo "$VISIBLE_SSIDS" | grep -qx "$SSID"; then
            echo "[watchdog] In-range saved Wi-Fi network detected: '$CON' (SSID: '$SSID'). Reconnecting..."
            nmcli connection up "$CON" || true
            exit 0
        fi
    done

    exit 0
fi

# Case 3: wlan0 is connecting, let it finish trying
case "$DEV_STATE" in
    connecting*)
        exit 0
        ;;
esac

# Case 4: wlan0 is disconnected or failed
# Rescan so NetworkManager actively discovers networks when they come into range
nmcli device wifi rescan 2>/dev/null || true

NOW=$(date +%s)
if [ ! -f "$DISCONNECT_FILE" ]; then
    echo "$NOW" > "$DISCONNECT_FILE"
    chmod 666 "$DISCONNECT_FILE" 2>/dev/null || true
    exit 0
fi

DISCONNECT_TIME=$(cat "$DISCONNECT_FILE" 2>/dev/null || echo "$NOW")
ELAPSED=$((NOW - DISCONNECT_TIME))

if [ "$ELAPSED" -ge "$FALLBACK_DELAY" ]; then
    echo "[watchdog] wlan0 disconnected for ${ELAPSED}s (>= ${FALLBACK_DELAY}s). Activating AP: ${AP_CON}..."
    nmcli connection up "$AP_CON" || true
    rm -f "$DISCONNECT_FILE"
fi

