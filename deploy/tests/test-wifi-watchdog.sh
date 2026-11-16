#!/bin/bash
# Exercises rpanion-wifi-watchdog.sh functions with a stubbed nmcli/iw.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILS=0
export RPANION_WIFI_STATE_DIR="$TMP/state"
export RPANION_WIFI_CONFIG="$TMP/rpanion-wifi"
mkdir -p "$RPANION_WIFI_STATE_DIR"

# shellcheck source=../rpanion-wifi-watchdog.sh
. "$DIR/../rpanion-wifi-watchdog.sh"

check() {
    # $1 name, rest: command that must succeed
    local name=$1; shift
    if "$@"; then echo "ok   - $name"; else echo "FAIL - $name"; FAILS=$((FAILS + 1)); fi
}

# --- stubs -------------------------------------------------------------
DEV_LINE="wlan0:wifi:connected:WiFiAP"
VISIBLE=""
STATIONS=0
CALLS="$TMP/calls"
: > "$CALLS"
nmcli() {
    echo "nmcli $*" >> "$CALLS"
    case "$*" in
        *"DEVICE,TYPE,STATE,CONNECTION dev"*) echo "$DEV_LINE" ;;
        *"802-11-wireless.ssid connection show WiFiAP"*) echo "rpanion" ;;
        *"-f SSID dev wifi list"*) printf '%s\n' "$VISIBLE" ;;
        *"AUTOCONNECT-PRIORITY,UUID,TYPE,AUTOCONNECT,NAME connection show"*)
            echo "100:uuid-home:802-11-wireless:yes:My\\:Net"
            echo "0:uuid-ap:802-11-wireless:no:WiFiAP"
            echo "50:uuid-dot:802-11-wireless:yes:dot" ;;
        *"-g connection.uuid connection show WiFiAP"*) echo "uuid-ap" ;;
        *"802-11-wireless.ssid,connection.uuid connection show"*)
            printf '802-11-wireless.ssid:My:Net\nconnection.uuid:uuid-home\n802-11-wireless.ssid:a.c\nconnection.uuid:uuid-dot\n' ;;
        *"connection up"*) return "${UP_RC:-0}" ;;
    esac
    return 0
}
iw() { [ "$STATIONS" -gt 0 ] && echo "Station aa:bb (on wlan0)"; return 0; }
calls() { cat "$CALLS"; }
reset_calls() { : > "$CALLS"; rm -f "$RPANION_WIFI_STATE_DIR"/*; }

# --- helpers -------------------------------------------------------------
check "ssid with colon matched literally" ssid_visible 'My:Net' $'other\nMy:Net'
check "dot is not a regex wildcard" bash -c "$(declare -f ssid_visible); ! ssid_visible 'a.c' 'abc'"
check "leading dash is not an option" ssid_visible '-x' $'-x\ny'
check "auto-reconnect defaults to true" test "$(read_auto_reconnect)" = true
echo 'AP_AUTO_RECONNECT=false' > "$RPANION_WIFI_CONFIG"
check "auto-reconnect read from config" test "$(read_auto_reconnect)" = false
echo 'AP_AUTO_RECONNECT=$(touch '"$TMP"'/pwn)' > "$RPANION_WIFI_CONFIG"
check "config is not executed" test ! -e "$TMP/pwn"
check "invalid config falls back to true" test "$(read_auto_reconnect)" = true
rm -f "$RPANION_WIFI_CONFIG"

ln -s "$TMP/victim" "$RPANION_WIFI_STATE_DIR/disconnect-time"
write_state disconnect-time 123
check "state write replaces a planted symlink" test ! -e "$TMP/victim"
check "state file is a regular file" test -f "$RPANION_WIFI_STATE_DIR/disconnect-time" -a ! -L "$RPANION_WIFI_STATE_DIR/disconnect-time"
echo "garbage" > "$RPANION_WIFI_STATE_DIR/disconnect-time"
check "non-numeric state reads as empty" test -z "$(read_epoch disconnect-time)"

# --- run_once scenarios ---------------------------------------------------
reset_calls; DEV_LINE="wlan0:wifi:connected:WiFiAP"; VISIBLE=$'My:Net\nrpanion'
run_once
check "AP idle: reconnects to visible saved SSID with colon" grep -q "connection up uuid-home" "$CALLS"
check "AP idle: uses bounded wait" grep -q -- "--wait 30 connection up uuid-home" "$CALLS"

reset_calls; touch "$RPANION_WIFI_STATE_DIR/manual-hold"
run_once
check "manual hold: no reconnect" bash -c "! grep -q 'connection up' '$CALLS'"

reset_calls; STATIONS=1
run_once
check "AP with clients: no reconnect" bash -c "! grep -q 'connection up' '$CALLS'"
STATIONS=0

reset_calls; UP_RC=1
run_once
check "failed reconnect records backoff" test -n "$(read_epoch backoff-uuid-home)"
: > "$CALLS"
run_once
check "backoff: no retry within window" bash -c "! grep -q 'connection up uuid-home' '$CALLS'"
UP_RC=0

reset_calls; VISIBLE=$'abc\nrpanion'
run_once
check "regex SSID 'a.c' not matched by 'abc'" bash -c "! grep -q 'connection up' '$CALLS'"

reset_calls; DEV_LINE="wlan0:wifi:connected:bajer"; touch "$RPANION_WIFI_STATE_DIR/manual-hold"
run_once
check "client connected: clears manual hold" test ! -e "$RPANION_WIFI_STATE_DIR/manual-hold"

reset_calls; DEV_LINE="wlan0:wifi:disconnected:--"
run_once
check "disconnected: starts timer" test -n "$(read_epoch disconnect-time)"
write_state disconnect-time $(( $(date +%s) - 25 ))
: > "$CALLS"
run_once
check "disconnected > 20 s: brings AP up" grep -q "connection up WiFiAP" "$CALLS"

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
