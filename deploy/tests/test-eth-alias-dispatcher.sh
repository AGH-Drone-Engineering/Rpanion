#!/bin/bash
# Runs the alias dispatcher in dry-run mode against crafted config files.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPATCHER="$DIR/../rpanion-eth-alias-dispatcher.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILS=0

run() {
    # $1 config content, $2 connection id
    printf '%s\n' "$1" > "$TMP/cfg"
    RPANION_ALIAS_CONFIG="$TMP/cfg" RPANION_DRY_RUN=1 CONNECTION_ID="$2" sh "$DISPATCHER" eth0 up 2>&1
}

expect() {
    # $1 name, $2 expected output, $3 actual output
    if [ "$2" = "$3" ]; then
        echo "ok   - $1"
    else
        echo "FAIL - $1: expected [$2] got [$3]"
        FAILS=$((FAILS + 1))
    fi
}

expect "valid alias applied" "ip addr add 192.168.5.2/24 dev eth0" \
    "$(run 'ETH_ALIASES="192.168.5.2/24"' Ethernet-Client)"
expect "multiple aliases" "ip addr add 10.1.1.2/16 dev eth0
ip addr add 172.16.0.9/32 dev eth0" \
    "$(run 'ETH_ALIASES="10.1.1.2/16 172.16.0.9/32"' Ethernet-Server)"
expect "command substitution ignored" "" \
    "$(run "ETH_ALIASES=\"\$(touch $TMP/pwn1)\"" Ethernet-Client)"
expect "injected separator ignored" "" \
    "$(run "ETH_ALIASES=\"1.2.3.4/24;touch $TMP/pwn2\"" Ethernet-Client)"
expect "quote breakout ignored" "" \
    "$(run "ETH_ALIASES=\"1.2.3.4/24\"; touch $TMP/pwn3; X=\"\"" Ethernet-Client)"
expect "octet out of range ignored" "" \
    "$(run 'ETH_ALIASES="999.1.1.1/24"' Ethernet-Client)"
expect "prefix out of range ignored" "" \
    "$(run 'ETH_ALIASES="10.0.0.1/33"' Ethernet-Client)"
expect "other connection ignored" "" \
    "$(run 'ETH_ALIASES="192.168.5.2/24"' bajer)"
expect "down action ignored" "" \
    "$(printf 'ETH_ALIASES="192.168.5.2/24"\n' > "$TMP/cfg"; RPANION_ALIAS_CONFIG="$TMP/cfg" RPANION_DRY_RUN=1 CONNECTION_ID=Ethernet-Client sh "$DISPATCHER" eth0 down 2>&1)"

for f in pwn1 pwn2 pwn3; do
    if [ -e "$TMP/$f" ]; then echo "FAIL - $f was created"; FAILS=$((FAILS + 1)); fi
done

[ "$FAILS" -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
