#!/bin/bash
# Runs configure_ethernet.sh and wifi_access_point.sh against fake nmcli/sudo.
# The fake sudo only records commands; nothing is executed with privileges.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILS=0
mkdir -p "$TMP/bin"

cat > "$TMP/bin/sudo" <<'EOF'
#!/bin/bash
echo "sudo $*" >> "$CALLS"
EOF
cat > "$TMP/bin/nmcli" <<'EOF'
#!/bin/bash
echo "nmcli $*" >> "$CALLS"
case "$*" in
    "-t -f DEVICE,TYPE dev") echo "eth0:ethernet"; echo "wlan0:wifi" ;;
    "connection show "*)
        all="$*"; name="${all#connection show }"
        printf '%s\n' "$EXISTING" | grep -qxF -- "$name" ;;
    "-g GENERAL.STATE connection show Wired connection 1") [ "${WIRED_ACTIVE:-no}" = yes ] && echo activated ;;
esac
EOF
chmod +x "$TMP/bin/sudo" "$TMP/bin/nmcli"
export PATH="$TMP/bin:$PATH" CALLS="$TMP/calls"

check() {
    local name=$1; shift
    if "$@"; then echo "ok   - $name"; else echo "FAIL - $name"; FAILS=$((FAILS + 1)); fi
}

run_eth() {
    : > "$CALLS"
    EXISTING="$1" WIRED_ACTIVE="$2" bash "$DIR/../configure_ethernet.sh" > "$TMP/out" 2>&1
}

run_eth $'Ethernet-Client\nEthernet-Server\nWired connection 1' no
check "existing profiles are not modified" bash -c "! grep -Eq 'connection (add|modify|mod) ' '$CALLS'"
check "inactive default profile is deleted" grep -q "sudo nmcli connection delete Wired connection 1" "$CALLS"

run_eth $'Wired connection 1' yes
check "missing profiles created with one add each" test "$(grep -c 'sudo nmcli connection add' "$CALLS")" -eq 2
check "no separate modify after add" bash -c "! grep -Eq 'connection (modify|mod) ' '$CALLS'"
check "client add carries DHCP settings" grep -q "con-name Ethernet-Client.*ipv4.method auto.*ipv4.dhcp-timeout 5" "$CALLS"
check "server add carries shared address" grep -q "con-name Ethernet-Server.*ipv4.method shared ipv4.addresses 10.0.3.1/24" "$CALLS"
check "active default profile is kept" bash -c "! grep -q 'connection delete' '$CALLS'"

run_eth $'Wired connection 1' no
last_add=$(grep -n 'connection add' "$CALLS" | tail -1 | cut -d: -f1)
del=$(grep -n 'connection delete' "$CALLS" | cut -d: -f1)
check "default profile deleted after new profiles exist" test -n "$del" -a "${del:-0}" -gt "${last_add:-0}"

run_eth "" no
check "nothing deleted when default profile is absent" bash -c "! grep -q 'connection delete' '$CALLS'"

: > "$CALLS"
EXISTING="WiFiAP" bash "$DIR/../wifi_access_point.sh" > "$TMP/out" 2>&1
check "AP script leaves an existing profile alone" bash -c "! grep -Eq 'connection (add|up|modify)' '$CALLS'"

: > "$CALLS"
EXISTING="" bash "$DIR/../wifi_access_point.sh" > "$TMP/out" 2>&1
check "AP script creates the profile with one add" test "$(grep -c 'sudo nmcli connection add' "$CALLS")" -eq 1
check "AP profile is WPA2-only and not autoconnecting" grep -q "802-11-wireless-security.proto rsn.*connection.autoconnect no" "$CALLS"

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
