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
CLIENT_FILE="$RUN_DIR/connected-client"

# Read optional configuration
if [ -f "/etc/default/rpanion-wifi" ]; then
    . "/etc/default/rpanion-wifi"
fi
AP_AUTO_RECONNECT=${AP_AUTO_RECONNECT:-true}

# Fetch device status in a single process invocation
DEV_LINE=$(nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev 2>/dev/null | grep "^${IFACE}:")
if [ -z "$DEV_LINE" ]; then
    exit 0
fi

IFS=':' read -r DEV_IFACE DEV_TYPE DEV_STATE ACTIVE_CON <<< "$DEV_LINE"

if [ "$DEV_TYPE" != "wifi" ]; then
    exit 0
fi

# If WiFi radio is disabled, do nothing
if [ "$DEV_STATE" = "unavailable" ] && [ "$(nmcli radio wifi 2>/dev/null)" = "disabled" ]; then
    exit 0
fi

# Case 1: wlan0 is connected to a regular client Wi-Fi network (not the fallback AP)
if [ "$DEV_STATE" = "connected" ] && [ -n "$ACTIVE_CON" ] && [ "$ACTIVE_CON" != "$AP_CON" ] && [ "$ACTIVE_CON" != "--" ]; then
    rm -f "$DISCONNECT_FILE" "$CLIENT_FILE"
    exit 0
fi

# Case 2: wlan0 is connected to the fallback AP (WiFiAP)
if [ "$DEV_STATE" = "connected" ] && [ "$ACTIVE_CON" = "$AP_CON" ]; then
    rm -f "$DISCONNECT_FILE"

    # Check if any client station is currently connected to the AP
    STATION_COUNT=$(iw dev "$IFACE" station dump 2>/dev/null | grep -c "^Station ")
    if [ "$STATION_COUNT" -gt 0 ]; then
        # AP is actively used by a client station; do not rescan or switch away
        touch "$CLIENT_FILE"
        exit 0
    fi
    rm -f "$CLIENT_FILE"

    # If AP auto-reconnect is disabled, stay in AP permanently without background scanning
    if [ "$AP_AUTO_RECONNECT" = "false" ]; then
        exit 0
    fi

    # Check cached visible SSIDs first to avoid interrupting radio with active rescan
    VISIBLE_SSIDS=$(nmcli -t -f SSID dev wifi list 2>/dev/null | grep -v '^$' | grep -v "^${AP_CON}$" | grep -v "^rpanion$" | sort -u)
    if [ -z "$VISIBLE_SSIDS" ]; then
        nmcli device wifi rescan 2>/dev/null || true
        VISIBLE_SSIDS=$(nmcli -t -f SSID dev wifi list 2>/dev/null | grep -v '^$' | grep -v "^${AP_CON}$" | grep -v "^rpanion$" | sort -u)
    fi

    if [ -n "$VISIBLE_SSIDS" ]; then
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
    fi

    exit 0
fi

# Case 3: wlan0 is connecting, let it finish trying
case "$DEV_STATE" in
    connecting*)
        exit 0
        ;;
esac

# Case 4: wlan0 is disconnected or failed
rm -f "$CLIENT_FILE"
NOW=$(date +%s)
if [ ! -f "$DISCONNECT_FILE" ]; then
    echo "$NOW" > "$DISCONNECT_FILE"
    chmod 666 "$DISCONNECT_FILE" 2>/dev/null || true
    nmcli device wifi rescan 2>/dev/null || true
    exit 0
fi

DISCONNECT_TIME=$(cat "$DISCONNECT_FILE" 2>/dev/null || echo "$NOW")
ELAPSED=$((NOW - DISCONNECT_TIME))

if [ "$ELAPSED" -ge "$FALLBACK_DELAY" ]; then
    echo "[watchdog] wlan0 disconnected for ${ELAPSED}s (>= ${FALLBACK_DELAY}s). Activating AP: ${AP_CON}..."
    nmcli connection up "$AP_CON" || true
    rm -f "$DISCONNECT_FILE"
fi
